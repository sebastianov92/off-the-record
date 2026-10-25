// Conversions page: the song the AI worker is converting (step by step, with
// elapsed time and an estimate), the songs waiting, and the finished ones.
// Loaded once by the SPA; processing.html calls aiProcessing() on every visit.
(function () {
  const STAGES = ["separating", "saving", "language", "transcribing", "writing"];
  const DONE_SHOWN = 20;
  let opts, states = new Map(), ticker = null;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  // Rows shaped like the ones on their way, until the first status arrives.
  function skeleton(id, rows) {
    document.getElementById(id).replaceChildren(...Array.from({ length: rows }, () => {
      const row = el("div", "skeleton-row");
      const lines = el("div", "skeleton-lines");
      lines.append(el("div", "skeleton-block skeleton-line"), el("div", "skeleton-block skeleton-line is-short"));
      row.append(lines);
      return row;
    }));
  }

  function idle() {
    const box = el("p", "empty-state");
    box.append(el("span", "empty-title", opts.labels.nothingNow), ` ${opts.labels.nowHint}`);
    return box;
  }

  // SQLite's CURRENT_TIMESTAMP is UTC without a zone marker.
  function parseTime(value) {
    return value ? Date.parse(value.replace(" ", "T") + "Z") : null;
  }

  function duration(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    const m = Math.floor(seconds / 60);
    return m ? `${m}:${String(seconds % 60).padStart(2, "0")} min` : `${seconds} s`;
  }

  function name(state) {
    const file = state.file_path.split("/").pop().replace(/\.[^.]+$/, "").replace(/---[\w-]{11}$/, "");
    return { title: state.title || file, artist: state.artist || "" };
  }

  function heading(state) {
    const { title, artist } = name(state);
    const box = el("div");
    box.append(el("div", "has-text-weight-bold", title));
    if (artist) box.append(el("div", "is-size-7 has-text-grey", artist));
    return box;
  }

  function nowCard(state) {
    const card = el("div", "box");
    card.dataset.songId = state.song_id;
    card.append(heading(state));

    const bar = el("progress", "progress is-info mt-3 mb-2");
    bar.max = 100;
    bar.value = state.progress || 0;
    card.append(bar);

    const times = el("div", "is-size-7 has-text-grey mb-3 processing-times");
    card.append(times);

    const steps = el("ol", "processing-steps");
    const current = STAGES.indexOf(state.stage);
    STAGES.forEach((stage, i) => {
      const done = current > i;
      const item = el("li", done ? "has-text-success" : i === current ? "has-text-weight-bold" : "has-text-grey");
      item.append(el("i", `icon ${done ? "icon-ok" : i === current ? "icon-cog" : "icon-angle-down"}`));
      item.append(" ", opts.labels.stages[stage]);
      steps.append(item);
    });
    card.append(steps);
    updateTimes(card, state);
    return card;
  }

  function updateTimes(card, state) {
    const started = parseTime(state.started_at);
    const times = card.querySelector(".processing-times");
    if (!started) {
      times.textContent = opts.labels.starting;
      return;
    }
    const elapsed = (Date.now() - started) / 1000;
    const p = state.progress || 0;
    let text = `${opts.labels.elapsed} ${duration(elapsed)}`;
    // The stage weights are rough; only estimate once there is something to go on.
    if (p >= 5 && p < 100) {
      text += ` · ${opts.labels.remaining.replace("{time}", duration((elapsed * (100 - p)) / p))}`;
    }
    times.textContent = `${text} · ${Math.round(p)}%`;
  }

  function queuedRow(state, position) {
    const row = el("div", "is-flex is-justify-content-space-between is-align-items-center py-2 processing-row");
    row.append(heading(state));
    row.append(el("span", "tag is-light", opts.labels.position.replace("{n}", position)));
    return row;
  }

  const TAG = { no_vocals: "is-warning", error: "is-danger" };

  function doneRow(state) {
    const row = el("div", "py-2 processing-row");
    const top = el("div", "is-flex is-justify-content-space-between is-align-items-center");
    top.append(heading(state));
    const right = el("div", "is-flex is-align-items-center");
    right.append(el("span", `tag is-light ${TAG[state.status] || ""}`, opts.labels[state.status] || state.status));
    if (opts.admin && state.status !== "ready") {
      const retry = el("button", "button is-small ml-2", opts.labels.retry);
      retry.addEventListener("click", () => $.post(`${opts.base}/api/ai/process`, { song: state.file_path }));
      right.append(retry);
    }
    top.append(right);
    row.append(top);
    const facts = [];
    if (state.seconds) facts.push(opts.labels.took.replace("{time}", duration(state.seconds)));
    if (state.language) facts.push(state.language.toUpperCase());
    if (state.lines) facts.push(opts.labels.lines.replace("{n}", state.lines));
    if (state.lyrics_source === "lrclib") {
      facts.push(opts.labels.realLyrics.replace("{n}", Math.round((state.lyrics_match || 0) * 100)));
    } else if (state.lyrics_source === "whisper") {
      facts.push(opts.labels.heardLyrics);
    }
    if (facts.length) row.append(el("div", "is-size-7 has-text-grey", facts.join(" · ")));
    if (state.status === "error" && state.error) row.append(el("div", "is-size-7 has-text-danger", state.error));
    return row;
  }

  function render() {
    const all = [...states.values()];
    const by = (status) => all.filter((s) => status.includes(s.status));
    const now = by(["processing"]);
    const queued = by(["queued"]).sort((a, b) => (a.requested_at || "").localeCompare(b.requested_at || "") || a.song_id - b.song_id);
    const done = by(["ready", "no_vocals", "error"])
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
      .slice(0, DONE_SHOWN);

    const fill = (id, items, make, empty) => {
      const box = document.getElementById(id);
      box.replaceChildren(...items.map(make));
      if (!items.length) box.append(typeof empty === "string" ? el("p", "empty-state", empty) : empty);
    };
    fill("processing-now", now, nowCard, idle());
    fill("processing-queue", queued, (s, i) => queuedRow(s, i + 1), opts.labels.nothingQueued);
    fill("processing-done", done, doneRow, opts.labels.nothingDone);
  }

  function tick() {
    if (!document.getElementById("processing-page")) {
      clearInterval(ticker);
      ticker = null;
      return;
    }
    document.querySelectorAll("#processing-now [data-song-id]").forEach((card) => {
      const state = states.get(Number(card.dataset.songId));
      if (state) updateTimes(card, state);
    });
  }

  window.aiProcessing = function (options) {
    opts = options;
    skeleton("processing-now", 1);
    skeleton("processing-queue", 2);
    skeleton("processing-done", 3);
    $.getJSON(`${opts.base}/api/ai/status`, (data) => {
      $("#processing-disabled").prop("hidden", data.enabled).text(opts.labels.disabled);
      states = new Map(data.songs.map((s) => [s.song_id, s]));
      render();
    });
    window.onPageSocket("ai_status", (state) => {
      states.set(state.song_id, state);
      render();
    });
    if (!ticker) ticker = setInterval(tick, 1000);
  };
})();
