"""
Upload an RVC voice model (.pth) and optional FAISS index (.index) to Modal Volume.

Usage:
    modal run modal/upload_rvc_model.py --pth path/to/voice.pth
    modal run modal/upload_rvc_model.py --pth path/to/voice.pth --index path/to/voice.index

The files are stored as /rvc-models/voice.pth and /rvc-models/voice.index on the
"based-rvc-models" Modal Volume, which the RVC endpoint loads at startup.
"""
import sys
from pathlib import Path
import modal

vol = modal.Volume.from_name("based-rvc-models", create_if_missing=True)


@modal.local_entrypoint()
def main(pth: str, index: str = ""):
    pth_path = Path(pth)
    if not pth_path.exists():
        print(f"Error: {pth} not found", file=sys.stderr)
        sys.exit(1)

    with vol.batch_upload(force=True) as batch:
        batch.put_file(str(pth_path), "/voice.pth")
        print(f"Uploading {pth_path.name} -> /rvc-models/voice.pth")
        if index:
            idx_path = Path(index)
            if idx_path.exists():
                batch.put_file(str(idx_path), "/voice.index")
                print(f"Uploading {idx_path.name} -> /rvc-models/voice.index")
            else:
                print(f"Warning: index file {index} not found, skipping.")

    print("Done. Restart the RVC endpoint to pick up the new model:")
    print("  modal deploy modal/rvc_app.py")
