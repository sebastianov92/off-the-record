function getScoreData(scoreValue) {
  function randomPhrase(phrases) {
    return phrases[Math.floor(Math.random() * phrases.length)];
  }

  if (scoreValue < 30) {
    return { applause: "applause-l.mp3", review: randomPhrase(scoreReviews.low) };
  } else if (scoreValue < 60) {
    return { applause: "applause-m.mp3", review: randomPhrase(scoreReviews.mid) };
  } else {
    return { applause: "applause-h.mp3", review: randomPhrase(scoreReviews.high) };
  }
}

async function showFinalScoreWithAudio(
  scoreTextElement,
  scoreValue,
  scoreReviewElement,
  scoreData,
  applauseElement
) {
  scoreTextElement.text(String(scoreValue).padStart(2, "0"));
  scoreReviewElement.text(scoreData.review);
  launchFireworkShow(scoreValue);
  // The song's end report waits behind this, so applause that never plays or
  // never finishes must not hold the score screen open. The clips run under 8s.
  const applauseTimeout = 10000;
  return new Promise((resolve) => {
    applauseElement.onended = resolve;
    setTimeout(resolve, applauseTimeout);
    applauseElement.play().catch((e) => console.log("Applause blocked", e));
  });
}

async function rotateScore(scoreTextElement, duration) {
  const interval = 100;
  const startTime = performance.now();

  while (true) {
    const elapsed = performance.now() - startTime;

    if (elapsed >= duration) break;

    const randomScore = String(Math.floor(Math.random() * 99) + 1).padStart(
      2,
      "0"
    );
    scoreTextElement.text(randomScore);

    const nextUpdate = interval - (performance.now() - (startTime + elapsed));
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, nextUpdate))
    );
  }
}

// score: {total, pitch, presence, timing} measured from the microphone (ai/score.js).
async function startScore(staticPath, score) {
  try {
    const r = await fetch(PikaraokeConfig.scorePhrasesUrl);
    scoreReviews = await r.json();
  } catch (_e) {
    // Network failure: keep the last successfully fetched phrases
  }

  const scoreElement = $("#score");
  const scoreTextElement = $("#score-number-text");
  const scoreReviewElement = $("#score-review-text");

  const scoreValue = score.total;
  const scoreData = getScoreData(scoreValue);
  const breakdown = $("#score-breakdown");
  const percent = (fraction) => `${Math.round(fraction * 100)}%`;
  breakdown.text(
    `${breakdown.data("pitch")} ${percent(score.pitch)} · ` +
      `${breakdown.data("timing")} ${percent(score.timing)} · ` +
      `${breakdown.data("presence")} ${percent(score.presence)}`
  );

  const drums = new Audio(staticPath + "sounds/score-drums.mp3");
  // Pre-create applause audio NOW to capture the user activation window
  // Mobile Safari only allows audio.play() within a brief window after user events
  const applause = new Audio(staticPath + "sounds/" + scoreData.applause);

  scoreElement.show();
  drums.volume = 0.3;
  drums.play();
  const drumDuration = 4100;

  await rotateScore(scoreTextElement, drumDuration);
  await showFinalScoreWithAudio(
    scoreTextElement,
    scoreValue,
    scoreReviewElement,
    scoreData,
    applause
  );
  scoreReviewElement.text("");
  breakdown.text("");
  scoreElement.hide();
}
