/* Where samples come from and go to. On the TV, ALSA through tinyalsa: the USB
 * microphone in, the TV's ADSP or a USB sound card out. On a Mac (tests and
 * preview), a null device that plays a WAV file or silence in real time and
 * swallows the output. */
#ifndef OTR_AUDIO_H
#define OTR_AUDIO_H

typedef enum { OUT_TV, OUT_USB, OUT_OFF } out_kind;

typedef struct {
    const char *backend;   /* "alsa" or "null" */
    out_kind output;
    int tv_card, tv_device;/* the ADSP PCM for OUT_TV; device -1 picks the quickest free */
    int mic_gain;          /* 'Mic Capture Volume' step, -1 to leave it */
    const char *input_wav; /* null backend: loop this file as the microphone */
} audio_config;

typedef struct {
    char name[96];
    int card;
} audio_input_info;

typedef struct {
    char pcm[32];
    int period, buffer;
} audio_output_info;

typedef struct audio audio;

/* Returns NULL with *error set ("mic-missing", "output-busy", ...). */
audio *audio_open(const audio_config *cfg, audio_input_info *in, audio_output_info *out, const char **error);
/* Blocks until OTR_BLOCK frames are captured. Returns 0, or -1 when the
 * microphone is gone. */
int audio_read(audio *a, float *mono);
/* Queues OTR_BLOCK frames (a no-op for OUT_OFF). */
int audio_write(audio *a, const float *mono, int frames);
/* Frames waiting to be played, for drift control. */
int audio_queued(audio *a);
void audio_close(audio *a);

/* JSON describing the sound cards and what each PCM accepts (the probe). */
int audio_probe(char *out, int size);

#endif
