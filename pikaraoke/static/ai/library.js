// AI state on the browse page: a tag per song (queued, processing %, ready, no vocals,
// error) and, for admins, a button that sends the song to the AI worker.
// Loaded once by the SPA; files.html calls aiLibrary() on every visit.
(function () {
  let states = new Map(); // file_path -> ai_songs row
  let options = null;
  let observer = null;

  const TAG_CLASS = {
    queued: "is-link is-light",
    processing: "is-info is-light",
    ready: "is-success is-light",
    no_vocals: "is-warning is-light",
    error: "is-danger is-light",
  };

  function label(state) {
    const text = options.labels[state.status] || state.status;
    return state.status === "processing" ? `${text} ${Math.round(state.progress || 0)}%` : text;
  }

  function decorate(row) {
    const path = row.getAttribute("value");
    const nameCell = row.querySelector("td.break-word");
    if (!path || !nameCell) return;
    const state = states.get(path);

    let tag = nameCell.querySelector(".ai-tag");
    if (state) {
      if (!tag) {
        tag = document.createElement("span");
        nameCell.append(" ", tag);
      }
      tag.className = `ai-tag tag is-rounded ${TAG_CLASS[state.status] || ""}`;
      tag.textContent = label(state);
      tag.title = state.status === "error" ? state.error || "" : "";
    } else if (tag) {
      tag.remove();
    }

    if (!options.admin || !options.enabled) return;
    let button = row.querySelector(".ai-process");
    if (!button) {
      const cell = document.createElement("td");
      cell.className = "pr-0";
      button = document.createElement("a");
      button.className = "ai-process";
      button.href = "#";
      button.innerHTML = '<i class="icon icon-cog"></i>';
      button.addEventListener("click", (e) => {
        e.preventDefault();
        process(path);
      });
      cell.append(button);
      row.append(cell);
    }
    const busy = state && (state.status === "queued" || state.status === "processing");
    button.classList.toggle("is-hidden", !!busy);
    button.title = state ? options.labels.reprocess : options.labels.process;
  }

  function decorateAll() {
    document.querySelectorAll("#browse-results tr[value]").forEach(decorate);
  }

  function process(path) {
    $.post(options.processUrl, { song: path }).fail((xhr) => {
      const message = (xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText;
      if (window.showNotification) window.showNotification(message, "is-danger");
    });
  }

  window.aiLibrary = function (opts) {
    options = opts;
    $.getJSON(opts.statusUrl, (data) => {
      options.enabled = data.enabled;
      states = new Map(data.songs.map((s) => [s.file_path, s]));
      decorateAll();
    });
    window.onPageSocket("ai_status", (state) => {
      states.set(state.file_path, state);
      document
        .querySelectorAll("#browse-results tr[value]")
        .forEach((row) => row.getAttribute("value") === state.file_path && decorate(row));
    });
    // Filtering swaps the results table in place; re-tag the new rows.
    if (observer) observer.disconnect();
    const results = document.getElementById("browse-results");
    if (results) {
      observer = new MutationObserver(decorateAll);
      observer.observe(results, { childList: true });
    }
  };
})();
