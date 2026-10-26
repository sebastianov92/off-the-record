/* otr-mic: the USB microphone for Off the Record on an LG TV.
 *
 * Three threads. The audio thread (real-time when allowed) reads the mic in
 * 128-frame blocks, runs the voice chain and plays the result through the TV or
 * a USB sound card. The analysis thread takes the clean signal from a ring and
 * finds the singer's pitch, onsets and feedback howls. The main thread serves
 * the app over a WebSocket on 127.0.0.1 (PROTOCOL.md) and keeps time: without
 * the app's heartbeat it mutes after 4 s and exits after 30 s.
 *
 * Modes: run (default), process, pitch, probe. */
#define _GNU_SOURCE
#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/utsname.h>
#include <time.h>
#include <unistd.h>

#include "audio.h"
#include "dsp.h"
#include "drift.h"
#include "feedback.h"
#include "otr.h"
#include "pitch.h"
#include "proto.h"
#include "wav.h"
#include "ws.h"

#if defined(__SSE__)
#include <xmmintrin.h>
#endif

#define RING (1 << 16)
#define FRAMES_MAX 256
#define ONSETS_MAX 32
#define STANDBY_AFTER_MS 4000
#define EXIT_AFTER_MS 30000
#define AUTH_WITHIN_MS 2000

/* The heartbeat's limits; tests shorten them through the environment. */
static int env_ms(const char *name, int fallback) {
    const char *v = getenv(name);
    return v && atoi(v) > 0 ? atoi(v) : fallback;
}

static double now_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec * 1000.0 + t.tv_nsec / 1e6;
}

static void sleep_ms(int ms) {
    struct timespec d = {ms / 1000, (ms % 1000) * 1000000L};
    nanosleep(&d, NULL);
}

/* Flush denormals to zero: reverb and filter tails decay into them, and ARM VFP
 * handles them in slow microcode. */
static void flush_denormals(void) {
#if defined(__arm__)
    unsigned int fpscr;
    __asm__ volatile("vmrs %0, fpscr" : "=r"(fpscr));
    fpscr |= 1u << 24;
    __asm__ volatile("vmsr fpscr, %0" : : "r"(fpscr));
#elif defined(__aarch64__)
    uint64_t fpcr;
    __asm__ volatile("mrs %0, fpcr" : "=r"(fpcr));
    fpcr |= 1u << 24;
    __asm__ volatile("msr fpcr, %0" : : "r"(fpcr));
#elif defined(__SSE__)
    _mm_setcsr(_mm_getcsr() | 0x8040);
#endif
}

/* ---- Shared state ------------------------------------------------------- */

typedef struct {
    audio_config cfg;
    int port;
    int rt_priority;
    char token[80];
    char epoch[17];

    /* params: main thread writes, audio thread reads (seqlock) */
    atomic_uint params_seq;
    otr_params params;
    /* notches: analysis thread writes, audio thread reads (seqlock) */
    atomic_uint notch_seq;
    dsp_notch notches[DSP_MAX_NOTCHES];
    atomic_int duck;

    /* clean signal, audio -> analysis */
    float ring[RING];
    atomic_uint ring_write, ring_read;

    /* pitch frames, analysis -> main */
    pthread_mutex_t lock;
    float frames[FRAMES_MAX];
    long long frames_first; /* sequence number of frames[0] */
    int frames_count;
    long long onsets[ONSETS_MAX];
    int onsets_count;
    float meter_peak, meter_sum, meter_gate, meter_gr;
    int meter_n, notches_active;
    float f0; /* latest voiced pitch, Hz, for the feedback detector */

    /* status */
    atomic_int quit;
    atomic_int standby;
    atomic_int onsets_on;
    atomic_int measure_request;
    atomic_int xruns, slips;
    atomic_int queue_min, queue_max; /* playback queue over the last status second */
    atomic_int cpu_permille;
    atomic_int rt;
    char state[16];
    char error[48];
    audio_input_info input;
    audio_output_info output;
    atomic_int measured_ms; /* -1 none, else the last result */
    atomic_int measured_conf;
} engine;

static engine E;

static void set_state(const char *state, const char *error) {
    pthread_mutex_lock(&E.lock);
    snprintf(E.state, sizeof(E.state), "%s", state);
    snprintf(E.error, sizeof(E.error), "%s", error ? error : "");
    pthread_mutex_unlock(&E.lock);
}

