/* ALSA on the TV, through tinyalsa (no libasound: the binary is static). The
 * USB microphone is found by name in /proc/asound/cards, so its card number can
 * change. The TV output is a PCM of the ADSP that PulseAudio does not hold
 * (it plays app audio on 0,6). The ADSP only takes 512-frame periods; tinyalsa
 * sets exactly what it is asked, so every size here comes from the PCM's own
 * limits. */
#ifdef OTR_ALSA
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <tinyalsa/asoundlib.h>

#include "audio_impl.h"
#include "otr.h"

typedef struct {
    struct pcm *cap, *play;
    int cap_channels, play_channels;
    int play_buffer;
    short in16[OTR_BLOCK * 8];
    short out16[OTR_BLOCK * 2 * 4];
} alsa_dev;

static int exists(const char *path) {
    struct stat st;
    return stat(path, &st) == 0;
}

/* The first USB audio card with the given direction ('c' or 'p'), skipping `skip`. */
static int find_usb(char dir, int skip, char *name, size_t size) {
    FILE *f = fopen("/proc/asound/cards", "r");
    if (!f) return -1;
    char line[256];
    int found = -1;
    while (fgets(line, sizeof(line), f)) {
        int card;
        if (sscanf(line, " %d [", &card) != 1 || !strstr(line, "USB-Audio") || card == skip) continue;
        char path[64];
        snprintf(path, sizeof(path), "/dev/snd/pcmC%dD0%c", card, dir);
        if (!exists(path)) continue;
        const char *dash = strstr(line, " - ");
        if (name) {
            snprintf(name, size, "%s", dash ? dash + 3 : line);
            name[strcspn(name, "\n")] = 0;
        }
        found = card;
        break;
    }
    fclose(f);
    return found;
}

static unsigned clampu(unsigned v, unsigned lo, unsigned hi) { return v < lo ? lo : v > hi ? hi : v; }

/* The TV's outputs, quickest first. hw:0,7 is LG's speech path: with the sound
 * mode settled on game it is heard 70 ms after the mic against 120 through 0,5.
 * The TV's spoken guidance may be holding it; then 0,5 does. */
static const int TV_DEVICES[] = {7, 5};

static struct pcm *open_pcm(int card, int device, unsigned flags, unsigned want_period, unsigned periods,
                            unsigned start, int *channels, const char **error) {
    struct pcm_params *pp = pcm_params_get(card, device, flags);
    if (!pp) {
        *error = flags & PCM_IN ? "mic-missing" : "output-missing";
        return NULL;
    }
    unsigned chmin = pcm_params_get_min(pp, PCM_PARAM_CHANNELS);
    unsigned chmax = pcm_params_get_max(pp, PCM_PARAM_CHANNELS);
    unsigned pmin = pcm_params_get_min(pp, PCM_PARAM_PERIOD_SIZE);
    unsigned pmax = pcm_params_get_max(pp, PCM_PARAM_PERIOD_SIZE);
    pcm_params_free(pp);
    struct pcm_config cfg = {0};
    /* Mono in when the device allows it; out, stereo when it can (the ADSP mixes it down). */
    cfg.channels = flags & PCM_IN ? chmin : clampu(2, chmin, chmax);
    cfg.rate = OTR_RATE;
    cfg.format = PCM_FORMAT_S16_LE;
    cfg.period_size = clampu(want_period, pmin, pmax);
    cfg.period_count = periods;
    cfg.start_threshold = start ? start : cfg.period_size;
    cfg.stop_threshold = cfg.period_size * periods;
    cfg.avail_min = flags & PCM_IN ? cfg.period_size : 1;
    struct pcm *pcm = pcm_open(card, device, flags, &cfg);
    if (!pcm || !pcm_is_ready(pcm)) {
        fprintf(stderr, "otr-mic: pcm %d,%d: %s\n", card, device, pcm ? pcm_get_error(pcm) : "?");
        *error = flags & PCM_IN ? "mic-busy" : "output-busy";
        if (pcm) pcm_close(pcm);
        return NULL;
    }
    *channels = cfg.channels;
    return pcm;
}

/* Opens `*device` on `card`, or with -1 the first free of TV_DEVICES, which it
 * then stores in `*device`. */
static struct pcm *open_output(int card, int *device, unsigned period, unsigned periods, unsigned start,
                               int *channels, const char **error) {
    if (*device >= 0) return open_pcm(card, *device, PCM_OUT, period, periods, start, channels, error);
    for (size_t i = 0; i < sizeof(TV_DEVICES) / sizeof(*TV_DEVICES); i++) {
        struct pcm *pcm = open_pcm(card, TV_DEVICES[i], PCM_OUT, period, periods, start, channels, error);
        if (pcm) {
            *device = TV_DEVICES[i];
            return pcm;
        }
    }
    return NULL;
}

static void set_mic_gain(int card, int gain) {
    if (gain < 0) return;
    struct mixer *m = mixer_open(card);
    if (!m) return;
    struct mixer_ctl *ctl = mixer_get_ctl_by_name(m, "Mic Capture Volume");
    if (ctl) {
        for (unsigned i = 0; i < mixer_ctl_get_num_values(ctl); i++) mixer_ctl_set_value(ctl, i, gain);
    }
    mixer_close(m);
}

