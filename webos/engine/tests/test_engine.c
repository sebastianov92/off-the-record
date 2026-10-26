/* Tests for the engine's signal path, built with sanitizers on the Mac:
 * filter shapes against the formulas, dynamics against their static curves,
 * YIN on known tones, crossfaded slips, the feedback suppressor in a virtual
 * room, and message parsing. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "dsp.h"
#include "drift.h"
#include "feedback.h"
#include "otr.h"
#include "pitch.h"
#include "proto.h"
#include "wav.h"

static int failures = 0, checks = 0;
#define CHECK(cond, ...)                                  \
    do {                                                  \
        checks++;                                         \
        if (!(cond)) {                                    \
            failures++;                                   \
            printf("FAIL %s:%d: ", __FILE__, __LINE__);   \
            printf(__VA_ARGS__);                          \
            printf("\n");                                 \
        }                                                 \
    } while (0)

static float db(float x) { return 20 * log10f(x + 1e-12f); }

static void test_filters(void) {
    biquad f;
    biquad_highpass(&f, 90, 0.707f);
    CHECK(fabsf(biquad_response_db(&f, 90) + 3) < 0.3f, "high-pass -3 dB at 90 Hz: %.2f", biquad_response_db(&f, 90));
    CHECK(biquad_response_db(&f, 20) < -24, "high-pass cuts 20 Hz: %.2f", biquad_response_db(&f, 20));
    CHECK(fabsf(biquad_response_db(&f, 1000)) < 0.1f, "high-pass passes 1 kHz");
    biquad_peak(&f, 3500, 1.0f, 6);
    CHECK(fabsf(biquad_response_db(&f, 3500) - 6) < 0.05f, "peak +6 dB at its centre: %.2f", biquad_response_db(&f, 3500));
    CHECK(fabsf(biquad_response_db(&f, 200)) < 0.3f, "peak leaves 200 Hz alone");
    biquad_lowshelf(&f, 120, -6);
    CHECK(fabsf(biquad_response_db(&f, 20) + 6) < 0.3f, "low shelf -6 dB below: %.2f", biquad_response_db(&f, 20));
    CHECK(fabsf(biquad_response_db(&f, 120) + 3) < 0.3f, "low shelf half way at its corner: %.2f", biquad_response_db(&f, 120));
    CHECK(fabsf(biquad_response_db(&f, 5000)) < 0.2f, "low shelf leaves the top alone");
    biquad_highshelf(&f, 9000, 4);
    CHECK(fabsf(biquad_response_db(&f, 20000) - 4) < 0.5f, "high shelf +4 dB above: %.2f", biquad_response_db(&f, 20000));
    CHECK(fabsf(biquad_response_db(&f, 500)) < 0.2f, "high shelf leaves the bottom alone");
    /* Running the filter agrees with its response. */
    biquad_peak(&f, 1000, 1.0f, 6);
    float peak = 0;
    for (int i = 0; i < OTR_RATE; i++) {
        float y = biquad_run(&f, sinf(2 * (float)M_PI * 1000 * i / OTR_RATE));
        if (i > OTR_RATE / 2 && fabsf(y) > peak) peak = fabsf(y);
    }
    CHECK(fabsf(db(peak) - 6) < 0.1f, "a 1 kHz sine comes out +6 dB: %.2f", db(peak));
}

/* A chain with every effect off except the one under test. */
static void plain(otr_params *p) {
    otr_params_default(p);
    p->hpf = 0;
    p->gate_range_db = 0;
    p->comp_ratio = 1;
    p->deesser_amount = 0;
    p->echo_mix = 0;
    p->reverb_mix = 0;
    p->antifeedback = 0;
    p->mic_volume = 70;
}

/* Steady-state peak of a sine through the chain. */
static float through(otr_params *p, float hz, float amp_db) {
    static dsp_chain c;
    dsp_init(&c);
    dsp_set_params(&c, p);
    c.out_gain = c.out_target;
    float buf[OTR_BLOCK], amp = otr_db_to_gain(amp_db), peak = 0;
    for (int b = 0; b < OTR_RATE * 2 / OTR_BLOCK; b++) {
        for (int i = 0; i < OTR_BLOCK; i++) buf[i] = amp * sinf(2 * (float)M_PI * hz * (b * OTR_BLOCK + i) / OTR_RATE);
        dsp_process(&c, buf, OTR_BLOCK, NULL);
        if (b > OTR_RATE / OTR_BLOCK)
            for (int i = 0; i < OTR_BLOCK; i++) if (fabsf(buf[i]) > peak) peak = fabsf(buf[i]);
    }
    return db(peak);
}

