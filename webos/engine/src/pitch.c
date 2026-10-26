#include "pitch.h"

#include <math.h>
#include <string.h>

#include "otr.h"

void yin_init(yin_state *y) {
    memset(y, 0, sizeof(*y));
    y->rate = (float)OTR_RATE / YIN_DECIMATE;
    y->tau_min = (int)floorf(y->rate / YIN_MAX_HZ);
    y->tau_max = (int)ceilf(y->rate / YIN_MIN_HZ);
}

static void push_one(yin_state *y, float sample) {
    y->ring[y->head] = sample;
    y->head = (y->head + 1) % YIN_WINDOW;
    if (y->filled < YIN_WINDOW) y->filled++;
}

/* The ring in time order, oldest first, into y->buffer. */
static void linearise(yin_state *y) {
    int tail = YIN_WINDOW - y->head;
    memcpy(y->buffer, y->ring + y->head, tail * sizeof(float));
    memcpy(y->buffer + tail, y->ring, y->head * sizeof(float));
}

float yin_pitch(const yin_state *y, float *rms_out) {
    const float *x = y->buffer;
    float energy = 0;
    for (int i = 0; i < YIN_WINDOW; i++) energy += x[i] * x[i];
    float rms = sqrtf(energy / YIN_WINDOW);
    if (rms_out) *rms_out = rms;
    if (rms < YIN_SILENCE_RMS) return 0;

    float d[1024];
    int n = YIN_WINDOW - y->tau_max;
    float running = 0;
    d[0] = 1;
    for (int tau = 1; tau <= y->tau_max; tau++) {
        float sum = 0;
        for (int i = 0; i < n; i++) {
            float delta = x[i] - x[i + tau];
            sum += delta * delta;
        }
        running += sum;
        d[tau] = running ? sum * tau / running : 1;
    }
    int tau = -1;
    for (int t = y->tau_min; t < y->tau_max; t++) {
        if (d[t] < YIN_THRESHOLD) {
            while (t + 1 < y->tau_max && d[t + 1] < d[t]) t++;
            tau = t;
            break;
        }
    }
    if (tau < 0) return 0;
    float a = d[tau - 1], b = d[tau], c = d[tau + 1];
    float curve = a - 2 * b + c;
    float shift = curve ? 0.5f * (a - c) / curve : 0;
    float hz = y->rate / (tau + shift);
    return 69.0f + 12.0f * log2f(hz / 440.0f);
}

int yin_push(yin_state *y, const float *x, int n, float *midi_out, float *rms_out, int max_frames) {
    int frames = 0;
    for (int i = 0; i < n; i++) {
        /* Average pairs: a cheap low-pass before dropping every other sample. */
        y->carry += x[i];
        if (++y->carry_count == YIN_DECIMATE) {
            push_one(y, y->carry / YIN_DECIMATE);
            y->carry = 0;
            y->carry_count = 0;
        }
        if (++y->since_frame >= OTR_HOP && y->filled == YIN_WINDOW) {
            y->since_frame = 0;
            if (frames < max_frames) {
                float rms;
                linearise(y);
                midi_out[frames] = yin_pitch(y, &rms);
                if (rms_out) rms_out[frames] = rms;
                frames++;
            }
        }
    }
    return frames;
}

void onset_init(onset_state *o) {
    memset(o, 0, sizeof(*o));
    o->floor_energy = 1e-6f;
}

/* An onset is a 256-sample block 12 dB over both the slow floor and the block
 * before it; at most one every 100 ms. Enough for calibration clicks. */
int onset_push(onset_state *o, const float *x, int n, long long *out, int max) {
    int found = 0;
    for (int i = 0; i < n; i++) {
        o->acc += x[i] * x[i];
        o->sample++;
        if (++o->count < 256) continue;
        float e = o->acc / 256;
        if (e > o->floor_energy * 16 && e > o->prev_energy * 16 && e > 1e-5f &&
            o->sample - o->last_onset > OTR_RATE / 10 && found < max) {
            out[found++] = o->sample - 256;
            o->last_onset = o->sample;
        }
        o->floor_energy = 0.995f * o->floor_energy + 0.005f * e;
        o->prev_energy = e;
        o->acc = 0;
        o->count = 0;
    }
    return found;
}
