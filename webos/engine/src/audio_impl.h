/* The backends behind audio.h. */
#ifndef OTR_AUDIO_IMPL_H
#define OTR_AUDIO_IMPL_H

#include "audio.h"

void *null_open(const audio_config *cfg, audio_input_info *in, audio_output_info *out, const char **error);
int null_read(void *dev, float *mono);
int null_write(void *dev, const float *mono, int frames);
int null_queued(void *dev);
void null_close(void *dev);

#ifdef OTR_ALSA
void *alsa_open(const audio_config *cfg, audio_input_info *in, audio_output_info *out, const char **error);
int alsa_read(void *dev, float *mono);
int alsa_write(void *dev, const float *mono, int frames);
int alsa_queued(void *dev);
void alsa_close(void *dev);
int alsa_probe(char *out, int size);
#endif

#endif
