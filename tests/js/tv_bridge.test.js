// tv-bridge.js: the splash's side of the webOS app. It takes commands only from
// the app that framed it, sends them as this page's own requests with the device
// token, and reports what is playing.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let createTvBridge;
let createPitchClock;

beforeAll(async () => {
  await import("../../pikaraoke/static/ai/pitch-clock.js");
  await import("../../pikaraoke/static/ai/tv-bridge.js");
  ({ createTvBridge } = globalThis.OtrTvBridge);
  ({ createPitchClock } = globalThis.AiPitchClock);
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name) => headers[name] ?? null },
  };
}

let parent;
let socketHandlers;
let score;
let fetch;
let bridge;
let video;

function sent(type) {
  return parent.postMessage.mock.calls.map(([m]) => m).filter((m) => m.type === type);
}

beforeEach(() => {
  document.body.innerHTML = '<video id="video"><source id="video-source" src=""></video>';
  video = document.getElementById("video");
  video.load = vi.fn();
  video.play = vi.fn(() => Promise.resolve());
  Object.defineProperty(video, "paused", { value: false, configurable: true });
  Object.defineProperty(video, "currentTime", { value: 30, configurable: true, writable: true });
  parent = { postMessage: vi.fn() };
  socketHandlers = {};
  score = { useFeed: vi.fn(), feed: vi.fn() };
  fetch = vi.fn(async (url, init = {}) => {
    if (url === "/api/auth" && !init.method) return response(200, { authenticated: false, password_required: true });
    if (url === "/api/now_playing") return response(200, {});
    if (url === "/api/tv/prefetch") return response(200, { songs: UPCOMING });
    return response(200, {});
  });
  const win = {
    parent,
    navigator: { userAgent: "test" },
    addEventListener: vi.fn(),
    setInterval: vi.fn(),
    // Looked up on each call, so a test's fake timers take them over.
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    MutationObserver,
  };
  bridge = createTvBridge({
    win,
    doc: document,
    fetch,
    socket: { on: (name, fn) => (socketHandlers[name] = fn) },
    score,
    clock: createPitchClock({ latency: 0 }),
    base: "",
  });
  bridge.start();
});

const fromApp = (data) => bridge.onMessage({ source: parent, data: { otr: 1, ...data } });

const UPCOMING = [
  { file: "/songs/a.mp4", name: "aaaaaaaaaaaaaaaaaaaa.mp4", size: 10, url: "/api/tv/media/aaaaaaaaaaaaaaaaaaaa.mp4" },
  { file: "/songs/b.mp4", name: "bbbbbbbbbbbbbbbbbbbb.mp4", size: 10, url: "/api/tv/media/bbbbbbbbbbbbbbbbbbbb.mp4" },
];
const LOCAL = "http://127.0.0.1:47831/files/";

