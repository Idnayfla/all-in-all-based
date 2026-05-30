"""Run once to upload the Based voice reference clip to Modal Volume."""
import modal
from pathlib import Path

vol = modal.Volume.from_name("based-voice-clips", create_if_missing=True)

clip = Path(__file__).parent.parent / "voice-samples" / "based-voice-american-2__2gpuOKD5shp7mKh4qkta.mp3"

with vol.batch_upload(force=True) as batch:
    batch.put_file(str(clip), "/based-voice-american-2.mp3")

print("Uploaded reference clip to Modal Volume.")
