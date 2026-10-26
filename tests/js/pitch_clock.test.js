// The webOS app's pitch frames arrive late and in uneven batches; pitch-clock.js
// must still put each frame where it was sung on the song's clock.

import { beforeAll, describe, expect, it } from "vitest";

let createPitchClock;
let calibrationLatency;

beforeAll(async () => {
  await import("../../pikaraoke/static/ai/pitch-clock.js");
  ({ createPitchClock, calibrationLatency } = globalThis.AiPitchClock);
});

const HOP = 0.02;

// A deterministic stand-in for a busy TV: delays spread over 0..maxDelay seconds.
function delays(n, maxDelay, seed = 7) {
  let x = seed;
  return Array.from({ length: n }, () => {
    x = (x * 16807) % 2147483647;
    return (x / 2147483647) * maxDelay;
  });
}

// Frame k was captured when the player stood at start + k * HOP; batches of five
// frames reach the page `delay` seconds after their last frame.
function simulate(clock, { start = 12.3, batches = 300, maxDelay = 0.3, epoch = "a" } = {}) {
  const placed = [];
  delays(batches, maxDelay).forEach((delay, b) => {
    const seq = b * 5;
    const now = start + (seq + 4) * HOP + delay;
    const frames = clock.place({ epoch, seq, hop: HOP, midi: [60, 60, 61, 61, 62] }, now);
    frames.forEach((f, i) => placed.push({ k: seq + i, t: f.t }));
  });
  return placed;
}

describe("pitch clock", () => {
  it("places frames within 10 ms of when they were sung, once warmed up", () => {
    const clock = createPitchClock({ latency: 0 });
    const placed = simulate(clock);
    const warm = placed.filter((p) => p.k > 400); // after 8 s
    for (const p of warm) expect(Math.abs(p.t - (12.3 + p.k * HOP))).toBeLessThan(0.01);
  });

  it("never places a frame later than it was sung", () => {
    const clock = createPitchClock({ latency: 0 });
    for (const p of simulate(clock)) expect(p.t).toBeGreaterThanOrEqual(12.3 + p.k * HOP - 1e-9);
  });

  it("takes the music's output latency off every frame", () => {
    const clock = createPitchClock({ latency: 0.15 });
    const late = simulate(clock).filter((p) => p.k > 400);
    for (const p of late) expect(Math.abs(p.t - (12.3 + p.k * HOP - 0.15))).toBeLessThan(0.01);
  });

  it("starts over when the engine restarts", () => {
    const clock = createPitchClock({ latency: 0 });
    simulate(clock, { start: 10 });
    // A new engine counts from zero, at a different point of the song.
    const [first] = clock.place({ epoch: "b", seq: 0, hop: HOP, midi: [60] }, 40);
    expect(first.t).toBeCloseTo(40, 6);
  });

  it("forgets the old anchor on reset, as after a seek", () => {
    const clock = createPitchClock({ latency: 0 });
    simulate(clock, { start: 10 });
    clock.reset();
    const [frame] = clock.place({ epoch: "a", seq: 1700, hop: HOP, midi: [60] }, 80);
    expect(frame.t).toBeCloseTo(80, 6);
  });

  it("ignores a malformed batch", () => {
    const clock = createPitchClock();
    expect(clock.place({ epoch: "a", seq: 0, hop: 0, midi: [60] }, 1)).toEqual([]);
    expect(clock.place({ epoch: "a", seq: 0, hop: HOP, midi: [] }, 1)).toEqual([]);
    expect(clock.place(null, 1)).toEqual([]);
  });
});

describe("calibration", () => {
  const clicks = [1, 1.6, 2.2, 2.8, 3.4];

  it("takes the median lag from clicks to what the microphone heard", () => {
    const jitter = [0, -0.01, 0.01, -0.005, 0.005];
    const onsets = clicks.map((c, i) => c + 0.14 + jitter[i]);
    const result = calibrationLatency(clicks, onsets);
    expect(result.latency).toBeCloseTo(0.14, 6);
    expect(result.count).toBe(5);
  });

  it("ignores a cough far from any click", () => {
    const onsets = [...clicks.map((c) => c + 0.12), 0.4];
    expect(calibrationLatency(clicks, onsets).latency).toBeCloseTo(0.12, 6);
  });

  it("gives no answer from too few clicks heard", () => {
    expect(calibrationLatency(clicks, [1.12, 1.72])).toBeNull();
  });

  it("maps an onset's frame number onto the media clock", () => {
    const clock = createPitchClock({ latency: 0 });
    clock.place({ epoch: "e", seq: 0, hop: 0.02, midi: [0, 0, 0, 0, 0] }, 10.08);
    expect(clock.timeOf(2.5, "e")).toBeCloseTo(10.05, 6);
    expect(clock.timeOf(2.5, "other")).toBeNull();
  });
});