static void params_write(const otr_params *p) {
    atomic_fetch_add(&E.params_seq, 1);
    E.params = *p;
    atomic_fetch_add(&E.params_seq, 1);
}

static int params_read(otr_params *p, unsigned *seen) {
    unsigned s;
    do {
        s = atomic_load(&E.params_seq);
        if (s == *seen) return 0;
        if (s & 1) continue;
        *p = E.params;
    } while (atomic_load(&E.params_seq) != s);
    *seen = s;
    return 1;
}

/* ---- Latency measurement (on the audio thread) -------------------------- */

/* Goertzel power of 1 kHz in one block. */
static float tone_power(const float *x, int n) {
    float k = 2 * cosf(2 * (float)M_PI * 1000.0f / OTR_RATE), s1 = 0, s2 = 0;
    for (int i = 0; i < n; i++) {
        float s = x[i] + k * s1 - s2;
        s2 = s1;
        s1 = s;
    }
    return (s1 * s1 + s2 * s2 - k * s1 * s2) / (n * n);
}

typedef struct {
    int phase; /* 0 idle, 1 baseline, 2 tone, 3 listen, 4 gap */
    int blocks, tries, hits;
    float baseline;
    long long tone_start;
    int results[3];
} measurer;

static int cmp_int(const void *a, const void *b) { return *(const int *)a - *(const int *)b; }

/* Plays three 1 kHz bursts through the monitor and times their way back into
 * the mic: the delay the singer hears their own voice with. Writes the tone into
 * `out` while it runs; returns 1 while measuring. */
static int measure_step(measurer *m, const float *in, float *out, long long sample) {
    if (m->phase == 0) {
        if (!atomic_exchange(&E.measure_request, 0)) return 0;
        memset(m, 0, sizeof(*m));
        m->phase = 1;
    }
    float p = tone_power(in, OTR_BLOCK);
    memset(out, 0, sizeof(float) * OTR_BLOCK);
    m->blocks++;
    if (m->phase == 1) { /* 0.4 s of room noise */
        if (p > m->baseline) m->baseline = p;
        if (m->blocks >= 150) { m->phase = 2; m->blocks = 0; m->tone_start = sample; }
    } else if (m->phase == 2 || m->phase == 3) {
        if (m->phase == 2) {
            for (int i = 0; i < OTR_BLOCK; i++)
                out[i] = 0.3f * sinf(2 * (float)M_PI * 1000.0f * (float)(sample - m->tone_start + i) / OTR_RATE);
            if (m->blocks >= 94) m->phase = 3; /* 0.25 s of tone */
        }
        float threshold = fmaxf(m->baseline * 9, 1e-7f);
        if (p > threshold) {
            m->results[m->hits++] = (int)((sample - m->tone_start) * 1000 / OTR_RATE);
            m->phase = 4;
            m->blocks = 0;
        } else if (m->blocks >= 375) { /* nothing in a second */
            m->phase = 4;
            m->blocks = 0;
        }
    } else if (m->phase == 4) { /* let the room go quiet */
        if (m->blocks >= 190) {
            if (++m->tries >= 3) {
                if (m->hits) {
                    qsort(m->results, m->hits, sizeof(int), cmp_int);
                    atomic_store(&E.measured_ms, m->results[m->hits / 2]);
                } else {
                    atomic_store(&E.measured_ms, 0);
                }
                atomic_store(&E.measured_conf, m->hits);
                m->phase = 0;
                return 1;
            }
            m->phase = 1;
            m->blocks = 0;
            m->baseline = 0;
        }
    }
    return 1;
}

/* ---- Audio thread -------------------------------------------------------- */

