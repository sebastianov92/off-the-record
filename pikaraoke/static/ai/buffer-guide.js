// The vocal guide in the LG TV app. On the TV every media player shares one media
// sound output (MAIN_SOUND); a second player that starts takes it from the song,
// and the TV pauses the song. Web Audio leaves through the apps' sound path
// instead, beside the song, so there the guide is decoded whole and played from a
// buffer. It answers the part of the media element API that ai/splash.js drives
// (src, load, play, pause, paused, currentTime, volume), so the splash keeps one
// way of keeping its guide in step.
(function (root) {
  // A sung voice needs nothing above 12 kHz, and at this rate a four-minute guide
  // holds ~23 MB as one channel.
  const RATE = 24000;
  // The TV's player is heard this much later after reaching a point (currentTime)
  // than Web Audio is after putting that point out, so the guide sends each point
  // that much after the song reaches it. Measured on the LG (2026-10-25) by
  // recording the room and finding each track in the recording, over four starts:
  // 10 ms, each start within ±20 ms of it.
  const PLAYER_LATENCY = 0.01;

  function createBufferGuide(options = {}) {
    const makeContext =
      options.context || (() => new root.AudioContext({ sampleRate: RATE, latencyHint: "playback" }));
    const fetchUrl = options.fetch || ((url) => root.fetch(url));
    const now = options.now || (() => root.performance.now() / 1000);
    const playerLatency = options.playerLatency ?? PLAYER_LATENCY;
    let ctx = null;
    let gain = null;
    let src = null; // the url set
    let loaded = null; // the url `buffer` holds
    let buffer = null;
    let loads = 0; // numbers each load, so a slow decode of an old url is dropped
    let source = null; // the playing AudioBufferSourceNode
    let startedAt = 0; // context time the source starts leaving the output
    let offset = 0; // song time at startedAt, or where the guide rests
    let wanted = false; // play() called, and no pause() since
    let volume = 1;

    function context() {
      if (!ctx) {
        ctx = makeContext();
        gain = ctx.createGain();
        gain.gain.value = volume;
        gain.connect(ctx.destination);
      }
      return ctx;
    }

    // The context time leaving the output now. Web Audio renders ahead in batches
    // (1024 frames on the TV), so currentTime runs ahead of it and jumps; the output
    // timestamp does neither. Before the first output it is zero.
    function heard() {
      const ts = ctx.getOutputTimestamp();
      if (!ts.performanceTime) return ctx.currentTime;
      return ts.contextTime + now() - ts.performanceTime / 1000;
    }

    function position() {
      return source ? offset + (heard() - startedAt) : offset;
    }

    function stopSource() {
      if (!source) return;
      offset = position();
      source.onended = null;
      source.stop();
      source.disconnect();
      source = null;
    }

    // Starts the buffer in step with the song, which stands at `offset` now.
    function startSource() {
      if (source || !wanted || !buffer) return;
      const c = context();
      // The next batch it renders leaves the output this much later.
      const when = c.currentTime;
      const song = offset + (when - heard());
      const at = song - playerLatency;
      if (at >= buffer.duration) return;
      const node = c.createBufferSource();
      node.buffer = buffer;
      node.connect(gain);
      node.onended = () => {
        if (source !== node) return;
        offset = position();
        source = null;
      };
      source = node;
      startedAt = when;
      offset = song;
      // At the very start that sample is before the buffer: wait for it instead.
      if (at < 0) node.start(when - at, 0);
      else node.start(when, at);
    }

    function mono(decoded) {
      if (decoded.numberOfChannels === 1) return decoded;
      const out = ctx.createBuffer(1, decoded.length, decoded.sampleRate);
      const mix = out.getChannelData(0);
      const n = decoded.numberOfChannels;
      for (let ch = 0; ch < n; ch++) {
        const data = decoded.getChannelData(ch);
        for (let i = 0; i < data.length; i++) mix[i] += data[i] / n;
      }
      return out;
    }

    // Like a media element's load(): back to the start, paused, fetching src anew.
    function load() {
      stopSource();
      wanted = false;
      offset = 0;
      if (src === loaded) return;
      buffer = null;
      loaded = null;
      const n = ++loads;
      if (!src) return;
      const url = src;
      fetchUrl(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((bytes) => context().decodeAudioData(bytes))
        .then((decoded) => {
          if (n !== loads) return;
          buffer = mono(decoded);
          loaded = url;
          startSource();
        })
        .catch((err) => {
          if (n === loads) console.warn("Guide could not be loaded:", url, err);
        });
    }

    function play() {
      wanted = true;
      const c = context();
      startSource();
      return c.state === "suspended" ? c.resume() : Promise.resolve();
    }

    function pause() {
      stopSource();
      wanted = false;
    }

    return {
      get src() {
        return src || "";
      },
      set src(url) {
        src = url ? String(url) : null;
      },
      getAttribute: (name) => (name === "src" ? src : null),
      removeAttribute(name) {
        if (name === "src") src = null;
      },
      load,
      play,
      pause,
      get paused() {
        return !wanted;
      },
      get currentTime() {
        return position();
      },
      set currentTime(t) {
        stopSource();
        offset = Math.max(0, t);
        startSource();
      },
      get volume() {
        return volume;
      },
      set volume(v) {
        volume = v;
        if (gain) gain.gain.value = v;
      },
    };
  }

  root.AiBufferGuide = { createBufferGuide, RATE, PLAYER_LATENCY };
  if (typeof module !== "undefined") module.exports = root.AiBufferGuide;
})(typeof window !== "undefined" ? window : globalThis);