describe("tv bridge", () => {
  it("never opens this page's microphone", () => {
    expect(score.useFeed).toHaveBeenCalledWith(false);
  });

  it("announces itself with the server's auth state", async () => {
    await flush();
    const [ready] = sent("ready");
    expect(ready.bridge).toBe(1);
    expect(ready.auth).toEqual({ required: true, ok: false });
    expect(ready.caps).toEqual(expect.arrayContaining(["pause", "skip", "restart", "pitch"]));
  });

  it("ignores messages from anyone but the app that framed it", async () => {
    bridge.onMessage({ source: {}, data: { otr: 1, type: "cmd", id: 1, action: "skip" } });
    await flush();
    expect(fetch).not.toHaveBeenCalledWith("/api/skip", expect.anything());
  });

  it("sends a command with the device token", async () => {
    fromApp({ type: "init", token: "tok" });
    fromApp({ type: "cmd", id: 7, action: "pause" });
    await flush();
    const [url, init] = fetch.mock.calls.find(([u]) => u === "/api/pause");
    expect(url).toBe("/api/pause");
    expect(init.headers["X-Admin-Token"]).toBe("tok");
    expect(sent("result").at(-1)).toMatchObject({ id: 7, ok: true, status: 200 });
  });

  it("clamps a volume before sending it", async () => {
    fromApp({ type: "cmd", id: 1, action: "volume", value: 3 });
    fromApp({ type: "cmd", id: 2, action: "guide", value: 140.4 });
    await flush();
    expect(fetch).toHaveBeenCalledWith("/api/volume/1", expect.anything());
    const guide = fetch.mock.calls.find(([u]) => u === "/api/ai/guide_volume");
    expect(JSON.parse(guide[1].body)).toEqual({ volume: 100 });
  });

  it("refuses a command it does not know", async () => {
    fromApp({ type: "cmd", id: 3, action: "shutdown" });
    await flush();
    expect(sent("result").at(-1)).toMatchObject({ id: 3, ok: false, status: 400 });
    expect(fetch.mock.calls.some(([u]) => u.includes("shutdown"))).toBe(false);
  });

  it("reports a refused command so the app can ask for the password", async () => {
    fetch.mockImplementationOnce(async () => response(403));
    fromApp({ type: "cmd", id: 4, action: "skip" });
    await flush();
    expect(sent("result").at(-1)).toMatchObject({ id: 4, ok: false, status: 403 });
  });

  it("trades the password for a token and uses it from then on", async () => {
    fetch.mockImplementationOnce(async () => response(200, { authenticated: true, token: "new" }));
    fromApp({ type: "cmd", id: 5, action: "login", value: "hunter2" });
    await flush();
    expect(sent("result").at(-1)).toMatchObject({ id: 5, ok: true, token: "new" });
    expect(bridge.token()).toBe("new");
    fromApp({ type: "cmd", id: 6, action: "skip" });
    await flush();
    const [, init] = fetch.mock.calls.find(([u]) => u === "/api/skip");
    expect(init.headers["X-Admin-Token"]).toBe("new");
  });

  it("passes on a throttled login's wait", async () => {
    fetch.mockImplementationOnce(async () => response(429, {}, { "Retry-After": "30" }));
    fromApp({ type: "cmd", id: 8, action: "login", value: "x" });
    await flush();
    expect(sent("result").at(-1)).toMatchObject({ id: 8, ok: false, status: 429, retryAfter: 30 });
  });

  it("puts the engine's pitch on the song's clock and feeds the score", () => {
    fromApp({ type: "pitch", epoch: "e", seq: 0, hop: 0.02, midi: [60, 61] });
    const frames = score.feed.mock.calls.at(-1)[0];
    expect(frames).toHaveLength(2);
    expect(frames[1].t - frames[0].t).toBeCloseTo(0.02, 6);
  });

  it("drops pitch while the song is paused", () => {
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    fromApp({ type: "pitch", epoch: "e", seq: 0, hop: 0.02, midi: [60] });
    expect(score.feed).not.toHaveBeenCalled();
  });

  it("scores only when the app says it has a microphone", () => {
    fromApp({ type: "mic", present: true });
    expect(score.useFeed).toHaveBeenLastCalledWith(true);
  });

  it("reports what is playing", () => {
    socketHandlers.now_playing({
      now_playing: "Song",
      now_playing_user: "Ana",
      is_paused: false,
      volume: 0.8,
      now_playing_ai: { guide_volume: 40, pitch_url: "/p" },
    });
    expect(sent("state").at(-1)).toMatchObject({
      title: "Song",
      singer: "Ana",
      playing: true,
      hasGuide: true,
      guideVolume: 40,
      scorable: true,
    });
  });

  it("follows a guide volume change from a phone", () => {
    socketHandlers.now_playing({ now_playing: "Song", now_playing_ai: { guide_volume: 40 } });
    socketHandlers.ai_guide_volume({ volume: 70 });
    expect(sent("state").at(-1).guideVolume).toBe(70);
  });

  describe("songs the TV keeps", () => {
    async function keptByTheApp(files) {
      vi.useFakeTimers();
      fromApp({ type: "cache", base: LOCAL, files });
      await vi.advanceTimersByTimeAsync(1100);
      vi.useRealTimers();
    }

    const np = (file) => ({ now_playing: "Song", now_playing_url: "/stream/1.m3u8", now_playing_file: file });

    it("asks for the coming songs once the app keeps copies, and hands them over", async () => {
      await keptByTheApp([]);
      expect(fetch).toHaveBeenCalledWith("/api/tv/prefetch", expect.anything());
      expect(sent("prefetch").at(-1).songs).toEqual(UPCOMING);
    });

    it("hands splash.js the TV's copy of the playing song", async () => {
      await keptByTheApp([UPCOMING[0].name]);
      expect(bridge.songCopy(np("/songs/a.mp4"))).toBe(LOCAL + UPCOMING[0].name);
    });

    it("streams a song the TV has no copy of", async () => {
      await keptByTheApp([UPCOMING[0].name]);
      expect(bridge.songCopy(np("/songs/b.mp4"))).toBe(null);
    });

    it("streams for good a copy the player could not read", async () => {
      await keptByTheApp([UPCOMING[0].name]);
      expect(bridge.songCopyFailed(LOCAL + UPCOMING[0].name)).toBe(true);
      expect(bridge.songCopy(np("/songs/a.mp4"))).toBe(null);
      expect(bridge.songCopyFailed("/stream/1.m3u8")).toBe(false);
    });
  });

  it("asks the app for focus when autoplay wants a click", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="permissions-modal" class="modal"></div><button id="permissions-button"></button>',
    );
    bridge.start();
    document.getElementById("permissions-modal").classList.add("is-active");
    await flush();
    expect(sent("gesture").at(-1)).toEqual({ otr: 1, type: "gesture", needed: true });
    expect(document.activeElement.id).toBe("permissions-button");
  });
});