static void *audio_thread(void *arg) {
    (void)arg;
    flush_denormals();
    if (E.rt_priority > 0) {
        struct sched_param sp = {.sched_priority = E.rt_priority};
        atomic_store(&E.rt, pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp) == 0);
    }
    static dsp_chain chain;
    dsp_init(&chain);
    drift_state drift;
    measurer meas = {0};
    float in[OTR_BLOCK], raw[OTR_BLOCK], tap[OTR_BLOCK], tone[OTR_BLOCK], dropped[OTR_BLOCK];
    float first[OTR_BLOCK], second[OTR_BLOCK];
    int pending_drop = 0;
    unsigned params_seen = 0, notch_seen = 0;
    long long sample = 0;
    audio *dev = NULL;
    double busy = 0, span = 0;

    while (!atomic_load(&E.quit)) {
        if (!dev) {
            const char *error = NULL;
            dev = audio_open(&E.cfg, &E.input, &E.output, &error);
            if (!dev) {
                set_state(!strcmp(error, "output-busy") ? "output-busy" : "mic-lost", error);
                sleep_ms(2000); /* a mic plugged in later is picked up here */
                continue;
            }
            /* The queue's trough band: deep enough to ride out a busy TV, shallow
             * enough not to add delay (the ADSP drains it 512 frames at a time). */
            drift_init(&drift, E.cfg.output == OUT_USB ? 64 : 192, E.cfg.output == OUT_USB ? 256 : 640);
            set_state(atomic_load(&E.standby) ? "standby" : "running", NULL);
        }
        if (audio_read(dev, in) < 0) {
            audio_close(dev);
            dev = NULL;
            set_state("mic-lost", "mic-missing");
            continue;
        }
        double t0 = now_ms();
        sample += OTR_BLOCK;

        otr_params p;
        if (params_read(&p, &params_seen)) dsp_set_params(&chain, &p);
        unsigned ns = atomic_load(&E.notch_seq);
        if (ns != notch_seen && !(ns & 1)) {
            dsp_notch copy[DSP_MAX_NOTCHES];
            memcpy(copy, E.notches, sizeof(copy));
            if (atomic_load(&E.notch_seq) == ns) {
                dsp_set_notches(&chain, copy, atomic_exchange(&E.duck, 0));
                notch_seen = ns;
            }
        }

        memcpy(raw, in, sizeof(raw));
        dsp_process(&chain, in, OTR_BLOCK, tap);
        E.meter_gate = chain.meter_gate_db;
        E.meter_gr = chain.meter_gr_db;

        unsigned w = atomic_load(&E.ring_write);
        for (int i = 0; i < OTR_BLOCK; i++) E.ring[(w + i) & (RING - 1)] = tap[i];
        atomic_store(&E.ring_write, w + OTR_BLOCK);

        /* Hidden app: the monitor goes quiet at once (the pitch keeps flowing
         * in case it comes straight back). */
        if (atomic_load(&E.standby)) memset(in, 0, sizeof(in));
        int playing = E.cfg.output != OUT_OFF;
        if (playing && measure_step(&meas, raw, tone, sample)) memcpy(in, tone, sizeof(in));

        if (playing) {
            int queued = audio_queued(dev);
            if (queued < atomic_load(&E.queue_min)) atomic_store(&E.queue_min, queued);
            if (queued > atomic_load(&E.queue_max)) atomic_store(&E.queue_max, queued);
            int action = drift_update(&drift, queued);
            if (action < 0) {
                memcpy(dropped, in, sizeof(dropped));
                pending_drop = 1;
                atomic_fetch_add(&E.slips, 1);
            } else {
                if (pending_drop) {
                    drift_crossfade_drop(dropped, in, OTR_BLOCK);
                    pending_drop = 0;
                }
                int r;
                if (action > 0) {
                    drift_repeat(in, first, second, OTR_BLOCK);
                    audio_write(dev, first, OTR_BLOCK);
                    r = audio_write(dev, second, OTR_BLOCK);
                    atomic_fetch_add(&E.slips, 1);
                } else {
                    r = audio_write(dev, in, OTR_BLOCK);
                }
                if (r < 0) atomic_fetch_add(&E.xruns, 1);
            }
        }
        busy += now_ms() - t0;
        span += OTR_BLOCK * 1000.0 / OTR_RATE;
        if (span >= 1000) {
            atomic_store(&E.cpu_permille, (int)(busy * 1000 / span));
            busy = span = 0;
        }
    }
    if (dev) audio_close(dev);
    return NULL;
}

/* ---- Analysis thread ------------------------------------------------------ */

