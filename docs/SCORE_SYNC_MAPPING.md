# Score-to-MIDI synchronization mapping

OpenSheetMusicDisplay and a MIDI file do not guarantee identical note identity, repeats, pickup timing, or tempo interpretation. The first implementation renders MusicXML, exposes the OSMD cursor foundation, plays MIDI, and highlights piano keys. It does not pretend that cursor-to-MIDI synchronization is reliable without mapping data.

Future precise synchronization can be stored in `instrument_parts.fingering_json` under a versioned envelope:

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