static void test_dynamics(void) {
    otr_params p;
    plain(&p);
    CHECK(fabsf(through(&p, 1000, -12)) - 12 < 0.3f && fabsf(through(&p, 1000, -12) + 12) < 0.3f,
          "a plain chain is unity: %.2f", through(&p, 1000, -12));

    plain(&p);
    p.comp_ratio = 3;
    p.comp_threshold_db = -18;
    /* Peak detector on a sine: 6 dB over at -12 dBFS, so 4 dB of reduction, then
     * the makeup of half the full-scale reduction (6 dB). */
    float out = through(&p, 1000, -12);
    CHECK(fabsf(out - (-12 - 4 + 6)) < 1.0f, "compressor static curve: %.2f", out);
    float quiet = through(&p, 1000, -40);
    CHECK(fabsf(quiet - (-40 + 6)) < 0.5f, "under the threshold only makeup: %.2f", quiet);

    plain(&p);
    p.mic_volume = 100; /* +12 dB */
    float ceiling = db(otr_db_to_gain(-1));
    for (float level = -12; level <= 0; level += 3) {
        float o = through(&p, 440, level);
        CHECK(o <= ceiling + 0.01f, "limiter holds -1 dBFS for a %.0f dBFS sine: %.2f", level, o);
    }
    /* Impulses too. */
    static dsp_chain c;
    dsp_init(&c);
    dsp_set_params(&c, &p);
    c.out_gain = c.out_target;
    float buf[OTR_BLOCK], worst = 0;
    for (int b = 0; b < 200; b++) {
        memset(buf, 0, sizeof(buf));
        buf[b % OTR_BLOCK] = b & 1 ? 1.0f : -1.0f;
        dsp_process(&c, buf, OTR_BLOCK, NULL);
        for (int i = 0; i < OTR_BLOCK; i++) if (fabsf(buf[i]) > worst) worst = fabsf(buf[i]);
    }
    CHECK(db(worst) <= ceiling + 0.01f, "limiter holds on impulses: %.2f", db(worst));

    plain(&p);
    p.deesser_amount = 1;
    float hiss = through(&p, 7000, -12) - (-12);
    float voice = through(&p, 1000, -12) - (-12);
    CHECK(hiss < voice - 6, "de-esser cuts 7 kHz (%.1f dB) much more than 1 kHz (%.1f dB)", hiss, voice);

    plain(&p);
    p.mute = 1;
    CHECK(through(&p, 1000, -6) < -90, "mute is silence");
}

static float yin_of(float hz, float vibrato_cents, float seconds, float amp) {
    static yin_state y;
    yin_init(&y);
    float buf[OTR_BLOCK], midi[4], sum = 0;
    int count = 0;
    double phase = 0;
    for (int b = 0; b < (int)(seconds * OTR_RATE) / OTR_BLOCK; b++) {
        for (int i = 0; i < OTR_BLOCK; i++) {
            double t = (double)(b * OTR_BLOCK + i) / OTR_RATE;
            double f = hz * pow(2, vibrato_cents / 1200 * sin(2 * M_PI * 5 * t));
            phase += 2 * M_PI * f / OTR_RATE;
            buf[i] = amp * (float)(sin(phase) + 0.5 * sin(2 * phase) + 0.25 * sin(3 * phase));
        }
        int n = yin_push(&y, buf, OTR_BLOCK, midi, NULL, 4);
        for (int k = 0; k < n; k++) { sum += midi[k]; count++; }
    }
    return count ? sum / count : -1;
}

static void test_pitch(void) {
    float m = yin_of(220, 0, 1, 0.3f);
    CHECK(fabsf(m - 57) < 0.1f, "A3 reads as MIDI 57: %.3f", m);
    m = yin_of(440, 0, 1, 0.3f);
    CHECK(fabsf(m - 69) < 0.1f, "A4 reads as MIDI 69: %.3f", m);
    m = yin_of(110, 0, 1, 0.3f);
    CHECK(fabsf(m - 45) < 0.15f, "A2, a low voice, reads as MIDI 45: %.3f", m);
    m = yin_of(330, 50, 2, 0.3f);
    CHECK(fabsf(m - (69 + 12 * log2f(330.0f / 440))) < 0.15f, "vibrato averages to its centre: %.3f", m);
    CHECK(yin_of(220, 0, 1, 0.001f) == 0, "a whisper under the silence level is 0");

    static yin_state y;
    yin_init(&y);
    float silence[OTR_BLOCK] = {0}, midi[4];
    int frames = 0;
    for (int b = 0; b < OTR_RATE / OTR_BLOCK; b++) frames += yin_push(&y, silence, OTR_BLOCK, midi, NULL, 4);
    CHECK(abs(frames - 48) <= 2, "about 50 frames a second once the window fills: %d", frames);

    onset_state o;
    onset_init(&o);
    float buf[OTR_BLOCK];
    long long found[8];
    int total = 0;
    long long at = -1;
    for (int b = 0; b < 200; b++) {
        for (int i = 0; i < OTR_BLOCK; i++) {
            long long s = (long long)b * OTR_BLOCK + i;
            buf[i] = (s >= 12000 && s < 12400) ? 0.5f * sinf(s * 0.3f) : 0.0005f * sinf(s * 0.01f);
        }
        int n = onset_push(&o, buf, OTR_BLOCK, found, 8);
        if (n && at < 0) at = found[0];
        total += n;
    }
    CHECK(total == 1 && llabs(at - 12000) <= 256, "one onset at the click: %d at %lld", total, at);
}

