# otr-mic. `make` builds for this machine (the null audio device on a Mac),
# `make test` runs the C tests with sanitizers, `make linux` is what
# docker-build.sh runs inside an ARM container for the TV (static, musl, ALSA).
CC ?= cc
CFLAGS ?= -O2
WARN = -std=gnu11 -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers
INC = -Isrc -Ivendor/jsmn
SRC = src/dsp.c src/pitch.c src/fft.c src/feedback.c src/drift.c src/wav.c src/sha1.c src/ws.c \
      src/proto.c src/audio.c src/audio_null.c
TINYALSA = vendor/tinyalsa/src/pcm.c vendor/tinyalsa/src/pcm_hw.c vendor/tinyalsa/src/mixer.c \
           vendor/tinyalsa/src/mixer_hw.c vendor/tinyalsa/src/limits.c vendor/tinyalsa/src/snd_card_plugin.c
ARCH ?= $(shell uname -m)

build/otr-mic: src/main.c $(SRC) src/*.h
	@mkdir -p build
	$(CC) $(CFLAGS) $(WARN) $(INC) -o $@ src/main.c $(SRC) -lpthread -lm

build/test_engine: tests/test_engine.c $(SRC) src/*.h
	@mkdir -p build
	$(CC) -O1 -g -fsanitize=address,undefined $(WARN) $(INC) -o $@ tests/test_engine.c $(SRC) -lpthread -lm

test: build/test_engine build/otr-mic
	./build/test_engine
	node --test tests/*.test.mjs

linux:
	@mkdir -p dist
	$(CC) -O2 -static $(WARN) -Wno-sign-compare -Wno-unused-function $(INC) -Ivendor/tinyalsa/include \
	  -o dist/otr-mic-$(ARCH) src/main.c $(SRC) src/audio_alsa.c $(TINYALSA) -lpthread -lm
	strip dist/otr-mic-$(ARCH)

clean:
	rm -rf build dist

.PHONY: test linux clean
