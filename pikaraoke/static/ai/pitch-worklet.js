// The singer's pitch from the microphone (YIN), posted about 50 times a second.
// Runs on the audio thread so the splash's drawing never misses a frame.
const DECIMATE = 2; // ~24 kHz is plenty for a voice and halves the work
const WINDOW = 1024; // ~43 ms at 24 kHz: two periods of a low voice
const MIN_HZ = 70;
const MAX_HZ = 1000;
const THRESHOLD = 0.2;
const SILENCE_RMS = 0.012;

class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rate = sampleRate / DECIMATE;
    this.buffer = new Float32Array(WINDOW);
    this.filled = 0;
    this.hop = Math.round(this.rate / 50);
    this.sinceFrame = 0;
    this.carry = 0;
    this.carryCount = 0;
    this.tauMin = Math.floor(this.rate / MAX_HZ);
    this.tauMax = Math.ceil(this.rate / MIN_HZ);
    this.diff = new Float32Array(this.tauMax + 1);
  }

  push(sample) {
    if (this.filled < WINDOW) {
      this.buffer[this.filled++] = sample;
    } else {
      this.buffer.copyWithin(0, 1);
      this.buffer[WINDOW - 1] = sample;
    }
    this.sinceFrame++;
  }

  pitch() {
    const x = this.buffer;
    let energy = 0;
    for (let i = 0; i < WINDOW; i++) energy += x[i] * x[i];
    const rms = Math.sqrt(energy / WINDOW);
    if (rms < SILENCE_RMS) return { midi: 0, rms };

    const n = WINDOW - this.tauMax;
    const d = this.diff;
    let running = 0;
    d[0] = 1;
    for (let tau = 1; tau <= this.tauMax; tau++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const delta = x[i] - x[i + tau];
        sum += delta * delta;
      }
      running += sum;
      d[tau] = running ? (sum * tau) / running : 1;
    }
    let tau = -1;
    for (let t = this.tauMin; t < this.tauMax; t++) {
      if (d[t] < THRESHOLD) {
        while (t + 1 < this.tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return { midi: 0, rms };
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const curve = a - 2 * b + c;
    const shift = curve ? (0.5 * (a - c)) / curve : 0;
    const hz = this.rate / (tau + shift);
    return { midi: 69 + 12 * Math.log2(hz / 440), rms };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      // Average pairs: a cheap low-pass before dropping every other sample.
      this.carry += channel[i];
      if (++this.carryCount === DECIMATE) {
        this.push(this.carry / DECIMATE);
        this.carry = 0;
        this.carryCount = 0;
      }
    }
    if (this.filled === WINDOW && this.sinceFrame >= this.hop) {
      this.sinceFrame = 0;
      this.port.postMessage(this.pitch());
    }
    return true;
  }
}

registerProcessor("ai-pitch", PitchProcessor);
