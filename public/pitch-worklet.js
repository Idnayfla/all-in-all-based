/**
 * OLA pitch-shifter AudioWorklet — pitch shift WITHOUT tempo change, NO static.
 *
 * Algorithm (Overlap-Add grain pitch shifting):
 *   Each output grain reads FRAME input samples, but samples are spaced `pitch`
 *   apart in the input (i * pitch instead of i).  This stretches or compresses
 *   the frequency content within the grain → pitch change.
 *
 *   Both the input cursor (inGrain) and output cursor (outGrain) advance by the
 *   same fixed HOP → input consumption rate = output rate → tempo unchanged.
 *
 * v3 static fix (root cause):
 *   outRead advanced every call even before any grains were generated, so the
 *   reader raced ahead of outGrain into zero-filled buffer.  When grains finally
 *   arrived at an earlier buffer position the reader had already passed, their
 *   contributions were either lost or collided with later reads, producing pops.
 *   Fix: `available = min(n, outGrain − outRead)` — outRead never moves past
 *   outGrain, so the reader always has real data or outputs clean silence.
 */

const FRAME = 2048;    // grain size (larger = fewer artifacts, more latency ~85 ms)
const HOP   = 512;     // hop = FRAME / 4 → 75 % overlap → Hann OLA gain ≈ 2
const SZ    = 131072;  // ring-buffer size, power of 2, must be >> FRAME * maxPitch
const MASK  = SZ - 1;

class PitchShifterProcessor extends AudioWorkletProcessor {
  constructor () {
    super();
    this._pitch     = 1.0;
    this._inBuf     = new Float32Array(SZ);
    this._outBuf    = new Float32Array(SZ);
    this._win       = new Float32Array(FRAME);
    this._inWritten = 0;    // total samples pushed into inBuf
    this._inGrain   = 0.0;  // fractional read-cursor for next input grain
    this._outGrain  = 0;    // write-cursor for next output grain
    this._outRead   = 0;    // playback read-cursor in outBuf

    // Hann window — goes to 0 at both edges, sum of 4 overlapping = ≈ 2
    for (let i = 0; i < FRAME; i++) {
      this._win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FRAME - 1)));
    }

    this.port.onmessage = ({ data }) => {
      if (data.pitch != null) {
        this._pitch = Math.max(0.25, Math.min(4.0, data.pitch));
      }
    };
  }

  process (inputs, outputs) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;
    const n = inp.length; // 128 per AudioWorklet spec

    // ── 1. Accumulate input ──────────────────────────────────────────────────
    for (let i = 0; i < n; i++) {
      this._inBuf[(this._inWritten + i) & MASK] = inp[i];
    }
    this._inWritten += n;

    // ── 2. Synthesise grains until output buffer is n*4 samples ahead ────────
    while (this._outGrain - this._outRead < n * 4) {
      const pitch = this._pitch;
      // A grain spans FRAME samples in output but FRAME*pitch samples in input
      if (this._inGrain + Math.ceil(FRAME * pitch) > this._inWritten) break;

      // Overlap-add one Hann-windowed grain
      for (let i = 0; i < FRAME; i++) {
        const pos = this._inGrain + i * pitch; // pitch-scaled read position
        const p0  = Math.floor(pos);
        const f   = pos - p0;
        const s   = this._inBuf[ p0      & MASK] * (1 - f)
                  + this._inBuf[(p0 + 1) & MASK] *      f;
        this._outBuf[(this._outGrain + i) & MASK] += s * this._win[i];
      }

      // Both cursors advance by the SAME fixed HOP.
      // Pitch shift comes from i*pitch spacing above, not from different rates.
      this._inGrain  += HOP;
      this._outGrain += HOP;
    }

    // ── 3. Read output — NEVER past what has been written ───────────────────
    // v3 fix: limit `available` so outRead never overtakes outGrain.
    // During the initial buffer-fill, this outputs clean zeros instead of
    // reading from positions that haven't received grain data yet.
    const available = Math.min(n, this._outGrain - this._outRead);
    const gain = 2.0 / (FRAME / HOP); // ≈ 0.5 — normalises the Hann OLA sum

    for (let i = 0; i < available; i++) {
      const idx = (this._outRead + i) & MASK;
      out[i] = this._outBuf[idx] * gain;
      this._outBuf[idx] = 0; // clear so later grain overlap-add starts clean
    }
    for (let i = available; i < n; i++) {
      out[i] = 0; // clean silence during the initial buffer-fill latency
    }
    this._outRead += available; // only advance by what was actually output

    return true;
  }
}

registerProcessor('pitch-shifter', PitchShifterProcessor);
