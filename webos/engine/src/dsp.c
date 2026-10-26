/* The voice chain. Filters are RBJ cookbook biquads; dynamics use simple
 * peak/RMS envelopes with attack/release coefficients. Order (PROTOCOL.md):
 * trim, high-pass, [tap], expander, notches, EQ, compressor, de-esser, echo and
 * reverb sends, mic volume, limiter. */
#include "dsp.h"

#include <math.h>
#include <string.h>

#define PI 3.14159265358979f

static float coef(float ms) { return expf(-1.0f / (0.001f * ms * OTR_RATE)); }
static float lin_to_db(float x) { return 20.0f * log10f(x + 1e-12f); }

void biquad_identity(biquad *f) {
    f->b0 = 1; f->b1 = f->b2 = f->a1 = f->a2 = 0;
}

static void set(biquad *f, float b0, float b1, float b2, float a0, float a1, float a2) {
    f->b0 = b0 / a0; f->b1 = b1 / a0; f->b2 = b2 / a0;
    f->a1 = a1 / a0; f->a2 = a2 / a0;
}

void biquad_highpass(biquad *f, float hz, float q) {
    float w = 2 * PI * hz / OTR_RATE, cs = cosf(w), al = sinf(w) / (2 * q);
    set(f, (1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al);
}

void biquad_lowpass(biquad *f, float hz, float q) {
    float w = 2 * PI * hz / OTR_RATE, cs = cosf(w), al = sinf(w) / (2 * q);
    set(f, (1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + al, -2 * cs, 1 - al);
}

void biquad_bandpass(biquad *f, float hz, float q) {
    float w = 2 * PI * hz / OTR_RATE, cs = cosf(w), al = sinf(w) / (2 * q);
    set(f, al, 0, -al, 1 + al, -2 * cs, 1 - al);
}

void biquad_peak(biquad *f, float hz, float q, float db) {
    float A = powf(10, db / 40), w = 2 * PI * hz / OTR_RATE, cs = cosf(w), al = sinf(w) / (2 * q);
    set(f, 1 + al * A, -2 * cs, 1 - al * A, 1 + al / A, -2 * cs, 1 - al / A);
}

/* Shelves with slope S = 1: alpha = sin(w) / 2 * sqrt(2). */
void biquad_lowshelf(biquad *f, float hz, float db) {
    float A = powf(10, db / 40), w = 2 * PI * hz / OTR_RATE, cs = cosf(w);
    float s = 2 * sqrtf(A) * sinf(w) / 2 * sqrtf(2);
    set(f, A * ((A + 1) - (A - 1) * cs + s), 2 * A * ((A - 1) - (A + 1) * cs), A * ((A + 1) - (A - 1) * cs - s),
        (A + 1) + (A - 1) * cs + s, -2 * ((A - 1) + (A + 1) * cs), (A + 1) + (A - 1) * cs - s);
}

void biquad_highshelf(biquad *f, float hz, float db) {
    float A = powf(10, db / 40), w = 2 * PI * hz / OTR_RATE, cs = cosf(w);
    float s = 2 * sqrtf(A) * sinf(w) / 2 * sqrtf(2);
    set(f, A * ((A + 1) + (A - 1) * cs + s), -2 * A * ((A - 1) + (A + 1) * cs), A * ((A + 1) + (A - 1) * cs - s),
        (A + 1) - (A - 1) * cs + s, 2 * ((A - 1) - (A + 1) * cs), (A + 1) - (A - 1) * cs - s);
}

float biquad_run(biquad *f, float x) {
    /* Transposed direct form II. */
    float y = f->b0 * x + f->z1;
    f->z1 = f->b1 * x - f->a1 * y + f->z2;
    f->z2 = f->b2 * x - f->a2 * y;
    return y;
}

float biquad_response_db(const biquad *f, float hz) {
    float w = 2 * PI * hz / OTR_RATE;
    float c1 = cosf(w), s1 = sinf(w), c2 = cosf(2 * w), s2 = sinf(2 * w);
    float nr = f->b0 + f->b1 * c1 + f->b2 * c2, ni = -(f->b1 * s1 + f->b2 * s2);
    float dr = 1 + f->a1 * c1 + f->a2 * c2, di = -(f->a1 * s1 + f->a2 * s2);
    return 10.0f * log10f((nr * nr + ni * ni) / (dr * dr + di * di));
}

static const float EQ_HZ[OTR_EQ_BANDS] = {120, 300, 1200, 3500, 9000};
static const int COMB_TUNING[DSP_COMBS] = {1557, 1617, 1491, 1422}; /* Freeverb's, at 48 kHz */
static const int AP_TUNING[DSP_ALLPASSES] = {556, 441};

void dsp_init(dsp_chain *c) {
    memset(c, 0, sizeof(*c));
    for (int i = 0; i < DSP_MAX_NOTCHES; i++) biquad_identity(&c->notch[i]);
    for (int i = 0; i < DSP_COMBS; i++) c->comb_len[i] = COMB_TUNING[i];
    for (int i = 0; i < DSP_ALLPASSES; i++) c->ap_len[i] = AP_TUNING[i];
    biquad_lowpass(&c->echo_damp, 4500, 0.707f);
    biquad_bandpass(&c->ess_detect, 6500, 1.2f);
    biquad_identity(&c->ess_shelf);
    c->gate_gain = 1;
    c->lim_gain = 1;
    c->duck_gain = 1;
    otr_params p;
    otr_params_default(&p);
    dsp_set_params(c, &p);
    c->out_gain = c->out_target;
}

/* Mic volume 0..100: 70 is unity, each step 0.4 dB, 0 is silence. */
static float volume_gain(float v) {
    if (v <= 0) return 0;
    return otr_db_to_gain((v - 70.0f) * 0.4f);
}

void dsp_set_params(dsp_chain *c, const otr_params *p) {
    c->params = *p;
    c->trim = otr_db_to_gain(p->input_gain_db);
    if (p->hpf) biquad_highpass(&c->hpf, 90, 0.707f);
    else biquad_identity(&c->hpf);
    biquad_lowshelf(&c->eq[0], EQ_HZ[0], p->eq_db[0]);
    for (int i = 1; i < 4; i++) biquad_peak(&c->eq[i], EQ_HZ[i], 1.0f, p->eq_db[i]);
    biquad_highshelf(&c->eq[4], EQ_HZ[4], p->eq_db[4]);
    /* Half of the gain the compressor takes at 0 dBFS comes back as makeup. */
    c->comp_makeup = otr_db_to_gain(-p->comp_threshold_db * (1 - 1 / p->comp_ratio) * 0.5f);
    c->out_target = p->mute ? 0 : volume_gain(p->mic_volume);
}

void dsp_set_notches(dsp_chain *c, const dsp_notch *notches, int duck) {
    for (int i = 0; i < DSP_MAX_NOTCHES; i++) {
        if (notches[i].freq == c->notch_now[i].freq && notches[i].gain_db == c->notch_now[i].gain_db) continue;
        c->notch_now[i] = notches[i];
        float z1 = c->notch[i].z1, z2 = c->notch[i].z2;
        if (notches[i].gain_db < 0) biquad_peak(&c->notch[i], notches[i].freq, DSP_NOTCH_Q, notches[i].gain_db);
        else biquad_identity(&c->notch[i]);
        c->notch[i].z1 = z1;
        c->notch[i].z2 = z2;
    }
    if (duck) c->duck_samples = OTR_RATE; /* -12 dB for a second */
}

float dsp_limit(float *lim_gain, float x, float ceiling) {
    /* Instant attack, 60 ms release: never over the ceiling, no lookahead delay. */
    float a = fabsf(x) * *lim_gain;
    if (a > ceiling) *lim_gain = ceiling / fabsf(x);
    float y = x * *lim_gain;
    *lim_gain += (1.0f - *lim_gain) * (1.0f - coef(60));
    /* Soft knee for anything the gain could not catch in one sample. */
    if (y > ceiling) y = ceiling;
    else if (y < -ceiling) y = -ceiling;
    return y;
}

void dsp_process(dsp_chain *c, float *buf, int n, float *tap) {
    const otr_params *p = &c->params;
    const float gate_att = coef(1), gate_rel = coef(100), gate_smooth = coef(5);
    const float comp_att = coef(5), comp_rel = coef(120);
    const float ess_att = coef(2), ess_rel = coef(80);
    const float gate_th = p->gate_threshold_db, gate_range = p->gate_range_db;
    const float hold_samples = 0.120f * OTR_RATE;
    const int echo_delay = (int)fminf(DSP_ECHO_MAX - 1, fmaxf(1, p->echo_delay_ms * 0.001f * OTR_RATE));
    const float room = 0.70f + 0.28f * p->reverb_size, damp = 0.4f;
    const float ceiling = otr_db_to_gain(-1.0f);
    float gate_min_db = 0, gr_max = 0;

    /* The de-esser shelf moves with the sibilance it found last block. */
    biquad_highshelf(&c->ess_shelf, 5000, -c->ess_gr_db);

    for (int i = 0; i < n; i++) {
        float x = buf[i] * c->trim;
        x = biquad_run(&c->hpf, x);
        if (tap) tap[i] = x;

        /* Downward expander, 1:4 below the threshold, with hold. */
        float ax = fabsf(x);
        c->gate_env = ax > c->gate_env ? gate_att * c->gate_env + (1 - gate_att) * ax : gate_rel * c->gate_env + (1 - gate_rel) * ax;
        float level = lin_to_db(c->gate_env);
        float target_db = 0;
        if (level >= gate_th) c->gate_hold = hold_samples;
        else if (c->gate_hold > 0) c->gate_hold--;
        else target_db = fmaxf(-gate_range, (level - gate_th) * 3.0f);
        float target = otr_db_to_gain(target_db);
        c->gate_gain = gate_smooth * c->gate_gain + (1 - gate_smooth) * target;
        if (target_db < gate_min_db) gate_min_db = target_db;
        x *= c->gate_gain;

        for (int k = 0; k < DSP_MAX_NOTCHES; k++)
            if (c->notch_now[k].gain_db < 0) x = biquad_run(&c->notch[k], x);
        for (int k = 0; k < OTR_EQ_BANDS; k++) x = biquad_run(&c->eq[k], x);

        /* Compressor: feed-forward, soft knee 6 dB. */
        float cx = fabsf(x);
        c->comp_env = cx > c->comp_env ? comp_att * c->comp_env + (1 - comp_att) * cx : comp_rel * c->comp_env + (1 - comp_rel) * cx;
        float env_db = lin_to_db(c->comp_env), over = env_db - p->comp_threshold_db, gr = 0;
        if (over > 3) gr = over * (1 - 1 / p->comp_ratio);
        else if (over > -3) gr = (1 - 1 / p->comp_ratio) * (over + 3) * (over + 3) / 12;
        c->comp_gr_db = gr;
        if (gr > gr_max) gr_max = gr;
        x *= otr_db_to_gain(-gr) * c->comp_makeup;

        /* De-esser: measure the sibilance band against the whole voice. */
        float s = fabsf(biquad_run(&c->ess_detect, x));
        c->ess_env = s > c->ess_env ? ess_att * c->ess_env + (1 - ess_att) * s : ess_rel * c->ess_env + (1 - ess_rel) * s;
        c->ess_ref = 0.999f * c->ess_ref + 0.001f * fabsf(x);
        x = biquad_run(&c->ess_shelf, x);

        /* Echo and reverb are sends: the dry voice is never delayed. */
        float echoed = c->echo_line[(c->echo_pos - echo_delay + DSP_ECHO_MAX) % DSP_ECHO_MAX];
        c->echo_line[c->echo_pos] = x + biquad_run(&c->echo_damp, echoed) * p->echo_feedback;
        c->echo_pos = (c->echo_pos + 1) % DSP_ECHO_MAX;

        float wet = 0, rin = x * 0.015f;
        for (int k = 0; k < DSP_COMBS; k++) {
            float out = c->comb_buf[k][c->comb_pos[k]];
            c->comb_store[k] = out * (1 - damp) + c->comb_store[k] * damp;
            c->comb_buf[k][c->comb_pos[k]] = rin + c->comb_store[k] * room;
            if (++c->comb_pos[k] >= c->comb_len[k]) c->comb_pos[k] = 0;
            wet += out;
        }
        for (int k = 0; k < DSP_ALLPASSES; k++) {
            float bufout = c->ap_buf[k][c->ap_pos[k]];
            float out = -wet + bufout;
            c->ap_buf[k][c->ap_pos[k]] = wet + bufout * 0.5f;
            if (++c->ap_pos[k] >= c->ap_len[k]) c->ap_pos[k] = 0;
            wet = out;
        }
        x = x + echoed * p->echo_mix + wet * p->reverb_mix * 3.0f;

        /* Volume (ramped, so mute and slider moves never click), duck, limiter. */
        c->out_gain += (c->out_target - c->out_gain) * 0.002f;
        if (c->duck_samples > 0) {
            c->duck_samples--;
            c->duck_gain = 0.995f * c->duck_gain + 0.005f * 0.25f;
        } else {
            c->duck_gain = 0.999f * c->duck_gain + 0.001f;
        }
        x *= c->out_gain * c->duck_gain;
        buf[i] = dsp_limit(&c->lim_gain, x, ceiling);
    }

    /* Sibilance well over the voice's own top end turns the shelf down, up to
     * 12 dB at full amount. */
    float ratio_db = lin_to_db(c->ess_env) - lin_to_db(c->ess_ref) + 6;
    float want = fmaxf(0, ratio_db) * 2.0f * p->deesser_amount;
    if (want > 12 * p->deesser_amount) want = 12 * p->deesser_amount;
    c->ess_gr_db += (want - c->ess_gr_db) * 0.3f;
    c->meter_gate_db = gate_min_db;
    c->meter_gr_db = gr_max;
}
