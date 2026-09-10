#!/usr/bin/env python3
"""Where the singing actually happens.

Reads an isolated vocal stem (or, as a fallback, the canonical mix) and reports the sung phrases -
the stretches where a voice is present - and the note/syllable onsets inside them. Lyric timing is
built from these events, so a line can only start where the singer actually starts and the timeline
cannot drift away from the performance.

    python3 scripts/vocal-phrases.py --audio stems/vocals.wav --output prepared/vocal-phrases.json

Only timing is derived here. No transcription of any kind is attempted: the lyric text stays the
authoritative text it always was.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def analyse(audio: Path, top_db: float, min_phrase: float, max_gap: float) -> dict[str, object]:
    import librosa
    import numpy as np

    signal, rate = librosa.load(audio, sr=22050, mono=True)
    duration = float(len(signal) / rate)
    hop = 256

    # librosa.effects.split gives the loud stretches relative to the loudest point in the track,
    # which is exactly "where is there a voice" once the accompaniment has been separated out.
    intervals = librosa.effects.split(signal, top_db=top_db, frame_length=2048, hop_length=hop)
    phrases: list[dict[str, float]] = []
    for start, end in intervals:
        begin, finish = float(start / rate), float(end / rate)
        # A breath between two halves of one sung line is not a phrase boundary.
        if phrases and begin - phrases[-1]["end"] <= max_gap:
            phrases[-1]["end"] = finish
            continue
        phrases.append({"start": begin, "end": finish})
    phrases = [phrase for phrase in phrases if phrase["end"] - phrase["start"] >= min_phrase]

    # Onsets carry the syllable-level detail inside a phrase. backtrack moves each one to the
    # nearest preceding energy minimum, which lands closer to the consonant than the peak does.
    onset_frames = librosa.onset.onset_detect(y=signal, sr=rate, hop_length=hop, backtrack=True, units="frames")
    onset_times = librosa.frames_to_time(onset_frames, sr=rate, hop_length=hop).tolist()
    inside = [float(time) for time in onset_times if any(phrase["start"] - 0.05 <= time <= phrase["end"] for phrase in phrases)]

    rms = librosa.feature.rms(y=signal, frame_length=2048, hop_length=hop)[0]
    sung = sum(phrase["end"] - phrase["start"] for phrase in phrases)
    return {
        "version": 1,
        "durationSeconds": round(duration, 3),
        "sungSeconds": round(sung, 3),
        "topDb": top_db,
        "minPhraseSeconds": min_phrase,
        "maxGapSeconds": max_gap,
        "peakRms": round(float(np.max(rms)), 6),
        "phrases": [{"start": round(phrase["start"], 3), "end": round(phrase["end"], 3)} for phrase in phrases],
        "onsets": [round(time, 3) for time in inside],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--top-db", type=float, default=32.0, help="how far below the peak still counts as voice")
    parser.add_argument("--min-phrase", type=float, default=0.32, help="shorter stretches are breaths, not phrases")
    parser.add_argument("--max-gap", type=float, default=0.34, help="gaps this short are joined into one phrase")
    args = parser.parse_args()
    result = analyse(args.audio.resolve(), args.top_db, args.min_phrase, args.max_gap)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"phrases": len(result["phrases"]), "onsets": len(result["onsets"]), "sungSeconds": result["sungSeconds"], "durationSeconds": result["durationSeconds"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
