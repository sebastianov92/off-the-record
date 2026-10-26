/* The null device: no sound card. The "microphone" plays a WAV file in a loop
 * (or silence) in real time, the output is thrown away and pretends to hold a
 * steady queue. Enough to run the engine and its WebSocket on a Mac. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "audio_impl.h"
#include "otr.h"
#include "wav.h"

typedef struct {
    float *wav;
    int frames, pos;
    struct timespec next;
} null_dev;

static void advance(struct timespec *t) {
    t->tv_nsec += (long)OTR_BLOCK * 1000000000L / OTR_RATE;
    while (t->tv_nsec >= 1000000000L) {
        t->tv_nsec -= 1000000000L;
        t->tv_sec++;
    }
}

void *null_open(const audio_config *cfg, audio_input_info *in, audio_output_info *out, const char **error) {
    null_dev *a = calloc(1, sizeof(*a));
    if (cfg->input_wav) {
        int rate = 0;
        a->frames = wav_read(cfg->input_wav, &a->wav, &rate);
        if (a->frames <= 0 || rate != OTR_RATE) {
            *error = "input-wav";
            free(a->wav);
            free(a);
            return NULL;
        }
    }
    snprintf(in->name, sizeof(in->name), "%s", cfg->input_wav ? "WAV file" : "silence");
    in->card = -1;
    snprintf(out->pcm, sizeof(out->pcm), "null");
    out->period = 512;
    out->buffer = 2048;
    clock_gettime(CLOCK_MONOTONIC, &a->next);
    return a;
}

int null_read(void *dev, float *mono) {
    null_dev *a = dev;
    advance(&a->next);
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    long long wait = (a->next.tv_sec - now.tv_sec) * 1000000000LL + (a->next.tv_nsec - now.tv_nsec);
    if (wait > 0) {
        struct timespec d = {(time_t)(wait / 1000000000LL), (long)(wait % 1000000000LL)};
        nanosleep(&d, NULL);
    }
    for (int i = 0; i < OTR_BLOCK; i++) {
        mono[i] = a->wav ? a->wav[a->pos] : 0;
        if (a->wav && ++a->pos >= a->frames) a->pos = 0;
    }
    return 0;
}

int null_write(void *dev, const float *mono, int frames) {
    (void)dev;
    (void)mono;
    return frames;
}

int null_queued(void *dev) {
    (void)dev;
    return 768;
}

void null_close(void *dev) {
    null_dev *a = dev;
    free(a->wav);
    free(a);
}
