#include "feedback.h"

#include <math.h>
#include <string.h>

#include "fft.h"
#include "otr.h"

#define BIN_HZ ((float)OTR_RATE / FB_SIZE)
#define RELEASE_FRAMES (30 * OTR_RATE / FB_HOP) /* 30 s without a howl */

void feedback_init(feedback_state *f) {
    memset(f, 0, sizeof(*f));
    for (int i = 0; i < FB_SIZE; i++) f->window[i] = 0.5f - 0.5f * cosf(2 * (float)M_PI * i / (FB_SIZE - 1));
}

int feedback_active(const feedback_state *f) {
    int n = 0;
    for (int i = 0; i < DSP_MAX_NOTCHES; i++) n += f->notch[i].gain_db < 0;
    return n;
}

static float bin_db(const float *mag, int k) { return 20 * log10f(mag[k] + 1e-9f); }

/* Is `hz` one of the voice's harmonics? Sustained vowels are nearly pure tones
 * and would otherwise look exactly like feedback. */
static int voice_harmonic(float hz, float f0) {
    if (f0 <= 0) return 0;
    for (int h = 1; h <= 8; h++)
        if (fabsf(hz - h * f0) < 0.03f * h * f0) return 1;
    return 0;
}

static void cut(feedback_state *f, float hz) {
    int slot = -1;
    for (int i = 0; i < DSP_MAX_NOTCHES; i++) {
        if (f->notch[i].gain_db < 0 && fabsf(f->notch[i].freq - hz) < 0.02f * hz) {
            slot = i;
            /* Still there: cut deeper, down to -24 dB. */
            f->notch[i].gain_db = fmaxf(-24, f->notch[i].gain_db - 3);
            break;
        }
    }
    if (slot < 0) {
        long long oldest = -1;
        for (int i = 0; i < DSP_MAX_NOTCHES; i++) {
            if (f->notch[i].gain_db >= 0) { slot = i; break; }
            if (oldest < 0 || f->last_hit[i] < oldest) { oldest = f->last_hit[i]; slot = i; }
        }
        f->notch[slot].freq = hz;
        f->notch[slot].gain_db = -9;
    }
    f->last_hit[slot] = f->frame;
    f->changed = 1;
}

static void analyse(feedback_state *f, float f0) {
    static float re[FB_SIZE], im[FB_SIZE], mag[FB_SIZE / 2];
    for (int i = 0; i < FB_SIZE; i++) {
        re[i] = f->input[i] * f->window[i];
        im[i] = 0;
    }
    fft_inplace(re, im, FB_SIZE);
    /* Normalised so a full-scale sine reads 0 dB (Hann's coherent gain is 1/2). */
    for (int k = 0; k < FB_SIZE / 2; k++) mag[k] = sqrtf(re[k] * re[k] + im[k] * im[k]) / (FB_SIZE / 4);

    int lo = (int)(200 / BIN_HZ), hi = (int)(8000 / BIN_HZ);
    double total = 0;
    for (int k = lo; k <= hi; k++) total += mag[k] * mag[k];
    float avg_db = 10 * log10f((float)(total / (hi - lo + 1)) + 1e-18f);

    /* The three loudest local maxima. */
    int peaks[3] = {-1, -1, -1};
    for (int k = lo + 1; k < hi; k++) {
        if (mag[k] < mag[k - 1] || mag[k] < mag[k + 1]) continue;
        for (int p = 0; p < 3; p++) {
            if (peaks[p] < 0 || mag[k] > mag[peaks[p]]) {
                for (int q = 2; q > p; q--) peaks[q] = peaks[q - 1];
                peaks[p] = k;
                break;
            }
        }
    }
    int row = f->hist_pos;
    for (int p = 0; p < 3; p++) {
        f->hist_freq[row][p] = 0;
        f->hist_db[row][p] = -200;
        int k = peaks[p];
        if (k < 0) continue;
        float db = bin_db(mag, k);
        if (db < -30) continue;
        /* Narrow: well over the band's average and over its neighbours. */
        float papr = db - avg_db;
        float nb = fmaxf(bin_db(mag, k - 3), bin_db(mag, k + 3));
        float pnpr = db - nb;
        /* Harmonic-free: a voice or an instrument has partials, a howl does not. */
        float phpr = 200;
        int harmonics[3] = {k / 2, 2 * k, 3 * k};
        for (int h = 0; h < 3; h++) {
            int b = harmonics[h];
            if (b > 1 && b < FB_SIZE / 2 - 1) {
                float hb = fmaxf(bin_db(mag, b), fmaxf(bin_db(mag, b - 1), bin_db(mag, b + 1)));
                phpr = fminf(phpr, db - hb);
            }
        }
        if (papr > 10 && pnpr > 15 && phpr > 20) {
            /* Parabolic interpolation of the peak's frequency. */
            float a = bin_db(mag, k - 1), b = db, c = bin_db(mag, k + 1);
            float shift = 0.5f * (a - c) / (a - 2 * b + c + 1e-9f);
            f->hist_freq[row][p] = (k + shift) * BIN_HZ;
            f->hist_db[row][p] = db;
            if (db > -3) f->duck = 1;
        }
    }
    f->hist_pos = (f->hist_pos + 1) % FB_HISTORY;

    /* A howl stays: the same frequency in 6 of the last 8 frames, not dying away. */
    for (int p = 0; p < 3; p++) {
        float hz = f->hist_freq[row][p];
        if (hz <= 0 || voice_harmonic(hz, f0)) continue;
        int seen = 0;
        float oldest_db = f->hist_db[row][p];
        for (int r = 0; r < FB_HISTORY; r++) {
            for (int q = 0; q < 3; q++) {
                if (f->hist_freq[r][q] > 0 && fabsf(f->hist_freq[r][q] - hz) < 1.5f * BIN_HZ) {
                    seen++;
                    int age = (row - r + FB_HISTORY) % FB_HISTORY;
                    if (age == 3) oldest_db = f->hist_db[r][q];
                    break;
                }
            }
        }
        if (seen >= 6 && f->hist_db[row][p] >= oldest_db - 1) cut(f, hz);
    }

    /* Let go of notches that have not been needed for a while, 1 dB at a time. */
    for (int i = 0; i < DSP_MAX_NOTCHES; i++) {
        if (f->notch[i].gain_db < 0 && f->frame - f->last_hit[i] > RELEASE_FRAMES && f->frame % 47 == 0) {
            f->notch[i].gain_db = fminf(0, f->notch[i].gain_db + 1);
            f->changed = 1;
        }
    }
}

int feedback_push(feedback_state *f, const float *x, int n, float f0, int enabled) {
    f->changed = 0;
    for (int i = 0; i < n; i++) {
        f->ring[f->head] = x[i];
        f->head = (f->head + 1) % FB_SIZE;
        if (f->filled < FB_SIZE) f->filled++;
        if (++f->since >= FB_HOP && f->filled == FB_SIZE) {
            f->since = 0;
            f->frame++;
            if (enabled) {
                int tail = FB_SIZE - f->head;
                memcpy(f->input, f->ring + f->head, tail * sizeof(float));
                memcpy(f->input + tail, f->ring, f->head * sizeof(float));
                analyse(f, f0);
            }
        }
    }
    if (!enabled && feedback_active(f)) {
        for (int i = 0; i < DSP_MAX_NOTCHES; i++) f->notch[i].gain_db = 0;
        f->changed = 1;
    }
    return f->changed;
}
