import createRNNWasmModuleSync from './rnnoise-sync.js';

const FRAME_SIZE = 480;

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ready = false;
    this._inBuf = new Float32Array(FRAME_SIZE);
    this._inLen = 0;
    this._outFrames = [];
    this._outFramePos = 0;

    try {
      const mod = createRNNWasmModuleSync();
      this._mod = mod;
      this._state = mod._rnnoise_create(0);
      this._inPtr = mod._malloc(FRAME_SIZE * 4);
      this._outPtr = mod._malloc(FRAME_SIZE * 4);
      this._inView = new Float32Array(mod.HEAPU8.buffer, this._inPtr, FRAME_SIZE);
      this._outView = new Float32Array(mod.HEAPU8.buffer, this._outPtr, FRAME_SIZE);
      this._ready = true;
      this.port.postMessage({ type: 'ready' });
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String(err) });
    }
  }

  _processFrame() {
    for (let i = 0; i < FRAME_SIZE; i++) {
      this._inView[i] = this._inBuf[i] * 32768;
    }
    this._mod._rnnoise_process_frame(this._state, this._outPtr, this._inPtr);
    const out = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) {
      out[i] = this._outView[i] / 32768;
    }
    this._outFrames.push(out);
  }

  process(inputs, outputs) {
    const inCh = inputs[0]?.[0];
    const outCh = outputs[0]?.[0];
    if (!inCh || !outCh) return true;

    if (!this._ready) {
      outCh.set(inCh);
      return true;
    }

    // Accumulate input; fire _processFrame every 480 samples
    let i = 0;
    while (i < inCh.length) {
      const take = Math.min(FRAME_SIZE - this._inLen, inCh.length - i);
      this._inBuf.set(inCh.subarray(i, i + take), this._inLen);
      this._inLen += take;
      i += take;
      if (this._inLen === FRAME_SIZE) {
        this._processFrame();
        this._inLen = 0;
      }
    }

    // Drain processed frames into output block
    let o = 0;
    while (o < outCh.length) {
      if (this._outFrames.length === 0) {
        outCh.fill(0, o);
        break;
      }
      const frame = this._outFrames[0];
      const avail = frame.length - this._outFramePos;
      const need = outCh.length - o;
      const copy = Math.min(avail, need);
      outCh.set(frame.subarray(this._outFramePos, this._outFramePos + copy), o);
      o += copy;
      this._outFramePos += copy;
      if (this._outFramePos >= frame.length) {
        this._outFrames.shift();
        this._outFramePos = 0;
      }
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
