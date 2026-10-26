#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "audio_impl.h"

struct audio {
    int alsa;
    void *dev;
};

audio *audio_open(const audio_config *cfg, audio_input_info *in, audio_output_info *out, const char **error) {
    audio *a = calloc(1, sizeof(*a));
    *error = NULL;
#ifdef OTR_ALSA
    if (!strcmp(cfg->backend, "alsa")) {
        a->alsa = 1;
        a->dev = alsa_open(cfg, in, out, error);
    } else
#endif
        a->dev = null_open(cfg, in, out, error);
    if (!a->dev) {
        if (!*error) *error = "audio";
        free(a);
        return NULL;
    }
    return a;
}

#ifdef OTR_ALSA
#define PICK(fn, ...) (a->alsa ? alsa_##fn(__VA_ARGS__) : null_##fn(__VA_ARGS__))
#else
#define PICK(fn, ...) null_##fn(__VA_ARGS__)
#endif

int audio_read(audio *a, float *mono) { return PICK(read, a->dev, mono); }
int audio_write(audio *a, const float *mono, int frames) { return PICK(write, a->dev, mono, frames); }
int audio_queued(audio *a) { return PICK(queued, a->dev); }

void audio_close(audio *a) {
    if (!a) return;
#ifdef OTR_ALSA
    if (a->alsa) alsa_close(a->dev);
    else
#endif
        null_close(a->dev);
    free(a);
}

int audio_probe(char *out, int size) {
#ifdef OTR_ALSA
    return alsa_probe(out, size);
#else
    return snprintf(out, size, "{\"cards\":[]}");
#endif
}