static void *analysis_thread(void *arg) {
    (void)arg;
    flush_denormals();
    static yin_state yin;
    static feedback_state fb;
    onset_state onset;
    yin_init(&yin);
    feedback_init(&fb);
    onset_init(&onset);
    float chunk[OTR_BLOCK];
    long long frame_seq = 0;
    long long analysed = 0, first_frame_sample = -1; /* onsets are counted in pitch frames */
    while (!atomic_load(&E.quit)) {
        unsigned r = atomic_load(&E.ring_read), w = atomic_load(&E.ring_write);
        if (w - r > RING) r = w - RING; /* fell behind: skip ahead */
        if (w - r < OTR_BLOCK) {
            sleep_ms(3);
            continue;
        }
        for (int i = 0; i < OTR_BLOCK; i++) chunk[i] = E.ring[(r + i) & (RING - 1)];
        atomic_store(&E.ring_read, r + OTR_BLOCK);

        float midi[4], rms[4];
        int n = yin_push(&yin, chunk, OTR_BLOCK, midi, rms, 4);
        analysed += OTR_BLOCK;
        if (n && first_frame_sample < 0) first_frame_sample = analysed;
        float peak = 0, sum = 0;
        for (int i = 0; i < OTR_BLOCK; i++) {
            float a = fabsf(chunk[i]);
            if (a > peak) peak = a;
            sum += chunk[i] * chunk[i];
        }
        long long found[ONSETS_MAX];
        int onsets = atomic_load(&E.onsets_on) ? onset_push(&onset, chunk, OTR_BLOCK, found, ONSETS_MAX) : 0;
        if (!atomic_load(&E.onsets_on)) onset.sample += OTR_BLOCK;

        pthread_mutex_lock(&E.lock);
        for (int i = 0; i < n; i++) {
            if (E.frames_count == FRAMES_MAX) { /* nobody reading: keep the newest */
                memmove(E.frames, E.frames + 1, (FRAMES_MAX - 1) * sizeof(float));
                E.frames_count--;
                E.frames_first++;
            }
            if (E.frames_count == 0) E.frames_first = frame_seq;
            E.frames[E.frames_count++] = midi[i];
            frame_seq++;
            E.f0 = midi[i] > 0 ? 440.0f * powf(2, (midi[i] - 69) / 12) : 0;
        }
        /* An onset's position in pitch frames: frame 0 is where the first frame came out. */
        for (int i = 0; i < onsets && E.onsets_count < ONSETS_MAX && first_frame_sample >= 0; i++)
            E.onsets[E.onsets_count++] = found[i] - first_frame_sample;
        if (peak > E.meter_peak) E.meter_peak = peak;
        E.meter_sum += sum;
        E.meter_n += OTR_BLOCK;
        float f0 = E.f0;
        pthread_mutex_unlock(&E.lock);

        if (feedback_push(&fb, chunk, OTR_BLOCK, f0, E.params.antifeedback)) {
            atomic_fetch_add(&E.notch_seq, 1);
            memcpy(E.notches, fb.notch, sizeof(E.notches));
            atomic_fetch_add(&E.notch_seq, 1);
            if (fb.duck) {
                atomic_store(&E.duck, 1);
                fb.duck = 0;
            }
            pthread_mutex_lock(&E.lock);
            E.notches_active = feedback_active(&fb);
            pthread_mutex_unlock(&E.lock);
        }
    }
    return NULL;
}

/* ---- Main thread: the app's connection ----------------------------------- */

typedef struct {
    ws_server *ws;
    int client;         /* the authenticated app, or -1 */
    int pending[WS_MAX_CLIENTS];
    double opened_at[WS_MAX_CLIENTS];
    double last_beat;
    double started;
    int ever_authed;
    otr_params params;
} session;

static void send_json(session *s, const char *json) {
    if (s->client >= 0) ws_send(s->ws, s->client, json, (int)strlen(json));
}

static void send_hello(session *s) {
    char buf[768];
    const char *kinds[] = {"tv", "usb", "off"};
    pthread_mutex_lock(&E.lock);
    snprintf(buf, sizeof(buf),
             "{\"type\":\"hello\",\"proto\":%d,\"version\":\"%s\",\"epoch\":\"%s\",\"rt\":%s,"
             "\"input\":{\"name\":\"%s\",\"card\":%d},"
             "\"output\":{\"kind\":\"%s\",\"pcm\":\"%s\",\"period\":%d,\"buffer\":%d}}",
             OTR_PROTO, OTR_VERSION, E.epoch, atomic_load(&E.rt) ? "true" : "false", E.input.name, E.input.card,
             kinds[E.cfg.output], E.output.pcm, E.output.period, E.output.buffer);
    pthread_mutex_unlock(&E.lock);
    send_json(s, buf);
}