void *alsa_open(const audio_config *cfg, audio_input_info *in, audio_output_info *out, const char **error) {
    alsa_dev *a = calloc(1, sizeof(*a));
    int mic = find_usb('c', -1, in->name, sizeof(in->name));
    if (mic < 0) {
        *error = "mic-missing";
        free(a);
        return NULL;
    }
    in->card = mic;
    set_mic_gain(mic, cfg->mic_gain);
    a->cap = open_pcm(mic, 0, PCM_IN, OTR_BLOCK, 4, 1, &a->cap_channels, error);
    if (!a->cap) {
        free(a);
        return NULL;
    }
    if (cfg->output != OUT_OFF) {
        int card = cfg->tv_card, device = cfg->tv_device;
        unsigned period = 512, periods = 4, start = 384;
        if (cfg->output == OUT_USB) {
            /* A USB sound card on its own; a headset's own output if that is all there is. */
            card = find_usb('p', mic, NULL, 0);
            if (card < 0) card = find_usb('p', -1, NULL, 0);
            if (card < 0) {
                *error = "usb-output-missing";
                pcm_close(a->cap);
                free(a);
                return NULL;
            }
            device = 0;
            period = 128;
            periods = 3;
            start = 256;
        }
        a->play = open_output(card, &device, period, periods, start, &a->play_channels, error);
        if (!a->play) {
            pcm_close(a->cap);
            free(a);
            return NULL;
        }
        a->play_buffer = (int)pcm_get_buffer_size(a->play);
        snprintf(out->pcm, sizeof(out->pcm), "hw:%d,%d", card, device);
        out->period = (int)(a->play_buffer / periods);
        out->buffer = a->play_buffer;
    } else {
        snprintf(out->pcm, sizeof(out->pcm), "off");
    }
    return a;
}

int alsa_read(void *dev, float *mono) {
    alsa_dev *a = dev;
    for (int tries = 0; tries < 3; tries++) {
        int r = pcm_readi(a->cap, a->in16, OTR_BLOCK);
        if (r == OTR_BLOCK) {
            for (int i = 0; i < OTR_BLOCK; i++) mono[i] = a->in16[i * a->cap_channels] / 32768.0f;
            return 0;
        }
        if (r == -EPIPE || r == -ESTRPIPE) {
            pcm_prepare(a->cap);
            continue;
        }
        if (r >= 0) continue;
        return -1; /* -ENODEV, -EIO: the microphone was unplugged */
    }
    return -1;
}

int alsa_write(void *dev, const float *mono, int frames) {
    alsa_dev *a = dev;
    if (!a->play) return frames;
    for (int i = 0; i < frames; i++) {
        float v = mono[i] > 1 ? 1 : mono[i] < -1 ? -1 : mono[i];
        short s = (short)(v * 32767);
        for (int c = 0; c < a->play_channels; c++) a->out16[i * a->play_channels + c] = s;
    }
    int r = pcm_writei(a->play, a->out16, frames);
    if (r == -EPIPE) {
        /* Underrun: start over; the next writes refill to the start threshold. */
        pcm_prepare(a->play);
        r = pcm_writei(a->play, a->out16, frames);
    }
    return r;
}

int alsa_queued(void *dev) {
    alsa_dev *a = dev;
    if (!a->play) return 0;
    unsigned avail = 0;
    struct timespec ts;
    if (pcm_get_htimestamp(a->play, &avail, &ts) < 0) return -1;
    return a->play_buffer - (int)avail;
}

void alsa_close(void *dev) {
    alsa_dev *a = dev;
    if (a->cap) pcm_close(a->cap);
    if (a->play) pcm_close(a->play);
    free(a);
}

/* Every card and PCM, with the limits each accepts, as JSON. */
int alsa_probe(char *out, int size) {
    int n = snprintf(out, size, "{\"cards\":[");
    FILE *f = fopen("/proc/asound/cards", "r");
    char line[256];
    int first = 1;
    while (f && fgets(line, sizeof(line), f)) {
        int card;
        if (sscanf(line, " %d [", &card) != 1) continue;
        line[strcspn(line, "\n")] = 0;
        n += snprintf(out + n, size - n, "%s{\"card\":%d,\"line\":\"%s\",\"pcms\":[", first ? "" : ",", card, line + 4);
        first = 0;
        int pfirst = 1;
        for (int dev = 0; dev < 16; dev++) {
            for (int d = 0; d < 2; d++) {
                char path[64];
                snprintf(path, sizeof(path), "/dev/snd/pcmC%dD%d%c", card, dev, d ? 'c' : 'p');
                if (!exists(path)) continue;
                struct pcm_params *pp = pcm_params_get(card, dev, d ? PCM_IN : PCM_OUT);
                n += snprintf(out + n, size - n, "%s{\"device\":%d,\"dir\":\"%s\"", pfirst ? "" : ",", dev, d ? "in" : "out");
                pfirst = 0;
                if (pp) {
                    n += snprintf(out + n, size - n,
                                  ",\"rate\":[%u,%u],\"channels\":[%u,%u],\"period\":[%u,%u],\"periods\":[%u,%u]",
                                  pcm_params_get_min(pp, PCM_PARAM_RATE), pcm_params_get_max(pp, PCM_PARAM_RATE),
                                  pcm_params_get_min(pp, PCM_PARAM_CHANNELS), pcm_params_get_max(pp, PCM_PARAM_CHANNELS),
                                  pcm_params_get_min(pp, PCM_PARAM_PERIOD_SIZE), pcm_params_get_max(pp, PCM_PARAM_PERIOD_SIZE),
                                  pcm_params_get_min(pp, PCM_PARAM_PERIODS), pcm_params_get_max(pp, PCM_PARAM_PERIODS));
                    pcm_params_free(pp);
                } else {
                    n += snprintf(out + n, size - n, ",\"busy\":true");
                }
                n += snprintf(out + n, size - n, "}");
                if (n > size - 512) break;
            }
        }
        n += snprintf(out + n, size - n, "]}");
    }
    if (f) fclose(f);
    n += snprintf(out + n, size - n, "]}");
    return n;
}
#endif
