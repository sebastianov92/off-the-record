// Word-timed lyrics on the splash screen: the line being sung fills word by word,
// with the previous line above and the next two below. Driven by the player's clock.
(function () {
  const LEAD = 0.35; // a line becomes current slightly before it is sung
  const SHOW_NEXT_AFTER = 1.0; // seconds a finished line stays before the next takes over
  const COUNTDOWN_GAP = 4; // silences at least this long get a countdown
  const COUNTDOWN_FROM = 3.2;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  class Lyrics {
    constructor(root) {
      this.root = root;
      this.lines = [];
      this.shown = -2;
      this.prev = el("div", "ai-line ai-prev");
      this.countdown = el("div", "ai-countdown");
      for (let i = 0; i < 3; i++) this.countdown.append(el("i"));
      this.cur = el("div", "ai-line ai-current");
      this.next = el("div", "ai-line ai-next");
      this.next2 = el("div", "ai-line ai-next2");
      root.append(this.prev, this.countdown, this.cur, this.next, this.next2);
    }

    load(lines) {
      this.lines = lines || [];
      this.shown = -2;
      [this.prev, this.cur, this.next, this.next2].forEach((n) => n.replaceChildren());
    }

    // The line in the centre: the one being sung or, during a silence, the one coming.
    pick(t) {
      let cur = -1;
      for (let i = 0; i < this.lines.length; i++) {
        if (this.lines[i].start <= t + LEAD) cur = i;
        else break;
      }
      if (cur === -1) return { idx: 0, waiting: true };
      const next = this.lines[cur + 1];
      if (next && t > this.lines[cur].end + SHOW_NEXT_AFTER) return { idx: cur + 1, waiting: true };
      return { idx: cur, waiting: false };
    }

    // Whether a line is being sung at t, and which: the avatar on the TV reacts to it.
    state(t) {
      if (!this.lines.length) return { idx: -1, singing: false };
      const { idx, waiting } = this.pick(t);
      return { idx, singing: !waiting && t <= this.lines[idx].end + 0.3 };
    }

    show(idx) {
      const lines = this.lines;
      this.prev.textContent = lines[idx - 1] ? lines[idx - 1].text : "";
      this.cur.replaceChildren();
      (lines[idx] ? lines[idx].words : []).forEach((w, i, words) => {
        this.cur.append(el("span", "ai-w", w.t));
        if (i < words.length - 1) this.cur.append(" ");
      });
      this.next.textContent = lines[idx + 1] ? lines[idx + 1].text : "";
      this.next2.textContent = lines[idx + 2] ? lines[idx + 2].text : "";
      this.cur.classList.remove("ai-enter");
      void this.cur.offsetWidth;
      this.cur.classList.add("ai-enter");
    }

    render(t) {
      if (!this.lines.length) return;
      const { idx, waiting } = this.pick(t);
      if (idx !== this.shown) {
        this.shown = idx;
        this.show(idx);
      }
      const line = this.lines[idx];
      const spans = this.cur.children;
      for (let i = 0; i < spans.length; i++) {
        const w = line.words[i];
        const span = spans[i];
        if (t >= w.e) {
          if (!span.classList.contains("ai-sung")) {
            span.classList.add("ai-sung");
            span.style.removeProperty("--p");
          }
        } else {
          span.classList.remove("ai-sung");
          const p = t <= w.s ? 0 : ((t - w.s) / (w.e - w.s)) * 100;
          span.style.setProperty("--p", `${p.toFixed(1)}%`);
        }
      }
      const prevEnd = idx > 0 ? this.lines[idx - 1].end : 0;
      const remaining = line.start - t;
      const on = waiting && line.start - prevEnd >= COUNTDOWN_GAP && remaining > 0 && remaining <= COUNTDOWN_FROM;
      this.countdown.classList.toggle("ai-on", on);
      if (on) {
        const lit = Math.ceil(remaining);
        [...this.countdown.children].forEach((dot, i) => dot.classList.toggle("ai-off", i >= lit));
      }
    }
  }

  window.AiLyrics = Lyrics;
})();
