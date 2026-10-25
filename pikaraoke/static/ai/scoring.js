// Real karaoke score: the singer's pitch, frame by frame, against the reference
// melody the AI worker took from the original vocals. Pure function; the splash
// feeds it microphone frames and the tests feed it made-up ones.
(function (root) {
  const FULL_CREDIT = 1.0; // semitones off that still count as in tune
  const NO_CREDIT = 2.5; // semitones off that count as wrong
  // Microphones and TV audio paths lag; a sung frame may land this far around
  // the reference frame it answers.
  const EARLY = 0.1;
  const LATE = 0.35;
  const ENTRY_BEFORE = 0.15; // an entry this early still counts as on time
  const ENTRY_AFTER = 0.45;
  const MIN_PRESENCE = 0.1; // below this nobody really sang: no score at all

  // Octave-free distance in semitones: singing an octave down is still in tune.
  function noteDistance(a, b) {
    const d = (((a - b) % 12) + 12) % 12;
    return Math.min(d, 12 - d);
  }

  function credit(distance) {
    if (distance <= FULL_CREDIT) return 1;
    if (distance >= NO_CREDIT) return 0;
    return 1 - (distance - FULL_CREDIT) / (NO_CREDIT - FULL_CREDIT);
  }

  /**
   * @param ref {fps, notes}: reference MIDI note per frame, 0 where nobody sings.
   * @param lineStarts seconds where each lyric line begins.
   * @param sung [{t, midi}] singer frames in song time, midi 0 for silence.
   * @returns {total, pitch, presence, timing} (0-100 and fractions) or null if nobody sang.
   */
  function score(ref, lineStarts, sung) {
    const voiced = sung.filter((f) => f.midi > 0).sort((a, b) => a.t - b.t);
    let expected = 0;
    let answered = 0;
    let creditSum = 0;
    let from = 0;
    for (let i = 0; i < ref.notes.length; i++) {
      const note = ref.notes[i];
      if (!note) continue;
      expected++;
      const t = i / ref.fps;
      while (from < voiced.length && voiced[from].t < t - EARLY) from++;
      let best = -1;
      for (let k = from; k < voiced.length && voiced[k].t <= t + LATE; k++) {
        best = Math.max(best, credit(noteDistance(voiced[k].midi, note)));
      }
      if (best >= 0) {
        answered++;
        creditSum += best;
      }
    }
    if (!expected) return null;
    const presence = answered / expected;
    if (presence < MIN_PRESENCE) return null;

    const pitch = creditSum / answered;
    const onTime = lineStarts.filter((s) =>
      voiced.some((f) => f.t >= s - ENTRY_BEFORE && f.t <= s + ENTRY_AFTER)
    ).length;
    const timing = lineStarts.length ? onTime / lineStarts.length : presence;
    // Tuning only counts in full once most of the song was sung.
    const total = 100 * (0.6 * pitch * Math.min(1, presence / 0.6) + 0.25 * presence + 0.15 * timing);
    return { total: Math.max(0, Math.min(100, Math.round(total))), pitch, presence, timing };
  }

  const MOOD_WINDOW = 2.5; // seconds of singing the avatar's face reacts to

  // Best credit a sung frame earns against the reference frames it may answer:
  // the same window score() allows for microphone and TV audio lag.
  function frameCredit(ref, frame) {
    const first = Math.max(0, Math.ceil((frame.t - LATE) * ref.fps));
    const last = Math.min(ref.notes.length - 1, Math.floor((frame.t + EARLY) * ref.fps));
    let best = 0;
    for (let i = first; i <= last; i++) {
      if (ref.notes[i]) best = Math.max(best, credit(noteDistance(frame.midi, ref.notes[i])));
    }
    return best;
  }

  /**
   * The singer's mood over the last few seconds, for the avatar on the TV.
   * @param sung [{t, midi}] in time order, midi 0 for silence.
   * @returns an expression name, or null when the microphone heard nothing yet.
   */
  function mood(ref, sung, now) {
    const from = now - MOOD_WINDOW;
    const first = Math.max(0, Math.floor(from * ref.fps));
    const last = Math.min(ref.notes.length, Math.ceil(now * ref.fps));
    let melody = 0;
    for (let i = first; i < last; i++) if (ref.notes[i]) melody++;
    // Nobody sings in the original here either: a break, so the face waits.
    if (last <= first || melody / (last - first) < 0.25) return "thinking";

    let heard = 0;
    let voiced = 0;
    let creditSum = 0;
    for (let i = sung.length - 1; i >= 0 && sung[i].t >= from; i--) {
      const frame = sung[i];
      if (frame.t > now) continue;
      heard++;
      if (frame.midi <= 0) continue;
      voiced++;
      creditSum += frameCredit(ref, frame);
    }
    if (!heard) return null;
    if (voiced / heard < 0.2) return "sleepy"; // the line is on and nobody is singing it
    const tune = creditSum / voiced;
    if (tune >= 0.9) return "love";
    if (tune >= 0.7) return "happy";
    if (tune >= 0.45) return "idle";
    if (tune >= 0.25) return "unsure";
    return "surprised";
  }

  // The face to end the song with, from its score.
  function finalMood(total) {
    if (total >= 85) return "love";
    if (total >= 70) return "smug";
    if (total >= 50) return "happy";
    return "shy";
  }

  root.AiScoring = { score, noteDistance, mood, finalMood };
  if (typeof module !== "undefined") module.exports = root.AiScoring;
})(typeof window !== "undefined" ? window : globalThis);