static void on_open(void *ctx, int client) {
    session *s = ctx;
    s->pending[client] = 1;
    s->opened_at[client] = now_ms();
}

static void on_close(void *ctx, int client) {
    session *s = ctx;
    s->pending[client] = 0;
    if (s->client == client) s->client = -1;
}

static void on_message(void *ctx, int client, const char *text, int len) {
    session *s = ctx;
    msg m;
    otr_params p = s->params;
    if (proto_parse(text, len, &m, &p) < 0) return;
    if (client != s->client) {
        /* Only `auth` with this launch's token gets anywhere. */
        if (m.type != MSG_AUTH || strcmp(m.token, E.token)) {
            ws_close(s->ws, client);
            s->pending[client] = 0;
            return;
        }
        if (s->client >= 0) ws_close(s->ws, s->client); /* a reloaded app replaces the old page */
        s->client = client;
        s->pending[client] = 0;
        s->ever_authed = 1;
        s->last_beat = now_ms();
        send_hello(s);
        return;
    }
    switch (m.type) {
    case MSG_PARAMS:
        s->params = p;
        params_write(&p);
        break;
    case MSG_BEAT:
        s->last_beat = now_ms();
        if (atomic_exchange(&E.standby, 0)) set_state("running", NULL);
        break;
    case MSG_STANDBY:
        atomic_store(&E.standby, 1);
        set_state("standby", NULL);
        break;
    case MSG_RESUME:
        s->last_beat = now_ms();
        atomic_store(&E.standby, 0);
        set_state("running", NULL);
        break;
    case MSG_QUIT:
        atomic_store(&E.quit, 1);
        break;
    case MSG_MEASURE:
        atomic_store(&E.measured_ms, -1);
        atomic_store(&E.measure_request, 1);
        break;
    case MSG_ONSETS:
        atomic_store(&E.onsets_on, m.on);
        break;
    default:
        break;
    }
}

static void send_tick(session *s) {
    char buf[1024];
    int n;
    pthread_mutex_lock(&E.lock);
    float peak = E.meter_peak, rms = E.meter_n ? sqrtf(E.meter_sum / E.meter_n) : 0;
    n = snprintf(buf, sizeof(buf), "{\"type\":\"tick\",\"epoch\":\"%s\",\"seq\":%lld,\"hop\":0.02,\"midi\":[", E.epoch,
                 E.frames_first);
    for (int i = 0; i < E.frames_count && n < 800; i++) n += snprintf(buf + n, sizeof(buf) - n, "%s%.2f", i ? "," : "", E.frames[i]);
    n += snprintf(buf + n, sizeof(buf) - n,
                  "],\"meter\":{\"peak\":%.1f,\"rms\":%.1f,\"gate\":%.1f,\"gr\":%.1f,\"notches\":%d}}",
                  20 * log10f(peak + 1e-9f), 20 * log10f(rms + 1e-9f), E.meter_gate, E.meter_gr, E.notches_active);
    E.frames_first += E.frames_count;
    E.frames_count = 0;
    E.meter_peak = E.meter_sum = 0;
    E.meter_n = 0;
    long long onsets[ONSETS_MAX];
    int count = E.onsets_count;
    memcpy(onsets, E.onsets, sizeof(long long) * count);
    E.onsets_count = 0;
    pthread_mutex_unlock(&E.lock);
    send_json(s, buf);
    for (int i = 0; i < count; i++) {
        snprintf(buf, sizeof(buf), "{\"type\":\"onset\",\"epoch\":\"%s\",\"frame\":%.3f}", E.epoch, (double)onsets[i] / OTR_HOP);
        send_json(s, buf);
    }
}

static void send_status(session *s) {
    char buf[256];
    pthread_mutex_lock(&E.lock);
    int qmin = atomic_exchange(&E.queue_min, 1 << 30), qmax = atomic_exchange(&E.queue_max, -1);
    snprintf(buf, sizeof(buf),
             "{\"type\":\"status\",\"state\":\"%s\",\"error\":\"%s\",\"xruns\":%d,\"slips\":%d,\"cpu\":%.1f,"
             "\"queue\":[%d,%d]}",
             E.state, E.error, atomic_load(&E.xruns), atomic_load(&E.slips), atomic_load(&E.cpu_permille) / 10.0,
             qmax < 0 ? 0 : qmin, qmax < 0 ? 0 : qmax);
    pthread_mutex_unlock(&E.lock);
    send_json(s, buf);
}

