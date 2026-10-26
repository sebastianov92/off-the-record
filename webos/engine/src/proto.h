/* Messages between the app and the engine (PROTOCOL.md), parsed with jsmn. */
#ifndef OTR_PROTO_H
#define OTR_PROTO_H

#include "otr.h"

typedef enum {
    MSG_UNKNOWN,
    MSG_AUTH,
    MSG_PARAMS,
    MSG_BEAT,
    MSG_STANDBY,
    MSG_RESUME,
    MSG_QUIT,
    MSG_MEASURE,
    MSG_ONSETS,
} msg_type;

typedef struct {
    msg_type type;
    char token[80];
    int on;
} msg;

/* Parses a message; for MSG_PARAMS, overlays what it carries onto *params
 * (missing fields keep their value) and clamps the result. */
int proto_parse(const char *json, int len, msg *out, otr_params *params);
/* Parses a params object alone (a file for `process`). */
int proto_parse_params(const char *json, int len, otr_params *params);

#endif
