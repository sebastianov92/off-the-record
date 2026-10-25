// Singer avatars (blobatar, vendored in static/blobatar): one face per name, drawn
// from the name itself, so the same singer looks the same on every phone and on
// the TV without anything stored. Any element with data-avatar-name gets one, now
// or whenever it appears; data-avatar-face picks an expression (happy, sleepy...).
// Loaded once by base.html, on every page and on the TV.
(function () {
  let lib = null;

  const escapeAttr = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  // Markup for an avatar slot, for code that builds rows as HTML strings.
  window.avatarTag = (name, cls = "avatar") =>
    name ? `<span class="${cls}" data-avatar-name="${escapeAttr(name)}"></span>` : "";

  function draw(el) {
    const name = (el.dataset.avatarName || "").trim();
    const faceName = el.dataset.avatarFace || "idle";
    const key = `${name}|${faceName}`;
    if (!lib || !name || el.dataset.avatarDrawn === key) return;
    const changedFace = el.dataset.avatarDrawn && el.dataset.avatarDrawn.startsWith(`${name}|`);
    el.dataset.avatarDrawn = key;
    el.innerHTML = lib.blobatar(name, { expression: lib.faces[faceName] || lib.faces.idle });
    // Name the two parts (body, then eyes; a pose may wrap them in one more group)
    // so the TV can move the eyes and the body to the beat.
    const parts = [...el.querySelectorAll("svg g")].filter((g) => !g.querySelector("g"));
    if (parts.length === 2) {
      parts[0].classList.add("avatar-body");
      parts[1].classList.add("avatar-eyes");
    }
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", name);
    if (changedFace) {
      // A new expression lands with a small bounce; the library's own morph needs a framework.
      el.classList.remove("avatar-pop");
      void el.offsetWidth;
      el.classList.add("avatar-pop");
    }
  }

  function drawWithin(root) {
    if (root.nodeType !== 1) return;
    if (root.dataset.avatarName !== undefined) draw(root);
    root.querySelectorAll("[data-avatar-name]").forEach(draw);
  }

  // The menu's person item: the singer's own face once they have a name, the glyph before.
  function syncSelf() {
    const slot = document.querySelector("#current-user .singer-avatar");
    if (!slot) return;
    const name = window.Cookies && Cookies.get("user");
    // Written only on a change: an unchanged write still wakes the observer, which calls this.
    if (name) {
      if (slot.dataset.avatarName !== name) slot.dataset.avatarName = name;
    } else if (slot.dataset.avatarName) {
      delete slot.dataset.avatarName;
      delete slot.dataset.avatarDrawn;
      slot.innerHTML = '<i class="icon icon-user-circle-o"></i>';
    }
  }

  // The profile dialog shows the face a name makes while it is typed.
  function previewInProfile() {
    const modal = document.getElementById("text-prompt-modal");
    const input = document.getElementById("text-prompt-input");
    const title = document.getElementById("text-prompt-title");
    if (!modal || !input || !title) return;
    let preview = modal.querySelector(".avatar-preview");
    const isProfile = modal.classList.contains("is-active") &&
      title.textContent === (window.translations && window.translations.identityTitle);
    if (!isProfile) {
      if (preview) preview.remove();
      return;
    }
    if (!preview) {
      preview = document.createElement("span");
      preview.className = "avatar-preview";
      modal.querySelector(".modal-card-body").prepend(preview);
    }
    if (preview.dataset.avatarName !== input.value) preview.dataset.avatarName = input.value;
    preview.hidden = !input.value.trim();
  }

  function watch() {
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "attributes") draw(r.target);
        else r.addedNodes.forEach(drawWithin);
      }
      syncSelf();
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-avatar-name", "data-avatar-face"],
    });
    const modal = document.getElementById("text-prompt-modal");
    if (modal) {
      new MutationObserver(previewInProfile).observe(modal, { attributes: true, attributeFilter: ["class"] });
      document.getElementById("text-prompt-input").addEventListener("input", previewInProfile);
    }
  }

  $(function () {
    const base = `${window.pikaraokeConfig.basePath}/static/blobatar`;
    Promise.all([import(`${base}/index.js`), import(`${base}/expression.js`)])
      .then(([core, faces]) => {
        lib = { blobatar: core.blobatar, faces };
        syncSelf();
        drawWithin(document.body);
        watch();
      })
      .catch((e) => console.error("Avatars unavailable:", e));
  });
})();
