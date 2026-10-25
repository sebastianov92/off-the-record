// Unit tests for the splash screen's animated backgrounds: every song id and
// every "another background" step must land on a real style and palette.

import { beforeAll, describe, expect, it } from "vitest";

let AiBackgrounds;

beforeAll(async () => {
  // jsdom has neither matchMedia nor WebGL.
  window.matchMedia = () => ({ matches: false });
  HTMLCanvasElement.prototype.getContext = () => null;
  await import("../../pikaraoke/static/ai/backgrounds.js");
  AiBackgrounds = globalThis.AiBackgrounds;
});

describe("AiBackgrounds.show", () => {
  it("finds a style for every song id and variant", () => {
    // jsdom has no WebGL, so show() stops after choosing; the choice is what is tested.
    const backgrounds = new AiBackgrounds(document.createElement("canvas"));
    for (let songId = 1; songId <= 500; songId++) {
      for (let variant = 0; variant < 8; variant++) {
        expect(["light", "dark"]).toContain(backgrounds.show(songId, variant));
        expect(backgrounds.choice.style).toBeTruthy();
        expect(backgrounds.choice.colors.length).toBeGreaterThan(0);
      }
    }
  });

  it("shows a fixed style and palette for the idle screen", () => {
    const backgrounds = new AiBackgrounds(document.createElement("canvas"));

    const ink = backgrounds.showPalette("flow", ["#4A00E0", "#8E2DE2", "#FF6FB5"]);

    expect(backgrounds.choice.style).toBe("flow");
    expect(backgrounds.choice.colors).toHaveLength(3);
    expect(ink).toBe("light");
  });
});
