/* A small in-place radix-2 complex FFT, enough for the feedback detector. */
#ifndef OTR_FFT_H
#define OTR_FFT_H

void fft_inplace(float *re, float *im, int n); /* n a power of two */

#endif
