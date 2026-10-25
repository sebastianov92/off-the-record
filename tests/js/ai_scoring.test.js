// Unit tests for the real karaoke score: a singer's pitch frames against the
// reference melody. The cases are made-up melodies, so the expected numbers can
// be reasoned out by hand.

import { beforeAll, describe, expect, it } from "vitest";

let AiScoring;

beforeAll(async () => {
  await import("../../pikaraoke/static/ai/scoring.js");
  AiScoring = globalThis.AiScoring;
});

// Ten seconds at 50 fps: sung A3 (57) from 1 s to 9 s, silence around it.
const FPS = 50;
const ref = {
  fps: FPS,
  notes: Array.from({ length: 10 * FPS }, (_, i) => (i >= FPS && i < 9 * FPS ? 57 : 0)),
};
const lineStarts = [1, 5];

// The singer's frames: the reference shifted by a microphone delay, transposed.
function sing({ shift = 0, delay = 0.12, until = 10 } = {}) {
  return ref.notes
    .map((note, i) => ({ t: i / FPS + delay, midi: note ? note + shift : 0 }))
    .filter((f) => f.t < until);
}

describe("AiScoring.score", () => {
  it("scores singing in tune and on time near the top", () => {
    const result = AiScoring.score(ref, lineStarts, sing());
    expect(result.total).toBeGreaterThanOrEqual(95);
    expect(result.pitch).toBeCloseTo(1);
    expect(result.presence).toBeCloseTo(1);
    expect(result.timing).toBe(1);
  });

  it("does not punish singing an octave down", () => {
    expect(AiScoring.score(ref, lineStarts, sing({ shift: -12 })).total).toBeGreaterThanOrEqual(95);
  });

  it("gives no tuning credit three semitones off", () => {
    const result = AiScoring.score(ref, lineStarts, sing({ shift: 3 }));
    expect(result.pitch).toBe(0);
    expect(result.total).toBe(40); // presence 25 + timing 15, nothing for tuning
  });

  it("weighs how much of the song was sung", () => {
    const half = AiScoring.score(ref, lineStarts, sing({ until: 5 }));
    expect(half.presence).toBeCloseTo(0.5, 1);
    expect(half.total).toBeLessThan(AiScoring.score(ref, lineStarts, sing()).total);
  });

  it("returns no score when nobody sang", () => {
    expect(AiScoring.score(ref, lineStarts, [])).toBeNull();
    const silent = ref.notes.map((_, i) => ({ t: i / FPS, midi: 0 }));
    expect(AiScoring.score(ref, lineStarts, silent)).toBeNull();
  });

  it("measures note distance without octaves", () => {
    expect(AiScoring.noteDistance(69, 57)).toBe(0);
    expect(AiScoring.noteDistance(60, 71)).toBe(1);
  });
});

describe("AiScoring.mood", () => {
  // Five seconds in: two and a half seconds of melody behind it.
  const NOW = 5;

  it("is in love with singing in tune", () => {
    expect(AiScoring.mood(ref, sing(), NOW)).toBe("love");
  });

  it("drops through the faces as the singing drifts off key", () => {
    expect(AiScoring.mood(ref, sing({ shift: 1.5 }), NOW)).toBe("idle");
    expect(AiScoring.mood(ref, sing({ shift: 2 }), NOW)).toBe("unsure");
    expect(AiScoring.mood(ref, sing({ shift: 3 }), NOW)).toBe("surprised");
  });

  it("falls asleep when the line is on and nobody sings it", () => {
    const silent = sing().map((f) => ({ ...f, midi: 0 }));
    expect(AiScoring.mood(ref, silent, NOW)).toBe("sleepy");
  });

  it("thinks through a stretch with no melody", () => {
    expect(AiScoring.mood(ref, sing(), 0.9)).toBe("thinking");
  });

  it("has nothing to say before the microphone hears anything", () => {
    expect(AiScoring.mood(ref, [], NOW)).toBeNull();
  });
});

describe("AiScoring.finalMood", () => {
  it("ends the song with the face the score earned", () => {
    expect(AiScoring.finalMood(92)).toBe("love");
    expect(AiScoring.finalMood(75)).toBe("smug");
    expect(AiScoring.finalMood(55)).toBe("happy");
    expect(AiScoring.finalMood(20)).toBe("shy");
  });
});
