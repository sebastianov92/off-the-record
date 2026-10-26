#ifndef OTR_SHA1_H
#define OTR_SHA1_H

#include <stddef.h>

void sha1(const unsigned char *data, size_t len, unsigned char out[20]);

#endif
