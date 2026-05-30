import io
import base64
import modal

app = modal.App("based-tts")

voice_vol = modal.Volume.from_name("based-voice-clips", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install("f5-tts", "soundfile", "numpy")
)


REF_AUDIO = "/voice-clips/based-voice-american-2.mp3"


@app.cls(
    image=image,
    gpu="T4",
    volumes={"/voice-clips": voice_vol},
    scaledown_window=300,
    timeout=60,
)
class BasedTTS:
    @modal.enter()
    def load_model(self):
        from f5_tts.api import F5TTS
        from f5_tts.infer.utils_infer import transcribe
        self.model = F5TTS()
        # Transcribe the reference clip ONCE at container startup — not on every request.
        # This eliminates the ~8-10s Whisper overhead per generation call.
        self.ref_text = transcribe(REF_AUDIO)
        print(f"[based-tts] ref_text cached: {self.ref_text!r}")

    @modal.fastapi_endpoint(method="GET")
    def health(self):
        return {"ok": True}

    @modal.fastapi_endpoint(method="POST")
    def generate(self, body: dict) -> dict:
        import soundfile as sf
        import numpy as np

        text = (body.get("text") or "").strip()
        if not text or len(text) > 1000:
            return {"error": "invalid text"}

        wav, sr, _ = self.model.infer(
            ref_file=REF_AUDIO,
            ref_text=self.ref_text,
            gen_text=text,
            speed=1.0,
            nfe_step=16,  # half the default steps — 2x faster, minimal quality loss
        )

        buf = io.BytesIO()
        data = wav if isinstance(wav, np.ndarray) else wav.numpy()
        sf.write(buf, data, sr, format="WAV")

        return {"audioBase64": base64.b64encode(buf.getvalue()).decode()}
