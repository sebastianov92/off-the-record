// The organised library page: songs and artists with search and filters, uploads,
// bulk metadata lookup, and admin fixes (metadata, rename and merge artists).
// Loaded once by the SPA; library.html calls catalogLibrary() on every visit.
(function () {
  let opts, filters = {}, artistFilter = null, editing = null, merging = null;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(name) {
    return el("i", `icon icon-${name}`);
  }

  // Rows shaped like the ones on their way, shown only while a list is still blank.
  function skeleton(list, rows) {
    if (list.children.length) return;
    list.replaceChildren(...Array.from({ length: rows }, () => {
      const row = el("div", "skeleton-row");
      const lines = el("div", "skeleton-lines");
      lines.append(el("div", "skeleton-block skeleton-line"), el("div", "skeleton-block skeleton-line is-short"));
      row.append(el("div", "skeleton-block skeleton-cover"), lines);
      return row;
    }));
  }

  // An empty list keeps its frame and says, in one line, what to do next.
  function emptyState(title, text) {
    const box = el("p", "empty-state");
    box.append(el("span", "empty-title", title), ` ${text}`);
    return box;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function api(path) {
    return opts.base + path;
  }

  function status(text) {
    $("#library-status").prop("hidden", !text).text(text || "");
  }

  function fillSelect(id, label, values, format) {
    const select = document.getElementById(id);
    const keep = select.value;
    select.replaceChildren(new Option(`${label}: ${opts.labels.all}`, ""));
    values.forEach((v) => select.append(new Option(format ? format(v) : v, v)));
    select.value = keep;
  }

  function loadFilters() {
    $.getJSON(api("/api/catalog/filters"), (f) => {
      fillSelect("filter-language", opts.labels.language, f.languages, (l) => l.toUpperCase());
      fillSelect("filter-genre", opts.labels.genre, f.genres);
      fillSelect("filter-decade", opts.labels.decade, f.decades, (d) => `${d}s`);
    });
    const states = ["ready", "processing", "original", "no_vocals", "error", "review"];
    fillSelect("filter-state", opts.labels.state, states, (s) => opts.labels[s]);
    const sort = document.getElementById("filter-sort");
    if (!sort.options.length) {
      [["title", opts.labels.byTitle], ["artist", opts.labels.byArtist], ["recent", opts.labels.recent]]
        .forEach(([v, t]) => sort.append(new Option(`${opts.labels.sort}: ${t}`, v)));
    }
  }

  // Colour only where a song needs attention or is on its way; ready is the normal state.
  const TAG = { processing: "is-info", no_vocals: "is-warning", error: "is-danger" };

  function songRow(song) {
    const row = el("div", "library-row");
    let cover;
    if (song.cover) {
      cover = el("img", "library-cover");
      cover.src = api(`/catalog/covers/${song.id}.jpg`);
      cover.alt = "";
    } else {
      cover = el("div", "library-cover");
      cover.append(icon("music"));
    }

    const body = el("div", "library-body");
    const name = song.title || song.file_path.split("/").pop().replace(/\.[^.]+$/, "");
    body.append(el("div", "library-title", name));
    const sub = el("div", "library-sub");
    song.artists.forEach((a, i) => {
      if (i) sub.append(a.role === "guest" && song.artists[i - 1].role === "main" ? " feat. " : ", ");
      const link = el("a", null, a.name);
      link.href = "#";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        filterByArtist(a);
      });
      sub.append(link);
    });
    const details = [song.year, song.genre, song.language && song.language.toUpperCase()].filter(Boolean);
    if (details.length) sub.append(`${song.artists.length ? " · " : ""}${details.join(" · ")}`);
    body.append(sub);

    const tags = el("div", "tags mt-1 mb-0");
    if (song.state !== "original") {
      const text = song.state === "processing"
        ? `${opts.labels.processing} ${Math.round(song.ai_progress || 0)}%`
        : opts.labels[song.state];
      // A song in the AI queue links to the conversions page.
      const linked = song.state === "processing" && opts.admin;
      const tag = el(linked ? "a" : "span", `tag is-light ${TAG[song.state] || ""}`, text);
      if (linked) tag.href = api("/processing");
      tags.append(tag);
    }
    if (song.metadata_status === "review") tags.append(el("span", "tag is-link is-light", opts.labels.review));
    if (song.lyrics_source === "lrclib") tags.append(el("span", "tag is-light", opts.labels.realLyrics));
    if (tags.children.length) body.append(tags);

    const actions = el("div", "library-actions");
    const add = el("a", "add-song-link has-text-success");
    add.href = "#";
    add.title = opts.labels.addToQueue;
    add.setAttribute("data-song", encodeURIComponent(song.file_path));
    add.append(icon("list-add"));
    actions.append(add);
    if (opts.admin) {
      const edit = el("a");
      edit.href = "#";
      edit.title = opts.labels.edit;
      edit.append(icon("edit-1"));
      edit.addEventListener("click", (e) => {
        e.preventDefault();
        openEditor(song);
      });
      actions.append(edit);
    }
    row.append(cover, body, actions);
    return row;
  }

  function loadSongs() {
    const params = {
      q: $("#song-search").val(),
      state: $("#filter-state").val(),
      language: $("#filter-language").val(),
      genre: $("#filter-genre").val(),
      decade: $("#filter-decade").val(),
      sort: $("#filter-sort").val() || "title",
    };
    if (artistFilter) params.artist = artistFilter.id;
    const list = document.getElementById("song-list");
    skeleton(list, 6);
    $.getJSON(api("/api/catalog/songs"), params, (songs) => {
      list.replaceChildren(...songs.map(songRow));
      if (!songs.length) {
        const filtered = Object.entries(params).some(([k, v]) => k !== "sort" && v);
        list.append(filtered
          ? emptyState(opts.labels.noSongs, opts.labels.tryAnother)
          : emptyState(opts.labels.emptyLibrary, opts.labels.emptyLibraryHint));
      }
      $("#song-count").text(`${songs.length} ${opts.labels.songs}`);
    });
  }

  function filterByArtist(artist) {
    artistFilter = artist;
    $("#artist-filter").toggleClass("is-hidden", !artist);
    $("#artist-filter-name").text(artist ? artist.name : "");
    showTab("songs");
    loadSongs();
  }

  function artistRow(artist, all) {
    const row = el("div", "library-row");
    const body = el("div", "library-body");
    const link = el("a", "library-title", artist.name);
    link.href = "#";
    link.addEventListener("click", (e) => {
      e.preventDefault();
      filterByArtist(artist);
    });
    body.append(link, el("div", "library-sub", `${artist.songs} ${opts.labels.songs}`));
    row.append(body);
    if (opts.admin) {
      const actions = el("div", "library-actions");
      const rename = el("a");
      rename.href = "#";
      rename.title = opts.labels.rename;
      rename.append(icon("pencil"));
      rename.addEventListener("click", (e) => {
        e.preventDefault();
        const name = prompt(opts.labels.renamePrompt, artist.name);
        if (name && name.trim() && name.trim() !== artist.name) {
          postJSON(`/api/catalog/artists/${artist.id}/rename`, { name: name.trim() }).done(refresh);
        }
      });
      const merge = el("a");
      merge.href = "#";
      merge.title = opts.labels.merge;
      merge.append(icon("exchange"));
      merge.addEventListener("click", (e) => {
        e.preventDefault();
        openMerge(artist, all);
      });
      actions.append(rename, merge);
      row.append(actions);
    }
    return row;
  }

  function loadArtists() {
    const q = $("#artist-search").val();
    const list = document.getElementById("artist-list");
    skeleton(list, 6);
    $.getJSON(api("/api/catalog/artists"), { q }, (artists) => {
      list.replaceChildren(...artists.map((a) => artistRow(a, artists)));
      if (!artists.length) {
        list.append(q
          ? emptyState(opts.labels.noArtists, opts.labels.tryAnother)
          : emptyState(opts.labels.emptyLibrary, opts.labels.emptyLibraryHint));
      }
    });
  }

  function showTab(tab) {
    $(".tabs li").each(function () {
      $(this).toggleClass("is-active", this.dataset.tab === tab);
    });
    $("#tab-songs").prop("hidden", tab !== "songs");
    $("#tab-artists").prop("hidden", tab !== "artists");
    if (tab === "artists") loadArtists();
  }

  function postJSON(path, data) {
    return $.ajax({ url: api(path), type: "POST", contentType: "application/json", data: JSON.stringify(data) });
  }

  function refresh() {
    loadFilters();
    loadSongs();
    if (!$("#tab-artists").prop("hidden")) loadArtists();
  }

  // Metadata editor --------------------------------------------------------

  function openEditor(song) {
    editing = { id: song.id, extra: {} };
    const main = song.artists.filter((a) => a.role === "main").map((a) => a.name).join(" & ");
    const guests = song.artists.filter((a) => a.role === "guest").map((a) => a.name).join(", ");
    $("#meta-artist").val(main + (guests ? ` feat. ${guests}` : ""));
    $("#meta-title").val(song.title || "");
    $("#meta-year").val(song.year || "");
    $("#meta-genre").val(song.genre || "");
    $("#meta-query").val([main, song.title].filter(Boolean).join(" - "));
    $("#meta-suggestions").empty();
    $("#meta-refresh-lyrics").prop("hidden", song.ai_status !== "ready").prop("disabled", false);
    $("#meta-modal").addClass("is-active");
  }

  function searchSuggestions() {
    const box = $("#meta-suggestions").text(opts.labels.searching);
    $.getJSON(api(`/api/catalog/songs/${editing.id}/suggestions`), { q: $("#meta-query").val() }, (list) => {
      box.empty();
      if (!list.length) box.text(opts.labels.noMatches);
      list.forEach((s) => {
        const item = el("div", "box p-2 mb-2 suggestion");
        item.append(el("div", "has-text-weight-bold", `${s.artist} - ${s.title}`));
        item.append(el("div", "is-size-7", [s.album, s.year, s.genre].filter(Boolean).join(" · ")));
        item.addEventListener("click", () => {
          $("#meta-artist").val(s.artist);
          $("#meta-title").val(s.title);
          $("#meta-year").val(s.year || "");
          $("#meta-genre").val(s.genre || "");
          editing.extra = { album: s.album, artwork: s.artwork, artist_id: s.artist_id };
        });
        box.append(item);
      });
    });
  }

  function saveMeta() {
    postJSON(`/api/catalog/songs/${editing.id}/meta`, {
      artist: $("#meta-artist").val(),
      title: $("#meta-title").val(),
      year: $("#meta-year").val(),
      genre: $("#meta-genre").val(),
      ...editing.extra,
    }).done(() => {
      $("#meta-modal").removeClass("is-active");
      refresh();
    });
  }

  // Merge -----------------------------------------------------------------

  function openMerge(artist, all) {
    merging = artist;
    $("#merge-title").text(`${opts.labels.mergeInto}: ${artist.name}`);
    const select = document.getElementById("merge-target");
    select.replaceChildren(...all.filter((a) => a.id !== artist.id).map((a) => new Option(a.name, a.id)));
    $("#merge-modal").addClass("is-active");
  }

  function saveMerge() {
    postJSON("/api/catalog/artists/merge", {
      source: merging.id,
      target: Number($("#merge-target").val()),
    }).done(() => {
      $("#merge-modal").removeClass("is-active");
      refresh();
    });
  }

  // Upload and organise ------------------------------------------------------

  function upload(file) {
    const form = new FormData();
    form.append("file", file);
    $.ajax({
      url: api("/api/catalog/upload"),
      type: "POST",
      data: form,
      processData: false,
      contentType: false,
      xhr: () => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) status(`${opts.labels.uploading} ${Math.round((e.loaded / e.total) * 100)}%`);
        };
        return xhr;
      },
    }).done(() => {
      status(opts.labels.uploaded);
      setTimeout(() => status(""), 4000);
      refresh();
    }).fail((xhr) => status((xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText));
  }

  window.catalogLibrary = function (options) {
    opts = options;
    artistFilter = null;
    loadFilters();
    loadSongs();

    $(".tabs li").off("click").on("click", function () {
      showTab(this.dataset.tab);
    });
    $("#song-search").off("input").on("input", debounce(loadSongs, 250));
    $("#artist-search").off("input").on("input", debounce(loadArtists, 250));
    $(".library-filters select").off("change").on("change", loadSongs);
    $("#artist-filter-clear").off("click").on("click", () => filterByArtist(null));
    $("#meta-search").off("click").on("click", searchSuggestions);
    $("#meta-save").off("click").on("click", saveMeta);
    $("#meta-refresh-lyrics").off("click").on("click", function () {
      $(this).prop("disabled", true);
      $.post(api(`/api/ai/lyrics/${editing.id}/refresh`)).done(() => status(opts.labels.lyricsQueued));
    });
    $(".meta-close, #meta-modal .modal-background").off("click").on("click", () => $("#meta-modal").removeClass("is-active"));
    $("#merge-save").off("click").on("click", saveMerge);
    $(".merge-close, #merge-modal .modal-background").off("click").on("click", () => $("#merge-modal").removeClass("is-active"));
    $("#library-upload").off("change").on("change", function () {
      if (this.files[0]) upload(this.files[0]);
      this.value = "";
    });
    $("#library-organize").off("click").on("click", () => {
      $.post(api("/api/catalog/organize")).done((p) => status(`${opts.labels.organizing} 0/${p.total}`))
        .fail((xhr) => status((xhr.responseJSON && xhr.responseJSON.error) || xhr.statusText));
    });

    const reload = debounce(refresh, 800);
    window.onPageSocket("catalog_update", reload);
    window.onPageSocket("ai_status", reload);
    window.onPageSocket("song_downloaded", reload);
    window.onPageSocket("catalog_progress", (p) => {
      if (p.done >= p.total) {
        status(opts.labels.organized);
        setTimeout(() => status(""), 4000);
        refresh();
      } else {
        status(`${opts.labels.organizing} ${p.done}/${p.total}`);
      }
    });
  };
})();