static void test_drift(void) {
    drift_state d;
    drift_init(&d, 256, 1280);
    int action = 0;
    for (int i = 0; i < d.window; i++) action = drift_update(&d, 100);
    CHECK(action == 1, "a draining queue gets a block repeated");
    action = 0;
    for (int i = 0; i < d.window * 4; i++) action |= drift_update(&d, 2000) == -1;
    CHECK(action, "an overfull queue gets a block dropped");
    for (int i = 0; i < d.window * 8; i++) CHECK(drift_update(&d, 700) == 0, "a queue in its band is left alone");

    /* Slips never jump: compare the largest step with the sine's own. */
    float a[OTR_BLOCK], b[OTR_BLOCK], c[OTR_BLOCK];
    float w = 2 * (float)M_PI * 440 / OTR_RATE, natural = 0.5f * w * 1.05f;
    for (int i = 0; i < OTR_BLOCK; i++) {
        a[i] = 0.5f * sinf(w * i);
        b[i] = 0.5f * sinf(w * (i + OTR_BLOCK));
        c[i] = 0.5f * sinf(w * (i + 2 * OTR_BLOCK));
    }
    /* Dropping b: a is played, then c fades in from b. */
    drift_crossfade_drop(b, c, OTR_BLOCK);
    float worst = fabsf(c[0] - a[OTR_BLOCK - 1]);
    for (int i = 1; i < OTR_BLOCK; i++) worst = fmaxf(worst, fabsf(c[i] - c[i - 1]));
    CHECK(worst < natural * 1.6f, "a drop crossfades without a jump: %.4f vs %.4f", worst, natural);
    float first[OTR_BLOCK], second[OTR_BLOCK];
    drift_repeat(a, first, second, OTR_BLOCK);
    worst = fabsf(second[0] - first[OTR_BLOCK - 1]);
    CHECK(worst < 0.02f, "a repeat dips instead of clicking: %.4f", worst);
}

/* ---- Feedback in a virtual room ----------------------------------------- */

typedef struct {
    float line[OTR_RATE];
    int pos, delay;
    biquad resonance; /* the room's loudest mode, where the howl starts */
} room;

/* Speaker to mic: a delay, a resonance and a little loss. */
static float room_run(room *r, float speaker) {
    float out = r->line[(r->pos - r->delay + OTR_RATE) % OTR_RATE];
    r->line[r->pos] = speaker;
    r->pos = (r->pos + 1) % OTR_RATE;
    return biquad_run(&r->resonance, out);
}

/* Does the loop at gain `g_db` stay bounded over 6 s, with or without the suppressor? */
static int stable(float g_db, int delay_ms, int suppress) {
    static room r;
    static feedback_state fb;
    memset(&r, 0, sizeof(r));
    r.delay = delay_ms * OTR_RATE / 1000;
    biquad_peak(&r.resonance, 1730, 8.0f, 12);
    feedback_init(&fb);
    biquad notch[DSP_MAX_NOTCHES];
    for (int i = 0; i < DSP_MAX_NOTCHES; i++) biquad_identity(&notch[i]);
    float g = otr_db_to_gain(g_db), last = 0, tap[OTR_BLOCK];
    unsigned seed = 1;
    double loud = 0;
    for (int b = 0; b < 6 * OTR_RATE / OTR_BLOCK; b++) {
        for (int i = 0; i < OTR_BLOCK; i++) {
            seed = seed * 1664525 + 1013904223;
            float noise = ((seed >> 9) / 4194304.0f - 1) * 0.003f; /* room noise */
            float mic = noise + g * room_run(&r, last);
            float y = mic;
            for (int k = 0; k < DSP_MAX_NOTCHES; k++) if (fb.notch[k].gain_db < 0) y = biquad_run(&notch[k], y);
            y = fmaxf(-1, fminf(1, y));
            tap[i] = mic;
            last = y;
            if (b > 5 * OTR_RATE / OTR_BLOCK) loud += y * y;
        }
        if (feedback_push(&fb, tap, OTR_BLOCK, 0, suppress)) {
            for (int k = 0; k < DSP_MAX_NOTCHES; k++) {
                if (fb.notch[k].gain_db < 0) biquad_peak(&notch[k], fb.notch[k].freq, DSP_NOTCH_Q, fb.notch[k].gain_db);
                else biquad_identity(&notch[k]);
            }
        }
    }
    float rms = sqrtf((float)(loud / OTR_RATE));
    return db(rms) < -30; /* still near the noise, not a howl */
}

