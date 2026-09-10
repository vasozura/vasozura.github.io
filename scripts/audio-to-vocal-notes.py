#!/usr/bin/env python3
"""Offline MP3 preparation: Demucs stems, librosa pYIN notes and chord candidates.

Stem separation is optional. With Demucs installed the vocal stem is tracked and a real
instrumental is produced; without it (--stems=skip, or --stems=auto on a machine that has no
Demucs) pitch tracking runs on the canonical mix instead. The mix path is fully supported but
always review-grade, because accompaniment leaks into the pitch track - the manifest records
which path was taken so a reviewer can see it."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path


def run(command: list[str]) -> None:
    result = subprocess.run(command, check=False)
    if result.returncode:
        raise RuntimeError(f"External preparation command failed with exit code {result.returncode}")


def stem_paths(output: Path, audio: Path) -> dict[str, Path]:
    folder = output / "stems" / "htdemucs" / audio.stem
    return {name: folder / f"{name}.wav" for name in ("vocals", "bass", "drums", "other")}


def demucs_available(python: str) -> bool:
    probe = subprocess.run([python, "-c", "import demucs"], check=False, capture_output=True)
    return probe.returncode == 0


def ensure_stems(audio: Path, output: Path, python: str, mode: str) -> dict[str, Path] | None:
    """Four stems, or None when the caller allows running on the canonical mix instead."""
    paths = stem_paths(output, audio)
    if all(path.exists() for path in paths.values()):
        return paths
    if mode == "skip":
        return None
    if mode == "auto" and not demucs_available(python):
        print("Demucs is not installed: pitch tracking will run on the canonical mix.", file=sys.stderr)
        return None
    run([python, "-m", "demucs", "-n", "htdemucs", "--device", "cpu", "--out", str(output / "stems"), str(audio)])
    if not all(path.exists() for path in paths.values()):
        raise RuntimeError("Demucs did not produce the expected four stems")
    return paths


def make_audio_outputs(stems: dict[str, Path], output: Path, ffmpeg: str) -> None:
    run([ffmpeg, "-y", "-loglevel", "error", "-i", str(stems["vocals"]), "-codec:a", "libmp3lame", "-q:a", "3", str(output / "vocal.mp3")])
    run([
        ffmpeg, "-y", "-loglevel", "error",
        "-i", str(stems["bass"]), "-i", str(stems["drums"]), "-i", str(stems["other"]),
        "-filter_complex", "[0:a][1:a][2:a]amix=inputs=3:normalize=0[a]", "-map", "[a]",
        "-codec:a", "libmp3lame", "-q:a", "2", str(output / "instrumental.mp3"),
    ])


def extract_notes(vocal: Path) -> list[dict[str, object]]:
    import librosa
    import numpy as np

    signal, sample_rate = librosa.load(vocal, sr=22050, mono=True)
    hop = 256
    frequencies, voiced, probabilities = librosa.pyin(
        signal,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C7"),
        sr=sample_rate,
        frame_length=2048,
        hop_length=hop,
        fill_na=np.nan,
    )
    rms = librosa.feature.rms(y=signal, frame_length=2048, hop_length=hop)[0]
    maximum_rms = float(np.max(rms)) or 1.0
    frame_seconds = hop / sample_rate
    notes: list[dict[str, object]] = []
    start = None
    pitches: list[float] = []
    confidences: list[float] = []
    velocities: list[float] = []

    def flush(end_frame: int) -> None:
        nonlocal start, pitches, confidences, velocities
        if start is None or not pitches:
            start = None
            pitches, confidences, velocities = [], [], []
            return
        midi = int(round(float(np.median(pitches))))
        start_seconds = start * frame_seconds
        duration = max(frame_seconds, (end_frame - start) * frame_seconds)
        notes.append({
            "id": f"raw-{len(notes)}",
            "midi": midi,
            "startSeconds": round(start_seconds, 6),
            "durationSeconds": round(duration, 6),
            "velocity": round(max(0.08, min(1.0, float(np.median(velocities)) / maximum_rms)), 4),
            "confidence": round(float(np.median(confidences)), 4),
            "pitchConfidence": round(float(np.median(confidences)), 4),
            "sourceTimestampSeconds": round(start_seconds, 6),
        })
        start = None
        pitches, confidences, velocities = [], [], []

    previous_pitch = None
    for index, frequency in enumerate(frequencies):
        probability = float(probabilities[index]) if probabilities is not None and not math.isnan(float(probabilities[index])) else 0.0
        if not voiced[index] or math.isnan(float(frequency)) or probability < 0.15:
            flush(index)
            previous_pitch = None
            continue
        midi = float(librosa.hz_to_midi(frequency))
        rounded = int(round(midi))
        if start is not None and previous_pitch is not None and abs(rounded - previous_pitch) > 0:
            flush(index)
        if start is None:
            start = index
        pitches.append(midi)
        confidences.append(probability)
        velocities.append(float(rms[min(index, len(rms) - 1)]))
        previous_pitch = rounded
    flush(len(frequencies))
    return notes


def analyze_chords(instrumental: Path) -> list[dict[str, object]]:
    import librosa
    import numpy as np

    signal, sample_rate = librosa.load(instrumental, sr=22050, mono=True)
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=signal, sr=sample_rate, hop_length=hop)
    seconds_per_frame = hop / sample_rate
    window_seconds = 2.0
    window_frames = max(1, int(window_seconds / seconds_per_frame))
    names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
    major = np.array([1, 0, 0, 0, .82, 0, 0, .68, 0, 0, 0, 0])
    minor = np.array([1, 0, 0, .82, 0, 0, 0, .68, 0, 0, 0, 0])
    result: list[dict[str, object]] = []
    for start in range(0, chroma.shape[1], window_frames):
        vector = np.mean(chroma[:, start:start + window_frames], axis=1)
        candidates = []
        for root in range(12):
            candidates.append((float(np.dot(vector, np.roll(major, root))), root, ""))
            candidates.append((float(np.dot(vector, np.roll(minor, root))), root, "m"))
        score, root, suffix = max(candidates)
        at = start * seconds_per_frame
        label = f"{names[root]}{suffix}"
        if result and result[-1]["symbol"] == label:
            result[-1]["endSeconds"] = round(min(len(signal) / sample_rate, at + window_seconds), 4)
            continue
        result.append({"id": f"analysis-{len(result)}", "symbol": label, "startSeconds": round(at, 4), "endSeconds": round(min(len(signal) / sample_rate, at + window_seconds), 4), "source": "analysis", "confidence": round(score / max(0.001, float(np.sum(vector))), 4)})
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg") or "ffmpeg")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--stems", default="auto", choices=("auto", "require", "skip"), help="auto uses Demucs when it is installed, require fails without it, skip always uses the canonical mix")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    audio = args.audio.resolve()
    stems = ensure_stems(audio, args.output.resolve(), args.python, args.stems)
    if stems is not None:
        make_audio_outputs(stems, args.output, args.ffmpeg)
        pitch_source, chord_source = stems["vocals"], stems["other"]
        analysis = "demucs htdemucs stems + librosa pYIN"
    else:
        # No separated vocal: the canonical mix carries the melody and the harmony alike.
        pitch_source, chord_source = audio, audio
        analysis = "librosa pYIN on the canonical mix (no stem separation)"
    notes = extract_notes(pitch_source)
    chords = analyze_chords(chord_source)
    checksum = hashlib.sha256(args.audio.read_bytes()).hexdigest()
    summary = {"version": 1, "sourceAudioSha256": checksum, "stemSeparation": stems is not None, "analysis": analysis}
    (args.output / "raw-vocal-notes.json").write_text(json.dumps({**summary, "notes": notes}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.output / "raw-chords.json").write_text(json.dumps({**summary, "chords": chords}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"notes": len(notes), "chords": len(chords), "stemSeparation": stems is not None, "analysis": analysis, "sourceAudioSha256": checksum}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
