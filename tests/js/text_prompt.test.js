// The text prompt (spa-navigation.js) and its required mode, which asks a first
// visitor for their name with no way to skip it.

import $ from "jquery";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const MODAL = `
  <div class="modal" id="text-prompt-modal">
    <div class="modal-background"></div>
    <div class="modal-card">
      <header class="modal-card-head">
        <p id="text-prompt-title"></p>
        <button class="delete text-prompt-cancel"></button>
      </header>
      <section class="modal-card-body">
        <p id="text-prompt-message"></p>
        <label id="text-prompt-label"></label>
        <input id="text-prompt-input" />
        <p id="text-prompt-help"></p>
      </section>
      <footer class="modal-card-foot">
        <button id="text-prompt-ok">Save</button>
        <button class="text-prompt-cancel">Cancel</button>
      </footer>
    </div>
  </div>`;

beforeAll(async () => {
  globalThis.$ = globalThis.jQuery = $;
  await import("../../pikaraoke/static/spa-navigation.js");
});

beforeEach(() => {
  document.body.innerHTML = MODAL;
});

function press(key) {
  $("#text-prompt-input").trigger($.Event("keydown", { key }));
}

describe("promptForText", () => {
  it("lets an ordinary prompt be cancelled with Escape", () => {
    let rejected = false;
    window.promptForText({ title: "Rename" }).fail(() => (rejected = true));

    press("Escape");

    expect(rejected).toBe(true);
    expect($("#text-prompt-modal").hasClass("is-active")).toBe(false);
  });

  it("gives a required prompt no way out but saving a name", () => {
    let saved = null;
    let rejected = false;
    window
      .promptForText({ title: "Profile", required: true })
      .done((name) => (saved = name))
      .fail(() => (rejected = true));

    expect($(".text-prompt-cancel").toArray().every((b) => $(b).hasClass("is-hidden"))).toBe(true);
    press("Escape");
    $(".modal-background").trigger("click");
    press("Enter"); // a blank name is not a name
    expect(rejected).toBe(false);
    expect($("#text-prompt-modal").hasClass("is-active")).toBe(true);

    $("#text-prompt-input").val("Sebastian");
    press("Enter");

    expect(saved).toBe("Sebastian");
    expect($("#text-prompt-modal").hasClass("is-active")).toBe(false);
  });

  it("shows the cancel buttons again on the next ordinary prompt", () => {
    window.promptForText({ required: true });
    $("#text-prompt-input").val("Dani");
    press("Enter");

    window.promptForText({ title: "Rename" });

    expect($(".text-prompt-cancel").toArray().some((b) => $(b).hasClass("is-hidden"))).toBe(false);
  });
});
