// buffer-guide.js: the TV app's vocal guide, played through Web Audio so it never
// takes the TV's one media sound output from the song. It must behave like the
// media element ai/splash.js drives elsewhere: load, play, pause and seek.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let createBufferGuide;

beforeAll(async () => {
  await import("../../pikaraoke/static/ai/buffer-guide.js");
  ({ createBufferGuide } = globalThis.AiBufferGuide);
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeBuffer(channels, length, sampleRate = 24000) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (ch) => data[ch],
  };
}

// An AudioContext whose clock the test moves by hand. It renders `ahead` seconds
// before its output, as the TV's does in 1024-frame batches; until `started` it
// has put nothing out, and its output timestamp is zero.
function fakeContext({ ahead = 0.17, started = true, state = "running", decoded = fakeBuffer(1, 24000 * 200) } = {}) {
  const ctx = {
    currentTime: 0,
    state,
    destination: {},
    sources: [],
    getOutputTimestamp: () =>
      started ? { contextTime: ctx.currentTime - ahead, performanceTime: clock.now * 1000 } : { contextTime: 0, performanceTime: 0 },
    resume: vi.fn(async () => {
      ctx.state = "running";
    }),
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
    createBuffer: (channels, length, sampleRate) => fakeBuffer(channels, length, sampleRate),
    decodeAudioData: vi.fn(async () => decoded),
    createBufferSource() {
      const node = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn((when, offset) => Object.assign(node, { when, offset, live: true })),
        stop: vi.fn(() => (node.live = false)),
      };
      ctx.sources.push(node);
      return node;
    },
  };
  return ctx;
}

let clock;
let ctx;
let fetch;
let guide;

function make({ playerLatency = 0, ...options } = {}) {
  clock = { now: 50 };
  ctx = fakeContext(options);
  fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  guide = createBufferGuide({ context: () => ctx, fetch, now: () => clock.now, playerLatency });
  return guide;
}

function advance(seconds) {
  ctx.currentTime += seconds;
  clock.now += seconds;
}

const live = () => ctx.sources.filter((s) => s.live);

beforeEach(() => make());

describe("buffer guide", () => {
  it("starts paused and plays once its guide is decoded", async () => {
    guide.src = "/ai/guide/1";
    guide.load();
    expect(guide.paused).toBe(true);
    guide.play();
    expect(guide.paused).toBe(false);
    expect(live()).toHaveLength(0); // still decoding
    await flush();
    expect(fetch).toHaveBeenCalledWith("/ai/guide/1");
    expect(live()).toHaveLength(1);
  });

  it("follows a seek, and reports where it is", async () => {
    guide.src = "/g";
    guide.load();
    await flush();
    guide.play();
    guide.currentTime = 42;
    expect(live()).toHaveLength(1);
    expect(guide.currentTime).toBeCloseTo(42, 6);
    advance(3);
    expect(guide.currentTime).toBeCloseTo(45, 6);
  });

  it("starts each sample where it leaves the output with the song", async () => {
    make({ ahead: 0.17, playerLatency: 0.05 });
    guide.src = "/g";
    guide.load();
    await flush();
    advance(1);
    guide.play();
    guide.currentTime = 10;
    // Rendered now, heard 0.17 s on, when the song stands at 10.17.
    expect(live()[0].when).toBe(ctx.currentTime);
    expect(live()[0].offset).toBeCloseTo(10.17 - 0.05, 6);
    expect(guide.currentTime).toBeCloseTo(10, 6);
  });

  it("waits for the song when its first sample comes before the buffer", async () => {
    make({ ahead: 0, playerLatency: 0.05 });
    guide.src = "/g";
    guide.load();
    await flush();
    advance(5);
    guide.play();
    expect(live()[0].offset).toBe(0);
    expect(live()[0].when).toBeCloseTo(5.05, 6);
    expect(guide.currentTime).toBeCloseTo(0, 6);
  });

  it("goes by the render clock until the context has put anything out", async () => {
    make({ started: false, playerLatency: 0 });
    guide.src = "/g";
    guide.load();
    await flush();
    guide.play();
    guide.currentTime = 10;
    expect(live()[0].offset).toBeCloseTo(10, 6);
  });

  it("pauses where it is and resumes from there", async () => {
    guide.src = "/g";
    guide.load();
    await flush();
    guide.play();
    advance(7);
    guide.pause();
    expect(guide.paused).toBe(true);
    expect(live()).toHaveLength(0);
    expect(guide.currentTime).toBeCloseTo(7, 6);
    guide.play();
    expect(guide.currentTime).toBeCloseTo(7, 6);
    expect(live()[0].offset).toBeCloseTo(7.17, 6); // heard 0.17 s on
  });

  it("drops a guide that was replaced while it decoded", async () => {
    guide.src = "/old";
    guide.load();
    guide.src = "/new";
    guide.load();
    guide.play();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(live()).toHaveLength(1);
  });

  it("frees the guide when its source is removed", async () => {
    guide.src = "/g";
    guide.load();
    await flush();
    guide.removeAttribute("src");
    guide.load();
    guide.play();
    expect(guide.getAttribute("src")).toBe(null);
    expect(live()).toHaveLength(0);
  });

  it("mixes a stereo guide down to one channel", async () => {
    const stereo = fakeBuffer(2, 4);
    stereo.getChannelData(0).set([1, 1, 0, 0]);
    stereo.getChannelData(1).set([1, 0, 1, 0]);
    make({ decoded: stereo, ahead: 0 });
    guide.src = "/g";
    guide.load();
    guide.play();
    await flush();
    const played = live()[0].buffer;
    expect(played.numberOfChannels).toBe(1);
    expect(Array.from(played.getChannelData(0))).toEqual([1, 0.5, 0.5, 0]);
  });

  it("wakes a suspended context on play", async () => {
    make({ state: "suspended" });
    guide.src = "/g";
    guide.load();
    await guide.play();
    expect(ctx.resume).toHaveBeenCalled();
  });

  it("sets its volume on the gain", async () => {
    guide.volume = 0.3;
    guide.src = "/g";
    guide.load();
    await flush();
    expect(guide.volume).toBe(0.3);
  });

  it("keeps the song playing when the guide cannot be fetched", async () => {
    fetch.mockImplementationOnce(async () => ({ ok: false, status: 404 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    guide.src = "/missing";
    guide.load();
    guide.play();
    await flush();
    expect(live()).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