static void on_signal(int sig) {
    (void)sig;
    atomic_store(&E.quit, 1);
}

static int run(void) {
    ws_server *ws = ws_listen(E.port);
    if (!ws) {
        fprintf(stderr, "otr-mic: cannot listen on 127.0.0.1:%d: %s\n", E.port, strerror(errno));
        return 2;
    }
#ifdef __linux__
    mlockall(MCL_CURRENT | MCL_FUTURE);
#endif
    signal(SIGTERM, on_signal);
    signal(SIGINT, on_signal);
    signal(SIGPIPE, SIG_IGN);
    session s = {.ws = ws, .client = -1, .started = now_ms()};
    otr_params_default(&s.params);
    params_write(&s.params);
    pthread_t audio_t, analysis_t;
    pthread_create(&audio_t, NULL, audio_thread, NULL);
    pthread_create(&analysis_t, NULL, analysis_thread, NULL);
    ws_handlers h = {on_open, on_message, on_close, &s};
    double next_tick = now_ms() + 100, next_status = now_ms() + 1000;
    const int standby_after = env_ms("OTR_STANDBY_MS", STANDBY_AFTER_MS);
    const int exit_after = env_ms("OTR_EXIT_MS", EXIT_AFTER_MS);
    while (!atomic_load(&E.quit)) {
        ws_poll(ws, 20, &h);
        double t = now_ms();
        for (int i = 0; i < WS_MAX_CLIENTS; i++) {
            if (s.pending[i] && t - s.opened_at[i] > AUTH_WITHIN_MS) {
                ws_close(ws, i);
                s.pending[i] = 0;
            }
        }
        /* The heartbeat: hidden app, mute; gone for good, leave. */
        double since = s.ever_authed ? t - s.last_beat : t - s.started;
        if (since > exit_after) break;
        if (s.ever_authed && since > standby_after && !atomic_load(&E.standby)) {
            atomic_store(&E.standby, 1);
            set_state("standby", NULL);
        }
        if (t >= next_tick) {
            next_tick += 100;
            send_tick(&s);
            int ms = atomic_load(&E.measured_ms);
            if (ms >= 0) {
                char buf[96];
                snprintf(buf, sizeof(buf), "{\"type\":\"measured\",\"ms\":%d,\"confidence\":%d}", ms, atomic_load(&E.measured_conf));
                send_json(&s, buf);
                atomic_store(&E.measured_ms, -1);
            }
        }
        if (t >= next_status) {
            next_status += 1000;
            send_status(&s);
        }
    }
    atomic_store(&E.quit, 1);
    pthread_join(audio_t, NULL);
    pthread_join(analysis_t, NULL);
    ws_free(ws);
    return 0;
}

/* ---- Offline modes -------------------------------------------------------- */

static char *read_file(const char *path, int *len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc(size + 1);
    *len = (int)fread(buf, 1, size, f);
    buf[*len] = 0;
    fclose(f);
    return buf;
}

/* The voice chain over a WAV file, for tuning presets on real takes. */
static int process_file(const char *in_path, const char *out_path, const char *params_path) {
    float *x;
    int rate;
    int frames = wav_read(in_path, &x, &rate);
    if (frames <= 0 || rate != OTR_RATE) {
        fprintf(stderr, "otr-mic: %s must be a 48 kHz 16-bit WAV\n", in_path);
        return 1;
    }
    otr_params p;
    otr_params_default(&p);
    if (params_path) {
        int len;
        char *json = read_file(params_path, &len);
        if (!json || proto_parse_params(json, len, &p) < 0) {
            fprintf(stderr, "otr-mic: cannot read params from %s\n", params_path);
            return 1;
        }
        free(json);
    }
    static dsp_chain chain;
    dsp_init(&chain);
    dsp_set_params(&chain, &p);
    chain.out_gain = chain.out_target;
    for (int i = 0; i + OTR_BLOCK <= frames; i += OTR_BLOCK) dsp_process(&chain, x + i, OTR_BLOCK, NULL);
    int r = wav_write(out_path, x, frames, OTR_RATE);
    free(x);
    return r ? 1 : 0;
}

