/* Howl (acoustic feedback) suppression. Runs on the analysis thread: finds
 * narrow, steady, harmonic-free peaks that are not the singer's own notes, and
 * hands the audio thread a small bank of narrow notches to cut them. */
#ifndef OTR_FEEDBACK_H
#define OTR_FEEDBACK_H

#include "dsp.h"

#define FB_SIZE 2048
#define FB_HOP 1024
#define FB_HISTORY 8

typedef struct {
    float window[FB_SIZE];
    float input[FB_SIZE]; /* time order, built for each analysis */
    float ring[FB_SIZE];
    int head;
    int filled;
    int since;
    /* recent candidate peaks, per analysis frame */
    float hist_freq[FB_HISTORY][3];
    float hist_db[FB_HISTORY][3];
    int hist_pos;
    dsp_notch notch[DSP_MAX_NOTCHES];
    long long last_hit[DSP_MAX_NOTCHES]; /* analysis frame of the last detection */
    long long frame;
    int duck; /* set when a howl is already near full scale */
    int changed;
} feedback_state;

void feedback_init(feedback_state *f);
/* Feeds post-high-pass samples. `f0` is the singer's current pitch in Hz (0 if
 * unvoiced). Returns 1 when the notch bank changed. */
int feedback_push(feedback_state *f, const float *x, int n, float f0, int enabled);
int feedback_active(const feedback_state *f);

#endif
