import io
import os
import base64
import tempfile
import modal

app = modal.App("based-rvc")

# Mirror the based-tts pattern: GPU cls + Modal Volume for model files
image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install([
        "rvc-python==0.1.8",
        "torch==2.1.0",
        "torchaudio==2.1.0",
        "soundfile",
        "numpy",
        "huggingface_hub",
    ])
)

voice_vol = modal.Volume.from_name("based-rvc-models", create_if_missing=True)

MODEL_DIR = "/rvc-models"
MODEL_PATH = f"{MODEL_DIR}/voice.pth"
INDEX_PATH = f"{MODEL_DIR}/voice.index"


@app.cls(
    image=image,
    gpu="T4",
    volumes={MODEL_DIR: voice_vol},
    scaledown_window=300,
    timeout=120,
)
class RVCVoice:
    @modal.build()
    def download_base_models(self):
        """Download HuBERT and RMVPE base models required by RVC (once at build time)."""
        from huggingface_hub import hf_hub_download
        import shutil

        os.makedirs("/root/.cache/rvc", exist_ok=True)
        for filename in ["hubert_base.pt", "rmvpe.pt"]:
            hf_hub_download(
                repo_id="lj1995/VoiceConversionWebUI",
                filename=filename,
                local_dir="/root/.cache/rvc",
            )
        print("[based-rvc] Base models downloaded.")

    @modal.enter()
    def load(self):
        from rvc_python.infer import RVCInference

        voice_vol.reload()  # pick up any model uploaded via upload_rvc_model.py
        if not os.path.exists(MODEL_PATH):
            raise RuntimeError(
                f"No voice model found at {MODEL_PATH}. "
                "Run modal/upload_rvc_model.py first to upload a .pth file."
            )

        self.rvc = RVCInference(device="cuda:0")
        self.rvc.load_model(
            MODEL_PATH,
            INDEX_PATH if os.path.exists(INDEX_PATH) else "",
        )
        print(f"[based-rvc] Model loaded from {MODEL_PATH}")

    @modal.method()
    def convert(self, audio_bytes: bytes, pitch_shift: int = 0) -> bytes:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_bytes)
            in_path = f.name

        out_path = in_path + "_out.wav"
        try:
            self.rvc.infer_file(in_path, out_path, f0_up_key=pitch_shift, f0_method="rmvpe")
            with open(out_path, "rb") as f:
                return f.read()
        finally:
            for p in (in_path, out_path):
                if os.path.exists(p):
                    os.unlink(p)

    @modal.fastapi_endpoint(method="GET")
    def health(self):
        return {"ok": True}

    @modal.fastapi_endpoint(method="POST")
    def endpoint(self, body: dict) -> dict:
        audio_b64 = body.get("audio_base64", "")
        pitch = int(body.get("pitch_shift", 0))
        if not audio_b64:
            return {"error": "audio_base64 required"}
        audio_bytes = base64.b64decode(audio_b64)
        result = self.convert(audio_bytes, pitch)
        return {"audioBase64": base64.b64encode(result).decode(), "mimeType": "audio/wav"}
