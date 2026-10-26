/* 16-bit PCM WAV files, mono or the first channel of many, any rate in, 48 kHz
 * mono out. For the offline modes (process, record) and tests. */
#ifndef OTR_WAV_H
#define OTR_WAV_H

/* Reads a whole file as float; returns frames, or -1. *out is malloc'd. */
int wav_read(const char *path, float **out, int *rate);
int wav_write(const char *path, const float *x, int frames, int rate);

#endif
