/* The microphone and the TV run on separate clocks (~100 ppm apart), so the
 * playback queue slowly fills or drains. Watch its lowest point over half a
 * second (the ADSP drains it 512 frames at a time, a sawtooth) and, when that
 * leaves its band, drop or repeat one block with a crossfade. */
#ifndef OTR_DRIFT_H
#define OTR_DRIFT_H

#include "otr.h"

#define DRIFT_FADE 64

typedef struct {
    int low, high;      /* band for the queue's trough, in frames */
    int window;         /* blocks per trough measurement */
    int seen, trough;
    int cooldown;       /* blocks to wait after a slip */
} drift_state;

void drift_init(drift_state *d, int low, int high);
/* Called once per block with the frames still queued for playback.
 * Returns -1 to drop this block, +1 to repeat it, 0 to just play it. */
int drift_update(drift_state *d, int queued);

/* Dropping block `dropped`: the next block fades in from it, so the output
 * moves on without a jump. */
void drift_crossfade_drop(const float *dropped, float *next, int n);
/* Repeating `block`: the first copy fades out at its end and the second fades
 * in, a 2.7 ms dip instead of a click. */
void drift_repeat(const float *block, float *first, float *second, int n);

#endif
