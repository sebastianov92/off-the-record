/* Shared constants and the voice parameters the app sends (PROTOCOL.md). */
#ifndef OTR_H
#define OTR_H

#include <math.h>

#define OTR_RATE 48000
#define OTR_BLOCK 128          /* frames per audio-thread step: 2.7 ms */
#define OTR_HOP 960            /* pitch frame hop at 48 kHz: 20 ms, 50 frames/s */
#define OTR_PROTO 1
#define OTR_VERSION "0.1.0"
#define OTR_EQ_BANDS 5

typedef struct {
    float input_gain_db;
    int hpf;
    float gate_threshold_db, gate_range_db;
    float eq_db[OTR_EQ_BANDS]; /* low shelf 120 Hz, peaks 300 / 1200 / 3500 Hz, high shelf 9 kHz */
    float comp_threshold_db, comp_ratio;
    float deesser_amount;      /* 0..1 */
    float echo_mix, echo_delay_ms, echo_feedback;
    float reverb_mix, reverb_size;
    int antifeedback;
    float mic_volume;          /* 0..100; 70 is unity */
    int mute;
} otr_params;

void otr_params_default(otr_params *p);
void otr_params_clamp(otr_params *p);

static inline float otr_db_to_gain(float db) { return powf(10.0f, db / 20.0f); }

#endif
