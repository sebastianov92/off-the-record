// Scoring on the splash: listens to the microphone while a processed song plays and,
// when it ends, scores the singing against the song's reference melody. No
// microphone, no melody or nobody singing means no score at all.
(function () {
  const FRAME_DELAY = 0.03; // the analysis window is centred this far back in time

  let context = null;
  let detector = null;
  let micReady = null; // Promise<boolean>, opened once on the first scorable song
  let micOn = false; // micReady settled true: frames are coming in
  let current = null; // {songId, ref, lineStarts}
  let frames = [];

  const player = () => document.getElementById("video");

  function onFrame(event) {
    const video = player();
    if (!current || !current.ref || !video || video.paused) return;
    frames.push({ t: video.currentTime - FRAME_DELAY, midi: event.data.midi });
  }

  async function openDetector() {
    context = new AudioContext();
    await context.audioWorklet.addModule(`${window.pikaraokeConfig.basePath}/static/ai/pitch-worklet.js`);
    detector = new AudioWorkletNode(context, "ai-pitch");
    detector.port.onmessage = onFrame;
    if (context.state === "suspended") await context.resume().catch(() => {});
  }

  function openMic() {
    if (!micReady) {
      micReady = (async () => {
        try {
          // Echo cancellation keeps the music and the vocal guide coming out of
          // the speakers from being scored as singing.
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
          });
          if (!detector) await openDetector();
          context.createMediaStreamSource(stream).connect(detector);
          micOn = true;
          return true;
        } catch (e) {
          console.info("No microphone for scoring:", e.message || e);
          return false;
        }
      })();
    }
    return micReady;
  }

  function load(info) {
    if (!info || !info.pitch_url) {
      reset();
      return;
    }
    // A background or guide change re-sends the same song: keep what was sung.
    if (current && current.songId === info.song_id) return;
    frames = [];
    current = { songId: info.song_id, ref: null, lineStarts: [] };
    const song = current;
    $.getJSON(info.pitch_url, (ref) => (song.ref = ref));
    $.getJSON(info.lyrics_url, (doc) => (song.lineStarts = (doc.lines || []).map((l) => l.start)));
    openMic();
  }

  // Score the song that just ended; null when there is nothing honest to show.
  async function finish() {
    const song = current;
    const sung = frames;
    current = null;
    frames = [];
    if (!song || !song.ref || !micReady || !(await micReady)) return null;
    const result = AiScoring.score(song.ref, song.lineStarts, sung);
    // The singer's avatar on the score screen wears the face the score earned.
    document.querySelectorAll(".ai-score-avatar").forEach((el) => {
      el.dataset.avatarFace = result ? AiScoring.finalMood(result.total) : "idle";
    });
    if (result) {
      $.ajax({
        url: `${window.pikaraokeConfig.basePath}/api/ai/score`,
        type: "POST",
        contentType: "application/json",
        data: JSON.stringify({ song_id: song.songId, ...result }),
      });
    }
    return result;
  }

  function reset() {
    current = null;
    frames = [];
  }

  // How the singing is going right now, as an avatar expression; null without a
  // microphone or before the melody has loaded, and the TV falls back to the lyrics.
  function mood(now) {
    if (!micOn || !current || !current.ref) return null;
    return AiScoring.mood(current.ref, frames, now);
  }

  // Any other audio source can be scored the same way (the webOS client feeds its
  // USB microphone through here); it must belong to context().
  async function attach(sourceNode) {
    if (!detector) await openDetector();
    sourceNode.connect(detector);
    micReady = Promise.resolve(true);
    micOn = true;
  }

  async function audioContext() {
    if (!detector) await openDetector();
    return context;
  }

  window.aiScore = { load, finish, reset, attach, audioContext, mood };
})();
