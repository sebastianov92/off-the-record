/* The voice chain, block by block on the audio thread. Everything here is
 * allocation-free after dsp_init and runs at 48 kHz mono float. */
#ifndef OTR_DSP_H
#define OTR_DSP_H

#include "otr.h"

typedef struct {
    float b0, b1, b2, a1, a2;
    float z1, z2;
} biquad;

void biquad_highpass(biquad *f, float hz, float q);
void biquad_lowpass(biquad *f, float hz, float q);
void biquad_bandpass(biquad *f, float hz, float q);
void biquad_peak(biquad *f, float hz, float q, float db);
void biquad_lowshelf(biquad *f, float hz, float db);
void biquad_highshelf(biquad *f, float hz, float db);
void biquad_identity(biquad *f);
float biquad_run(biquad *f, float x);
/* |H(f)| in dB, for tests and for checking a design. */
float biquad_response_db(const biquad *f, float hz);

#define DSP_MAX_NOTCHES 6
#define DSP_NOTCH_Q 20.0f /* narrow enough to leave the voice, wide enough to catch a drifting howl */
#define DSP_ECHO_MAX (OTR_RATE) /* 1 s */
#define DSP_COMBS 4
#define DSP_ALLPASSES 2

typedef struct {
    float freq, gain_db; /* gain_db 0 = inactive */
} dsp_notch;

typedef struct {
    otr_params params;
    float trim;
    biquad hpf;
    /* expander */
    float gate_env, gate_gain, gate_hold;
    /* notches, set by the feedback analysis */
    biquad notch[DSP_MAX_NOTCHES];
    dsp_notch notch_now[DSP_MAX_NOTCHES];
    float duck_samples; /* emergency duck remaining */
    float duck_gain;
    biquad eq[OTR_EQ_BANDS];
    /* compressor */
    float comp_env, comp_gr_db, comp_makeup;
    /* de-esser */
    biquad ess_detect, ess_shelf;
    float ess_env, ess_gr_db, ess_ref;
    /* echo */
    float echo_line[DSP_ECHO_MAX];
    int echo_pos;
    biquad echo_damp;
    /* reverb (Freeverb-style, mono) */
    float comb_buf[DSP_COMBS][2048];
    int comb_len[DSP_COMBS], comb_pos[DSP_COMBS];
    float comb_store[DSP_COMBS];
    float ap_buf[DSP_ALLPASSES][1024];
    int ap_len[DSP_ALLPASSES], ap_pos[DSP_ALLPASSES];
    /* output */
    float out_gain, out_target;
    float lim_gain;
    /* metering of the last block */
    float meter_gate_db, meter_gr_db;
} dsp_chain;

void dsp_init(dsp_chain *c);
void dsp_set_params(dsp_chain *c, const otr_params *p);
void dsp_set_notches(dsp_chain *c, const dsp_notch *notches, int duck);
/* Processes in place. `tap` (may be NULL) gets the signal after the high-pass,
 * before any effect: what pitch and feedback detection listen to. */
void dsp_process(dsp_chain *c, float *buf, int n, float *tap);

/* The building blocks, also used on their own by tests. */
float dsp_limit(float *lim_gain, float x, float ceiling);

#endif
