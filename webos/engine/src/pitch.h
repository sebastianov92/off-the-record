/* The singer's pitch: YIN with the same constants as the splash's
 * pitch-worklet.js, so the score means the same from a phone and from the TV.
 * Plus a plain onset detector, for timing calibration. */
#ifndef OTR_PITCH_H
#define OTR_PITCH_H

#define YIN_DECIMATE 2
#define YIN_WINDOW 1024
#define YIN_MIN_HZ 70.0f
#define YIN_MAX_HZ 1000.0f
#define YIN_THRESHOLD 0.2f
#define YIN_SILENCE_RMS 0.012f

typedef struct {
    float rate; /* decimated rate */
    float buffer[YIN_WINDOW]; /* the window in time order, built for each frame */
    float ring[YIN_WINDOW];
    int head; /* next write position in ring */
    int filled;
    int since_frame; /* 48 kHz samples since the last frame */
    float carry;
    int carry_count;
    int tau_min, tau_max;
    float diff[1024];
} yin_state;

void yin_init(yin_state *y);
/* YIN on the current window; the window itself, for tests. */
float yin_pitch(const yin_state *y, float *rms_out);
/* Feeds 48 kHz samples; every OTR_HOP samples (once the window is full) writes
 * one frame (fractional MIDI, 0 = silence or unvoiced). Returns frames written. */
int yin_push(yin_state *y, const float *x, int n, float *midi_out, float *rms_out, int max_frames);

typedef struct {
    float floor_energy;
    float prev_energy;
    float acc;
    int count;
    long long sample;   /* 48 kHz samples seen */
    long long last_onset;
} onset_state;

void onset_init(onset_state *o);
/* Returns how many onsets it found in x; their sample positions go to out. */
int onset_push(onset_state *o, const float *x, int n, long long *out, int max);

#endif
