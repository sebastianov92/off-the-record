import { defineConfig } from "vitest/config";

// Coverage is scoped to first-party files with their own tests: splash.js and the
// webOS app's server-side parts. Vendored files are excluded by the include list, not an
// omission list, so a re-vendor cannot silently enter the coverage denominator.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/js/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: [
        "pikaraoke/static/js/splash.js",
        "pikaraoke/static/ai/pitch-clock.js",
        "pikaraoke/static/ai/tv-bridge.js",
        "pikaraoke/static/ai/buffer-guide.js",
      ],
      reporter: ["text", "html"],
      reportsDirectory: "coverage/js",
    },
  },
});