/* Prints the pitch frames of a WAV file, one per line, for parity tests. */
static int pitch_file(const char *path) {
    float *x;
    int rate;
    int frames = wav_read(path, &x, &rate);
    if (frames <= 0 || rate != OTR_RATE) return 1;
    static yin_state y;
    yin_init(&y);
    for (int i = 0; i + OTR_BLOCK <= frames; i += OTR_BLOCK) {
        float midi[4];
        int n = yin_push(&y, x + i, OTR_BLOCK, midi, NULL, 4);
        for (int k = 0; k < n; k++) printf("%.3f\n", midi[k]);
    }
    free(x);
    return 0;
}

static int probe(void) {
    struct utsname u;
    uname(&u);
    static char cards[32768];
    audio_probe(cards, sizeof(cards));
    struct sched_param sp = {.sched_priority = 10};
    int fifo = pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp) == 0;
    printf("{\"arch\":\"%s\",\"kernel\":\"%s\",\"sched_fifo\":%s,\"sound\":%s}\n", u.machine, u.release,
           fifo ? "true" : "false", cards);
    return 0;
}

static void usage(void) {
    fprintf(stderr,
            "usage: otr-mic [run] [--backend alsa|null] [--output tv|usb|off] [--pcm C,D] [--port N]\n"
            "               [--mic-gain N] [--rt N] [--input file.wav]      (token in OTR_TOKEN)\n"
            "       otr-mic process in.wav out.wav [--params p.json]\n"
            "       otr-mic pitch in.wav\n"
            "       otr-mic probe\n");
}

int main(int argc, char **argv) {
    pthread_mutex_init(&E.lock, NULL);
    E.cfg.backend =
#ifdef OTR_ALSA
        "alsa";
#else
        "null";
#endif
    E.cfg.output = OUT_TV;
    E.cfg.tv_card = 0;
    E.cfg.tv_device = -1;
    E.cfg.mic_gain = 10;
    E.port = 47830;
    E.rt_priority = 40;
    atomic_store(&E.measured_ms, -1);
    atomic_store(&E.queue_min, 1 << 30);
    atomic_store(&E.queue_max, -1);
    snprintf(E.state, sizeof(E.state), "starting");

    const char *mode = argc > 1 && argv[1][0] != '-' ? argv[1] : "run";
    int i = argc > 1 && argv[1][0] != '-' ? 2 : 1;
    if (!strcmp(mode, "process")) {
        if (argc < 4) { usage(); return 1; }
        const char *params = argc >= 6 && !strcmp(argv[4], "--params") ? argv[5] : NULL;
        return process_file(argv[2], argv[3], params);
    }
    if (!strcmp(mode, "pitch")) {
        if (argc < 3) { usage(); return 1; }
        return pitch_file(argv[2]);
    }
    if (!strcmp(mode, "probe")) return probe();
    if (strcmp(mode, "run")) { usage(); return 1; }

    for (; i < argc; i++) {
        const char *a = argv[i], *v = i + 1 < argc ? argv[i + 1] : NULL;
        if (!strcmp(a, "--backend") && v) E.cfg.backend = v, i++;
        else if (!strcmp(a, "--output") && v) {
            E.cfg.output = !strcmp(v, "usb") ? OUT_USB : !strcmp(v, "off") ? OUT_OFF : OUT_TV;
            i++;
        } else if (!strcmp(a, "--pcm") && v) {
            sscanf(v, "%d,%d", &E.cfg.tv_card, &E.cfg.tv_device);
            i++;
        } else if (!strcmp(a, "--port") && v) E.port = atoi(v), i++;
        else if (!strcmp(a, "--mic-gain") && v) E.cfg.mic_gain = atoi(v), i++;
        else if (!strcmp(a, "--rt") && v) E.rt_priority = atoi(v), i++;
        else if (!strcmp(a, "--input") && v) E.cfg.input_wav = v, i++;
        else { usage(); return 1; }
    }
    const char *token = getenv("OTR_TOKEN");
    if (!token || strlen(token) < 16 || strlen(token) >= sizeof(E.token)) {
        fprintf(stderr, "otr-mic: OTR_TOKEN (16+ characters) is required\n");
        return 1;
    }
    snprintf(E.token, sizeof(E.token), "%s", token);
    srand((unsigned)(now_ms() * 1000) ^ (unsigned)getpid());
    for (int k = 0; k < 16; k++) E.epoch[k] = "0123456789abcdef"[rand() & 15];
    return run();
}
