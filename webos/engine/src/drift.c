#include "drift.h"

void drift_init(drift_state *d, int low, int high) {
    d->low = low;
    d->high = high;
    d->window = OTR_RATE / 2 / OTR_BLOCK;
    d->seen = 0;
    d->trough = 1 << 30;
    d->cooldown = 0;
}

int drift_update(drift_state *d, int queued) {
    if (queued < d->trough) d->trough = queued;
    if (d->cooldown > 0) d->cooldown--;
    if (++d->seen < d->window) return 0;
    int trough = d->trough;
    d->seen = 0;
    d->trough = 1 << 30;
    if (d->cooldown > 0) return 0;
    if (trough < d->low) {
        d->cooldown = d->window * 2;
        return 1;
    }
    if (trough > d->high) {
        d->cooldown = d->window * 2;
        return -1;
    }
    return 0;
}

void drift_crossfade_drop(const float *dropped, float *next, int n) {
    for (int i = 0; i < DRIFT_FADE && i < n; i++) {
        float w = (i + 1) / (float)(DRIFT_FADE + 1);
        next[i] = dropped[i] * (1 - w) + next[i] * w;
    }
}

void drift_repeat(const float *block, float *first, float *second, int n) {
    for (int i = 0; i < n; i++) {
        first[i] = block[i];
        second[i] = block[i];
    }
    for (int i = 0; i < DRIFT_FADE && i < n; i++) {
        float w = (i + 1) / (float)(DRIFT_FADE + 1);
        first[n - 1 - i] *= w;
        second[i] *= w;
    }
}
