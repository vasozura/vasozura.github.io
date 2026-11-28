"""Fill the existing DINOv2 cache without waiting for link calibration."""

from pathlib import Path
import sqlite3
import sys

from link_clips import extract


if __name__ == "__main__":
    with sqlite3.connect(Path(sys.argv[1]).resolve(strict=True)) as db:
        extract(db, Path(__file__).parent / "models", "cuda")
        print(f"Current embeddings: {db.execute('SELECT count(*) FROM embeddings').fetchone()[0]}")
