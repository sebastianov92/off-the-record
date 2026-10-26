// Places the webOS app's pitch frames on the song's clock. Its engine numbers each
// frame (frame k is centred on capture sample k * hop), but the frames reach this
// page in late, uneven batches through a busy TV. A batch can never arrive before
// its last frame was captured, so the smallest "arrival time minus frame time" seen
// recently is the media time of frame 0. The singer sings to music they hear
// `latency` seconds after the player reaches it, so that much comes off every frame.
// Pure; tv-bridge.js feeds it and the tests feed it made-up batches.
(function (root) {
  // Seconds of arrivals the anchor looks back over: long enough to catch a batch
  // that came through quickly, short enough that clock drift (~100 ppm) stays ~2 ms.
  const WINDOW = 20;

  function createPitchClock(options = {}) {
    let latency = options.latency ?? 0.15;
    let epoch = null;
    let hop = 0.02;
    let arrivals = []; // {at, anchor}: media time of an arrival, and the anchor it implies

    function reset() {
      arrivals = [];
    }

    // batch: {epoch, seq (k of its first frame), hop (seconds), midi[]};
    // now: the player's currentTime when the batch arrived. Returns [{t, midi}].
    function place(batch, now) {
      if (!batch || !Array.isArray(batch.midi) || !batch.midi.length || !(batch.hop > 0)) return [];
      // A restarted engine counts from zero again.
      if (batch.epoch !== epoch) {
        epoch = batch.epoch;
        reset();
      }
      hop = batch.hop;
      const lastK = batch.seq + batch.midi.length - 1;
      arrivals.push({ at: now, anchor: now - lastK * batch.hop });
      arrivals = arrivals.filter((a) => a.at > now - WINDOW && a.at <= now);
      const anchor = Math.min(...arrivals.map((a) => a.anchor));
      return batch.midi.map((midi, i) => ({
        t: anchor + (batch.seq + i) * batch.hop - latency,
        midi,
      }));
    }

    // Where frame k (fractional) falls on the media clock; null before any batch.
    function timeOf(k, frameEpoch) {
      if (!arrivals.length || frameEpoch !== epoch) return null;
      return Math.min(...arrivals.map((a) => a.anchor)) + k * hop - latency;
    }

    return {
      place,
      reset,
      timeOf,
      setLatency: (seconds) => (latency = seconds),
      latency: () => latency,
    };
  }

  // Calibration: clicks played at known media times come back as onsets the
  // engine heard. The median lag is the music's path to the singer's ears. Each
  // onset pairs with the latest click before it, within half a second.
  function calibrationLatency(clicks, onsets) {
    const lags = [];
    for (const t of onsets) {
      const before = clicks.filter((c) => c <= t && t - c < 0.5);
      if (before.length) lags.push(t - before[before.length - 1]);
    }
    if (lags.length < 3) return null;
    lags.sort((a, b) => a - b);
    return { latency: lags[Math.floor(lags.length / 2)], spread: lags[lags.length - 1] - lags[0], count: lags.length };
  }

  root.AiPitchClock = { createPitchClock, calibrationLatency, WINDOW };
  if (typeof module !== "undefined") module.exports = root.AiPitchClock;
})(typeof window !== "undefined" ? window : globalThis);
