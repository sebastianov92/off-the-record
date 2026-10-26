// The engine's YIN must read pitch like the splash's pitch-worklet.js, or the
// same singing would score differently on the TV. Both read the same synthetic
// takes; per held note, their medians must agree.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { it } from 'node:test';

const BIN = path.resolve(import.meta.dirname, '../build/otr-mic');
const WORKLET = path.resolve(import.meta.dirname, '../../../pikaraoke/static/ai/pitch-worklet.js');
const RATE = 48000;

// Held notes (Hz; vibrato in cents) with silence between them.
const NOTES = [
  { hz: 196, vib: 0 },
  { hz: 262, vib: 30 },
  { hz: 392, vib: 0 },
  { hz: 523, vib: 15 },
];

function synth() {
  const parts = [];
  for (const n of NOTES) {
    const len = RATE, x = new Float32Array(len);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const f = n.hz * 2 ** ((n.vib / 1200) * Math.sin((2 * Math.PI * 5 * i) / RATE));
      phase += (2 * Math.PI * f) / RATE;
      x[i] = 0.25 * (Math.sin(phase) + 0.4 * Math.sin(2 * phase) + 0.2 * Math.sin(3 * phase));
    }
    parts.push(x, new Float32Array(RATE / 2));
  }
  const all = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

function wav(x) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  return b;
}

// pitch-worklet.js in Node: just enough of the AudioWorklet globals.
function worklet(x) {
  const posted = [];
  let Processor;
  const context = {
    sampleRate: RATE,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (m) => posted.push(m.midi) };
      }
    },
    registerProcessor: (name, cls) => (Processor = cls),
    Float32Array,
    Math,
  };
  vm.runInNewContext(fs.readFileSync(WORKLET, 'utf8'), context);
  const p = new Processor();
  // Quantised like the WAV the engine reads.
  const q = Float32Array.from(x, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767) / 32768);
  for (let i = 0; i + 128 <= q.length; i += 128) p.process([[q.subarray(i, i + 128)]]);
  return posted;
}

const median = (a) => {
  const s = [...a].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
};

// The voiced frames of each held note, in order.
function notes(frames) {
  const groups = [];
  let current = null;
  for (const m of frames) {
    if (m > 0) {
      if (!current) groups.push((current = []));
      current.push(m);
    } else current = null;
  }
  return groups.filter((g) => g.length > 10).map(median);
}

it('reads each held note like the splash does', () => {
  const x = synth();
  const file = path.join(os.tmpdir(), `otr-yin-${process.pid}.wav`);
  fs.writeFileSync(file, wav(x));
  const engine = execFileSync(BIN, ['pitch', file], { encoding: 'utf8' }).trim().split('\n').map(Number);
  fs.unlinkSync(file);
  const browser = worklet(x);
  const e = notes(engine), b = notes(browser);
  assert.equal(e.length, NOTES.length);
  assert.equal(b.length, NOTES.length);
  NOTES.forEach((n, i) => {
    const expected = 69 + 12 * Math.log2(n.hz / 440);
    assert.ok(Math.abs(e[i] - b[i]) < 0.05, `note ${i}: engine ${e[i]} vs splash ${b[i]}`);
    assert.ok(Math.abs(e[i] - expected) < 0.15, `note ${i}: engine ${e[i]} vs ${expected}`);
  });
});
