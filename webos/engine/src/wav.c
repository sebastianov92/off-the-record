#include "wav.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint32_t u32(const unsigned char *p) { return p[0] | p[1] << 8 | p[2] << 16 | (uint32_t)p[3] << 24; }
static uint16_t u16(const unsigned char *p) { return p[0] | p[1] << 8; }

int wav_read(const char *path, float **out, int *rate) {
    FILE *f = fopen(path, "rb");
    if (!f) return -1;
    unsigned char h[12];
    if (fread(h, 1, 12, f) != 12 || memcmp(h, "RIFF", 4) || memcmp(h + 8, "WAVE", 4)) {
        fclose(f);
        return -1;
    }
    int channels = 0, bits = 0, frames = -1;
    unsigned char ch[8];
    while (fread(ch, 1, 8, f) == 8) {
        uint32_t size = u32(ch + 4);
        if (!memcmp(ch, "fmt ", 4)) {
            unsigned char fmt[40] = {0};
            if (size > sizeof(fmt) || fread(fmt, 1, size, f) != size) break;
            channels = u16(fmt + 2);
            *rate = (int)u32(fmt + 4);
            bits = u16(fmt + 14);
        } else if (!memcmp(ch, "data", 4)) {
            if (bits != 16 || channels < 1) break;
            frames = (int)(size / (2 * channels));
            int16_t *raw = malloc(size);
            *out = malloc(sizeof(float) * (frames > 0 ? frames : 1));
            if (!raw || !*out || fread(raw, 1, size, f) != size) {
                free(raw);
                frames = -1;
                break;
            }
            for (int i = 0; i < frames; i++) (*out)[i] = raw[i * channels] / 32768.0f;
            free(raw);
            break;
        } else {
            fseek(f, size + (size & 1), SEEK_CUR);
        }
    }
    fclose(f);
    return frames;
}

static void put32(unsigned char *p, uint32_t v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }
static void put16(unsigned char *p, uint16_t v) { p[0] = v; p[1] = v >> 8; }

int wav_write(const char *path, const float *x, int frames, int rate) {
    FILE *f = fopen(path, "wb");
    if (!f) return -1;
    unsigned char h[44];
    memcpy(h, "RIFF", 4); put32(h + 4, 36 + frames * 2); memcpy(h + 8, "WAVEfmt ", 8);
    put32(h + 16, 16); put16(h + 20, 1); put16(h + 22, 1); put32(h + 24, rate);
    put32(h + 28, rate * 2); put16(h + 32, 2); put16(h + 34, 16);
    memcpy(h + 36, "data", 4); put32(h + 40, frames * 2);
    fwrite(h, 1, 44, f);
    for (int i = 0; i < frames; i++) {
        float v = x[i] > 1 ? 1 : x[i] < -1 ? -1 : x[i];
        int16_t s = (int16_t)(v * 32767);
        fwrite(&s, 2, 1, f);
    }
    fclose(f);
    return 0;
}
