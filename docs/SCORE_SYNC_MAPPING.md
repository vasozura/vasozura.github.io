# Score-to-MIDI synchronization mapping

OpenSheetMusicDisplay and a MIDI file do not guarantee identical note identity, repeats, pickup timing, or tempo interpretation. Learning playback therefore uses exactly one monotonic `CanonicalScheduler`. Its expanded, tempo-resolved manifest timeline drives synthesized MIDI-note audio, the OSMD cursor, instrument visualizers, metronome and A–B loop. Pause, resume, seek and 50–150% tempo changes update the same clock anchor; no second playback timer is started.

The optional performance MIDI is loaded only after Learning is opened and is used for an alignment check, not as a competing clock. Duration differences up to 100 ms or 0.5% are `high` confidence; differences up to 750 ms or 2.5% are `medium` and normalized to the canonical timeline; larger or unreadable differences are `unreliable` and produce a visible warning. Canonical timing always wins.

Precise source-authored synchronization can be stored in `instrument_parts.fingering_json` under this versioned envelope:

```json
{
  "schema": "zura-score-midi-map/v1",
  "score_sha256": "64-character checksum",
  "midi_sha256": "64-character checksum",
  "events": [
    {
      "midi_time_seconds": 1.25,
      "measure": 2,
      "staff": 1,
      "voice": 1,
      "note_index": 0,
      "midi_note": 60,
      "fingering": { "piano": "1" }
    }
  ]
}
```

Mappings must reference immutable score/MIDI checksums. Guitar and accordion fingerings must be entered by a qualified editor or imported from an authoritative score source; they must not be inferred from MP3 alone.
