# Accordion mapping format

Accordion learning is enabled only by an explicit
`zura-accordion-mapping/v1` document stored at
`instrument-parts/accordion/accordion-mapping.json`.

```json
{
  "schema_version": "zura-accordion-mapping/v1",
  "layout_id": "synthetic-stradella-120",
  "system": "stradella",
  "orientation": "vertical",
  "row_direction": "top_to_bottom",
  "row_count": 6,
  "verified": true,
  "buttons": [
    {
      "id": "C-major",
      "side": "left",
      "row": 3,
      "column": 7,
      "midi": [48, 52, 55],
      "label": "C major",
      "kind": "major",
      "provenance": "source",
      "confidence": 1
    }
  ]
}
```

Supported systems are `piano_accordion`, `chromatic_button`, `stradella`,
`free_bass` and `custom`. Each physical control has stable row/column geometry
and one or more MIDI notes. Optional `finger` or `bellows` values are accepted
only when source-authored. `inferred` mappings are advisory and may not assert
either value. Missing pitches remain visibly unavailable; the application does
not invent bass buttons, fingerings or bellows direction.

The frontend renders separate right- and left-hand boards and uses the Phase 4
clock for play, pause, seek, tempo and loop synchronization. A song without a
verified mapping receives only the unavailable state and cannot advertise
accordion readiness.
