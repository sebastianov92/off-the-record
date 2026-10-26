#include "proto.h"

#include <stdlib.h>
#include <string.h>

#define JSMN_STATIC
#include "jsmn.h"

void otr_params_default(otr_params *p) {
    memset(p, 0, sizeof(*p));
    p->input_gain_db = 0;
    p->hpf = 1;
    p->gate_threshold_db = -50;
    p->gate_range_db = 30;
    p->comp_threshold_db = -18;
    p->comp_ratio = 3;
    p->deesser_amount = 0.3f;
    p->echo_mix = 0.15f;
    p->echo_delay_ms = 120;
    p->echo_feedback = 0.25f;
    p->reverb_mix = 0.15f;
    p->reverb_size = 0.5f;
    p->antifeedback = 1;
    p->mic_volume = 70;
    p->mute = 0;
}

static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }

void otr_params_clamp(otr_params *p) {
    p->input_gain_db = clampf(p->input_gain_db, -24, 24);
    p->gate_threshold_db = clampf(p->gate_threshold_db, -90, 0);
    p->gate_range_db = clampf(p->gate_range_db, 0, 60);
    for (int i = 0; i < OTR_EQ_BANDS; i++) p->eq_db[i] = clampf(p->eq_db[i], -12, 12);
    p->comp_threshold_db = clampf(p->comp_threshold_db, -60, 0);
    p->comp_ratio = clampf(p->comp_ratio, 1, 20);
    p->deesser_amount = clampf(p->deesser_amount, 0, 1);
    p->echo_mix = clampf(p->echo_mix, 0, 1);
    p->echo_delay_ms = clampf(p->echo_delay_ms, 1, 900);
    p->echo_feedback = clampf(p->echo_feedback, 0, 0.8f);
    p->reverb_mix = clampf(p->reverb_mix, 0, 1);
    p->reverb_size = clampf(p->reverb_size, 0, 1);
    p->mic_volume = clampf(p->mic_volume, 0, 100);
}

typedef struct {
    const char *js;
    jsmntok_t *t;
    int n;
} doc;

static int eq(const doc *d, int i, const char *s) {
    int len = d->t[i].end - d->t[i].start;
    return d->t[i].type == JSMN_STRING && (int)strlen(s) == len && !strncmp(d->js + d->t[i].start, s, len);
}

/* Index just past token i and everything inside it. */
static int skip(const doc *d, int i) {
    int end = d->t[i].end;
    int j = i + 1;
    while (j < d->n && d->t[j].start < end) j++;
    return j;
}

/* The value token for `key` in the object at `obj`, or -1. */
static int field(const doc *d, int obj, const char *key) {
    if (obj < 0 || d->t[obj].type != JSMN_OBJECT) return -1;
    int i = obj + 1;
    for (int k = 0; k < d->t[obj].size && i < d->n; k++) {
        if (eq(d, i, key)) return i + 1;
        i = skip(d, i + 1);
    }
    return -1;
}

static int number(const doc *d, int i, float *out) {
    if (i < 0 || d->t[i].type != JSMN_PRIMITIVE) return 0;
    char buf[32];
    int len = d->t[i].end - d->t[i].start;
    if (len <= 0 || len >= (int)sizeof(buf)) return 0;
    memcpy(buf, d->js + d->t[i].start, len);
    buf[len] = 0;
    if (!strcmp(buf, "true")) { *out = 1; return 1; }
    if (!strcmp(buf, "false")) { *out = 0; return 1; }
    char *end;
    float v = strtof(buf, &end);
    if (end == buf) return 0;
    *out = v;
    return 1;
}

static void num(const doc *d, int obj, const char *key, float *dst) {
    float v;
    if (number(d, field(d, obj, key), &v)) *dst = v;
}

static void flag(const doc *d, int obj, const char *key, int *dst) {
    float v;
    if (number(d, field(d, obj, key), &v)) *dst = v != 0;
}

static void overlay(const doc *d, int root, otr_params *p) {
    num(d, root, "inputGain", &p->input_gain_db);
    flag(d, root, "hpf", &p->hpf);
    int gate = field(d, root, "gate");
    num(d, gate, "threshold", &p->gate_threshold_db);
    num(d, gate, "range", &p->gate_range_db);
    int eqv = field(d, root, "eq");
    if (eqv >= 0 && d->t[eqv].type == JSMN_ARRAY) {
        int i = eqv + 1;
        for (int k = 0; k < d->t[eqv].size && k < OTR_EQ_BANDS; k++) {
            number(d, i, &p->eq_db[k]);
            i = skip(d, i);
        }
    }
    int comp = field(d, root, "comp");
    num(d, comp, "threshold", &p->comp_threshold_db);
    num(d, comp, "ratio", &p->comp_ratio);
    num(d, field(d, root, "deesser"), "amount", &p->deesser_amount);
    int echo = field(d, root, "echo");
    num(d, echo, "mix", &p->echo_mix);
    num(d, echo, "delayMs", &p->echo_delay_ms);
    num(d, echo, "feedback", &p->echo_feedback);
    int rev = field(d, root, "reverb");
    num(d, rev, "mix", &p->reverb_mix);
    num(d, rev, "size", &p->reverb_size);
    flag(d, root, "antifeedback", &p->antifeedback);
    num(d, root, "micVolume", &p->mic_volume);
    flag(d, root, "mute", &p->mute);
    otr_params_clamp(p);
}

static int parse(const char *json, int len, doc *d, jsmntok_t *toks, int max) {
    jsmn_parser parser;
    jsmn_init(&parser);
    int n = jsmn_parse(&parser, json, len, toks, max);
    if (n < 1 || toks[0].type != JSMN_OBJECT) return -1;
    d->js = json;
    d->t = toks;
    d->n = n;
    return 0;
}

int proto_parse_params(const char *json, int len, otr_params *params) {
    jsmntok_t toks[128];
    doc d;
    if (parse(json, len, &d, toks, 128) < 0) return -1;
    overlay(&d, 0, params);
    return 0;
}

int proto_parse(const char *json, int len, msg *out, otr_params *params) {
    jsmntok_t toks[128];
    doc d;
    memset(out, 0, sizeof(*out));
    if (parse(json, len, &d, toks, 128) < 0) return -1;
    int type = field(&d, 0, "type");
    if (type < 0) return -1;
    static const struct { const char *name; msg_type t; } names[] = {
        {"auth", MSG_AUTH}, {"params", MSG_PARAMS}, {"beat", MSG_BEAT}, {"standby", MSG_STANDBY},
        {"resume", MSG_RESUME}, {"quit", MSG_QUIT}, {"measure", MSG_MEASURE}, {"onsets", MSG_ONSETS},
    };
    for (size_t k = 0; k < sizeof(names) / sizeof(names[0]); k++)
        if (eq(&d, type, names[k].name)) out->type = names[k].t;
    if (out->type == MSG_AUTH) {
        int tok = field(&d, 0, "token");
        if (tok >= 0 && d.t[tok].type == JSMN_STRING) {
            int l = d.t[tok].end - d.t[tok].start;
            if (l >= (int)sizeof(out->token)) l = sizeof(out->token) - 1;
            memcpy(out->token, json + d.t[tok].start, l);
            out->token[l] = 0;
        }
    } else if (out->type == MSG_PARAMS && params) {
        overlay(&d, 0, params);
    } else if (out->type == MSG_ONSETS) {
        flag(&d, 0, "on", &out->on);
    }
    return 0;
}
