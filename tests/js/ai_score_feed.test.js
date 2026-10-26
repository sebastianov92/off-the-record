// score.js in the webOS app: pitch comes from the app's engine, never from this
// page's microphone, which on the TV only hears silence.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const FPS = 50;
const ref = {
  fps: FPS,
  notes: Array.from({ length: 10 * FPS }, (_, i) => (i >= FPS && i < 9 * FPS ? 57 : 0)),
};

let ajax;
let video;
let songId = 0;

beforeAll(async () => {
  window.pikaraokeConfig = { basePath: "" };
  window.$ = {
    getJSON: (url, done) => done(url === "pitch" ? ref : { lines: [{ start: 1 }, { start: 5 }] }),
    ajax: (...args) => ajax(...args),
  };
  await import("../../pikaraoke/static/ai/scoring.js");
  await import("../../pikaraoke/static/ai/score.js");
});

beforeEach(() => {
  ajax = vi.fn();
  navigator.mediaDevices = { getUserMedia: vi.fn(() => Promise.reject(new Error("no"))) };
  document.body.innerHTML = '<video id="video"></video>';
  video = document.getElementById("video");
  Object.defineProperty(video, "paused", { value: false, configurable: true });
  songId += 1;
});

afterEach(() => window.aiScore.reset());

const load = () => window.aiScore.load({ song_id: songId, pitch_url: "pitch", lyrics_url: "lyrics" });

// The singer holds A3 through the whole melody, frame by frame.
const sungWell = () =>
  Array.from({ length: 8 * FPS }, (_, i) => ({ t: 1 + i / FPS, midi: 57 }));

describe("aiScore feed mode", () => {
  it("never opens this page's microphone", () => {
    window.aiScore.useFeed(true);
    load();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("scores frames the app sends", async () => {
    window.aiScore.useFeed(true);
    load();
    window.aiScore.feed(sungWell());
    const result = await window.aiScore.finish();
    expect(result.total).toBeGreaterThan(80);
    expect(ajax).toHaveBeenCalledOnce();
  });

  it("gives no score when the app has no microphone", async () => {
    window.aiScore.useFeed(false);
    load();
    window.aiScore.feed(sungWell());
    expect(await window.aiScore.finish()).toBeNull();
    expect(ajax).not.toHaveBeenCalled();
  });

  it("drops frames while the song is paused", async () => {
    window.aiScore.useFeed(true);
    load();
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    window.aiScore.feed(sungWell());
    expect(await window.aiScore.finish()).toBeNull();
  });

  it("keeps frames in time order for the avatar's mood", () => {
    window.aiScore.useFeed(true);
    load();
    window.aiScore.feed([{ t: 2, midi: 57 }]);
    window.aiScore.feed([{ t: 1.5, midi: 57 }, { t: 2.02, midi: 57 }]);
    expect(window.aiScore.mood(2.05)).not.toBeNull();
  });
});
