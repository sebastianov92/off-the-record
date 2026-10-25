// Animated backgrounds for AI songs on the splash screen: four WebGL styles times
// twenty palettes. Each song gets a fixed combination from its id; "another
// background" on the phone bumps a variant counter to the next one.
(function () {
  const PALETTES = [
    ["#FF5E62", "#FF9966", "#FFD194"], // sunset
    ["#00C9A7", "#845EC2", "#4FFBDF", "#D65DB1"], // aurora
    ["#0F2027", "#2C5364", "#48C6EF", "#6F86D6"], // ocean
    ["#A18CD1", "#FBC2EB", "#E0C3FC"], // lavender
    ["#F12711", "#F5AF19", "#5B0E2D"], // embers
    ["#FF00CC", "#333399", "#00F5FF"], // neon
    ["#43E97B", "#38F9D7", "#E0FFF5"], // mint
    ["#F4C4B0", "#E8A0A0", "#B76E79", "#FFE5D9"], // rose gold
    ["#141E30", "#243B55", "#6A82FB", "#FC5C7D"], // midnight
    ["#F7971E", "#FFD200", "#FFF3B0"], // citrus
    ["#134E5E", "#71B280", "#C9E4CA"], // forest
    ["#FF9A9E", "#FAD0C4", "#A1C4FD"], // candy
    ["#00D2FF", "#3A7BD5", "#0B0F3A"], // blue flame
    ["#5B247A", "#1BCEDF", "#F64F59"], // grape
    ["#FF7E5F", "#FEB47B", "#FFE0C2"], // coral
    ["#11998E", "#38EF7D", "#F9F871"], // tropical
    ["#4B134F", "#C94B4B", "#F6A192"], // wine
    ["#E0EAFC", "#CFDEF3", "#A1C4FD", "#6A85B6"], // ice
    ["#FFDEE9", "#B5FFFC", "#FFF1C1"], // peach
    ["#7F00FF", "#E100FF", "#00E0FF"], // electric
  ];

  // Light styles are tinted fields (dark ink reads on them); dark styles glow on black.
  const STYLES = ["flow", "mesh", "orb", "fiber"];
  const DARK = new Set(["orb", "fiber"]);

  const VERTEX = "attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }";

  const COMMON = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_seed;
uniform float u_count;
uniform vec3 u_colors[5];

float hash(vec2 p) {
  p = fract(p * vec2(127.13, 311.71));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = turn * p; a *= 0.5; }
  return v;
}
vec3 colorAt(float i) {
  vec3 c = u_colors[0];
  for (int k = 1; k < 5; k++) { if (float(k) == i) c = u_colors[k]; }
  return c;
}
// Smooth loop through the palette; t wraps.
vec3 pal(float t) {
  float x = fract(t) * u_count;
  float i = floor(x);
  return mix(colorAt(i), colorAt(mod(i + 1.0, u_count)), smoothstep(0.0, 1.0, fract(x)));
}
// Where colour k sits, fixed per song by the seed.
vec2 spot(float k) {
  return vec2(0.15 + 0.7 * hash(vec2(k, u_seed)), 0.15 + 0.7 * hash(vec2(u_seed, k + 3.1)));
}
`;

  const SHADERS = {
    flow: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * 3.5;
  float t = u_time * 0.16;
  vec2 dir = vec2(0.707, -0.707);
  vec2 q = vec2(fbm(p + dir * t), fbm(p + vec2(5.2, 1.3) - dir * t));
  vec2 r = vec2(fbm(p + 2.6 * q + vec2(1.7, 9.2) + 0.6 * t), fbm(p + 2.6 * q + vec2(8.3, 2.8) - 0.6 * t));
  vec2 w = uv + (r - 0.5) * 0.55;
  vec3 col = vec3(0.0);
  float sum = 0.0;
  for (int k = 0; k < 5; k++) {
    if (float(k) >= u_count) break;
    vec2 d = w - spot(float(k));
    d.x *= aspect;
    float g = exp(-dot(d, d) * 5.5);
    col += u_colors[k] * g;
    sum += g;
  }
  col = mix(u_colors[0], col / max(sum, 1e-4), clamp(sum * 1.4, 0.0, 1.0));
  col += ((r.x - r.y) + (q.x - 0.5) * 0.6) * 0.22;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,
    mesh: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  float t = u_time;
  vec3 col = vec3(0.0);
  float sum = 0.0;
  for (int k = 0; k < 5; k++) {
    float fk = float(k);
    if (fk >= u_count) break;
    vec2 c = spot(fk) + 0.18 * vec2(sin(t * 0.35 * (fk + 1.0) + u_seed), cos(t * 0.28 * (fk + 2.0) + u_seed * 1.7));
    vec2 d = uv - c;
    d.x *= aspect;
    float g = exp(-dot(d, d) * 3.0);
    col += u_colors[k] * g;
    sum += g;
  }
  col /= max(sum, 1e-4);
  col += (hash(gl_FragCoord.xy + fract(t)) - 0.5) * 0.025; // fine grain against banding
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,
    orb: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  float t = u_time;
  vec2 c = vec2(0.5 + 0.05 * sin(t * 0.4), 0.52 + 0.04 * cos(t * 0.35));
  vec2 d = (uv - c) * vec2(aspect, 1.0);
  float r = length(d);
  float R = 0.33 + 0.03 * sin(t * 1.1);
  float a = atan(d.y, d.x) / 6.2832;
  vec3 ring = pal(a + t * 0.08);
  float core = exp(-pow((r - R) / 0.012, 2.0));
  float glow = exp(-pow((r - R) / 0.09, 2.0)) * 0.55 + exp(-pow((r - R) / 0.3, 2.0)) * 0.2;
  float wisp = fbm(vec2(a * 9.0, r * 6.0 - t * 0.6));
  vec3 col = ring * (core * 1.4 + glow * (0.6 + 0.6 * wisp));
  col += pal(t * 0.01) * 0.04;
  gl_FragColor = vec4(1.0 - exp(-col * 1.6), 1.0);
}`,
    fiber: `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float t = u_time;
  vec3 col = vec3(0.0);
  float base = 0.5 + 0.16 * sin(uv.x * 2.4 + t * 0.4 + u_seed);
  float spread = 0.03 + 0.55 * pow(uv.x, 1.6);
  for (int i = 0; i < 28; i++) {
    float fi = float(i) / 27.0;
    float y = base + (fi - 0.5) * spread + 0.025 * sin(t * 1.0 + fi * 12.0 + uv.x * 3.0);
    float d = uv.y - y;
    float w = 0.0018 + 0.004 * uv.x;
    col += pal(fi * 0.8 + t * 0.06) * (exp(-d * d / (w * w)) * 0.55 + exp(-d * d / 0.0006) * 0.05);
  }
  gl_FragColor = vec4(1.0 - exp(-col * 1.3), 1.0);
}`,
  };

  function rgb(hex) {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  }

  function luminance([r, g, b]) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Full-avalanche integer hash: low song ids (a small library) still spread over
  // every style. Unsigned: `^` alone returns a signed int, and a negative index finds no style.
  function hashId(n) {
    let h = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // Combination for a song: its id spreads songs over the grid, the variant steps it.
  function pick(songId, variant) {
    const i = hashId(songId) + variant * 7;
    const style = STYLES[i % STYLES.length];
    const palette = PALETTES[Math.floor(i / STYLES.length) % PALETTES.length];
    return look(style, palette, (hashId(songId) % 1000) / 37);
  }

  function look(style, palette, seed) {
    let colors = palette.map(rgb);
    if (DARK.has(style)) {
      // Near-black colours vanish on a black background.
      const bright = colors.filter((c) => luminance(c) > 0.18);
      colors = bright.length >= 2 ? bright : colors.map((c) => c.map((v) => 0.35 + 0.65 * v));
    }
    const mean = colors.reduce((s, c) => s + luminance(c), 0) / colors.length;
    const ink = DARK.has(style) || mean < 0.5 ? "light" : "dark";
    return { style, colors, ink, seed };
  }

  class Backgrounds {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext("webgl", { antialias: false, alpha: false });
      this.programs = {};
      this.raf = 0;
      this.elapsed = Math.random() * 200;
      this.still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (this.gl) {
        const buf = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buf);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), this.gl.STATIC_DRAW);
      }
    }

    program(style) {
      if (this.programs[style] !== undefined) return this.programs[style];
      const gl = this.gl;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.error(`AI background ${style}:`, gl.getShaderInfoLog(s));
          return null;
        }
        return s;
      };
      const vs = compile(gl.VERTEX_SHADER, VERTEX);
      const fs = compile(gl.FRAGMENT_SHADER, COMMON + SHADERS[style]);
      let prog = null;
      if (vs && fs) {
        prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) prog = null;
      }
      this.programs[style] = prog;
      return prog;
    }

    // Returns "dark" or "light": the ink the lyrics should use on top of it.
    show(songId, variant) {
      return this.present(pick(songId, variant));
    }

    // One fixed look rather than a song's: the idle screen's style and colours.
    showPalette(style, palette) {
      return this.present(look(style, palette, 0));
    }

    present(choice) {
      this.choice = choice;
      this.canvas.dataset.style = choice.style;
      const prog = this.gl && this.program(choice.style);
      this.canvas.hidden = !prog;
      if (!prog) return "light";
      const gl = this.gl;
      gl.useProgram(prog);
      const pos = gl.getAttribLocation(prog, "a_pos");
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      const colors = choice.colors.slice(0, 5);
      const flat = colors.flat();
      while (flat.length < 15) flat.push(0);
      const u = (name) => gl.getUniformLocation(prog, name);
      gl.uniform3fv(u("u_colors"), flat);
      gl.uniform1f(u("u_count"), colors.length);
      gl.uniform1f(u("u_seed"), choice.seed);
      this.uRes = u("u_res");
      this.uTime = u("u_time");
      this.start();
      return choice.ink;
    }

    frame() {
      const c = this.canvas;
      // Half resolution: soft gradients do not need more, and the TV stays cool.
      const w = Math.max(1, Math.round(c.clientWidth * 0.5));
      const h = Math.max(1, Math.round(c.clientHeight * 0.5));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
        this.gl.viewport(0, 0, w, h);
      }
      this.gl.uniform2f(this.uRes, w, h);
      this.gl.uniform1f(this.uTime, this.elapsed);
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }

    start() {
      this.stop();
      if (this.still) return this.frame();
      let last = performance.now();
      const loop = (now) => {
        this.elapsed += Math.min(0.1, (now - last) / 1000);
        last = now;
        this.frame();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  window.AiBackgrounds = Backgrounds;
  window.AiBackgrounds.STYLES = STYLES;
  window.AiBackgrounds.PALETTES = PALETTES;
})();