static float max_stable_gain(int delay_ms, int suppress) {
    float best = -40;
    for (float g = -20; g <= 20; g += 1) {
        if (!stable(g, delay_ms, suppress)) break;
        best = g;
    }
    return best;
}

static void test_feedback(void) {
    for (int k = 0; k < 2; k++) {
        int delay = k ? 15 : 120;
        float off = max_stable_gain(delay, 0), on = max_stable_gain(delay, 1);
        CHECK(on - off >= 6, "%d ms room: suppression adds %.0f dB before feedback (off %.0f, on %.0f)", delay,
              on - off, off, on);
        printf("feedback, %d ms room: stable up to %.0f dB loop gain off, %.0f dB on\n", delay, off, on);
    }
    /* A sung vowel, steady or with vibrato, gets no notch. */
    for (int vib = 0; vib < 2; vib++) {
        static feedback_state fb;
        feedback_init(&fb);
        float buf[OTR_BLOCK];
        double phase = 0;
        int ever = 0;
        for (int b = 0; b < 5 * OTR_RATE / OTR_BLOCK; b++) {
            for (int i = 0; i < OTR_BLOCK; i++) {
                double t = (double)(b * OTR_BLOCK + i) / OTR_RATE;
                double f = 220 * pow(2, (vib ? 40 : 0) / 1200.0 * sin(2 * M_PI * 5 * t));
                phase += 2 * M_PI * f / OTR_RATE;
                float v = 0;
                for (int h = 1; h <= 10; h++) v += (float)(sin(h * phase) / h);
                buf[i] = 0.2f * v;
            }
            feedback_push(&fb, buf, OTR_BLOCK, 220, 1);
            ever |= feedback_active(&fb);
        }
        CHECK(!ever, "a %s vowel is not mistaken for feedback", vib ? "vibrato" : "steady");
    }
}

static void test_proto(void) {
    otr_params p;
    otr_params_default(&p);
    msg m;
    const char *j = "{\"type\":\"params\",\"eq\":[1,-2,30,0,4],\"echo\":{\"mix\":0.5,\"delayMs\":118},"
                    "\"micVolume\":101,\"mute\":true,\"comp\":{\"ratio\":4},\"antifeedback\":false}";
    CHECK(proto_parse(j, (int)strlen(j), &m, &p) == 0 && m.type == MSG_PARAMS, "params parse");
    CHECK(p.eq_db[0] == 1 && p.eq_db[1] == -2 && p.eq_db[2] == 12 && p.eq_db[4] == 4, "eq read and clamped");
    CHECK(fabsf(p.echo_mix - 0.5f) < 1e-6 && fabsf(p.echo_delay_ms - 118) < 1e-6, "nested fields read");
    CHECK(p.mic_volume == 100 && p.mute == 1 && p.comp_ratio == 4 && p.antifeedback == 0, "flags and clamps");
    CHECK(fabsf(p.reverb_mix - 0.15f) < 1e-6, "missing fields keep their value");
    j = "{\"type\":\"auth\",\"token\":\"abc123\"}";
    CHECK(proto_parse(j, (int)strlen(j), &m, NULL) == 0 && m.type == MSG_AUTH && !strcmp(m.token, "abc123"), "auth token");
    CHECK(proto_parse("[1,2]", 5, &m, NULL) < 0, "a non-object is refused");
    CHECK(proto_parse("{\"type\":\"x\"}", 12, &m, NULL) == 0 && m.type == MSG_UNKNOWN, "an unknown type is ignored");
}

static void test_wav(void) {
    float x[480];
    for (int i = 0; i < 480; i++) x[i] = 0.5f * sinf(i * 0.1f);
    const char *path = "build/test.wav";
    CHECK(wav_write(path, x, 480, OTR_RATE) == 0, "wav written");
    float *y = NULL;
    int rate = 0, n = wav_read(path, &y, &rate);
    CHECK(n == 480 && rate == OTR_RATE, "wav read back");
    float err = 0;
    for (int i = 0; i < n; i++) err = fmaxf(err, fabsf(x[i] - y[i]));
    CHECK(err < 1.0f / 16000, "16-bit roundtrip: %.6f", err);
    free(y);
}

int main(void) {
    test_filters();
    test_dynamics();
    test_pitch();
    test_drift();
    test_feedback();
    test_proto();
    test_wav();
    printf("%d checks, %d failures\n", checks, failures);
    return failures ? 1 : 0;
}
