import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { FULL_SCORE_PART_ID, attemptScorePartSwitch, chooseDefaultMusicXmlPart, filterMusicXmlToPart, parseMusicXmlParts, parseMusicXmlStaves, rememberScorePart, resolveStaffVisibility, restoreScorePart, staffVisibilityForPart, visibleStaffNumbers, type PartSelectionStorage } from "./musicxml-parts";

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Stable title</work-title></work>
  <identification><creator type="composer">ZURA</creator></identification>
  <defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name><part-abbreviation>Pno.</part-abbreviation></score-part>
    <score-part id="P2"><part-name>Lead Vocal</part-name><part-abbreviation>Vox</part-abbreviation></score-part>
    <score-part id="P3"><part-name>Guitar</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1" id="piano-m1"><attributes><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="96"/></direction><note id="piano-note"/></measure></part>
  <part id="P2"><measure number="1" id="vocal-m1"><attributes><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="96"/></direction><note id="vocal-note"/></measure></part>
  <part id="P3"><measure number="1" id="guitar-m1"><note id="guitar-note"/></measure></part>
</score-partwise>`;

class MemoryStorage implements PartSelectionStorage { values = new Map<string, string>(); getItem(key: string) { return this.values.get(key) ?? null; } setItem(key: string, value: string) { this.values.set(key, value); } }

describe("MusicXML score-part selection", () => {
  it("parses stable ids, names and optional abbreviations", () => {
    expect(parseMusicXmlParts(xml)).toEqual([
      { id: "P1", name: "Piano", abbreviation: "Pno." },
      { id: "P2", name: "Lead Vocal", abbreviation: "Vox" },
      { id: "P3", name: "Guitar", abbreviation: null },
    ]);
  });

  it("chooses Vocal, then Piano, then the first part", () => {
    const parts = parseMusicXmlParts(xml);
    expect(chooseDefaultMusicXmlPart(parts)).toBe("P2");
    expect(chooseDefaultMusicXmlPart(parts.filter((part) => part.id !== "P2"))).toBe("P1");
    expect(chooseDefaultMusicXmlPart([{ id: "B", name: "Bass", abbreviation: null }])).toBe("B");
  });

  it("classifies supported two-staff piano clefs without guessing", () => {
    expect(parseMusicXmlStaves(xml, "P1")).toEqual([
      { number: 1, clefSign: "G", clefLine: 2, label: "TREBLE" },
      { number: 2, clefSign: "F", clefLine: 4, label: "BASS" },
    ]);
    expect(parseMusicXmlStaves(xml, "P2")).toEqual([{ number: 1, clefSign: null, clefLine: null, label: "STAFF 1" }]);
  });

  it("uses generic labels for unusual multi-staff parts and no controls for Full Score", () => {
    const unusual = xml.replace("<part-name>Guitar</part-name>", "<part-name>Organ</part-name>").replace('<part id="P3"><measure number="1" id="guitar-m1">', '<part id="P3"><measure number="1" id="guitar-m1"><attributes><staves>3</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>C</sign><line>3</line></clef><clef number="3"><sign>F</sign><line>4</line></clef></attributes>');
    expect(parseMusicXmlStaves(unusual, "P3").map((staff) => staff.label)).toEqual(["STAFF 1", "STAFF 2", "STAFF 3"]);
    expect(parseMusicXmlStaves(xml, FULL_SCORE_PART_ID)).toEqual([]);
  });

  it("preserves valid staff state and falls back deterministically", () => {
    const staves = parseMusicXmlStaves(xml, "P1");
    expect(resolveStaffVisibility(staves, "staff:2")).toBe("staff:2");
    expect(resolveStaffVisibility(staves, "staff:9")).toBe("all");
    expect(visibleStaffNumbers(staves, "staff:2")).toEqual([2]);
    expect(visibleStaffNumbers(staves, "all")).toEqual([1, 2]);
    const selections = new Map([["P1", "staff:2" as const], ["P2", "staff:9" as const]]);
    expect(staffVisibilityForPart(selections, "P1", staves)).toBe("staff:2");
    expect(staffVisibilityForPart(selections, "P2", parseMusicXmlStaves(xml, "P2"))).toBe("all");
  });

  it("filters score-part and part elements consistently while preserving score metadata", () => {
    const filtered = filterMusicXmlToPart(xml, "P2");
    expect(parseMusicXmlParts(filtered)).toEqual([{ id: "P2", name: "Lead Vocal", abbreviation: "Vox" }]);
    expect(filtered).toContain('part id="P2"'); expect(filtered).not.toContain('part id="P1"'); expect(filtered).not.toContain('part id="P3"');
    for (const required of ["Stable title", "<identification>", "<defaults>", "vocal-m1", "<key>", "<time>", "tempo=\"96\"", "vocal-note"]) expect(filtered).toContain(required);
  });

  it("switching parts preserves playback time and play/pause state", async () => {
    const playback = { position: 42.75, playing: true }; const render = vi.fn(async () => {});
    const result = await attemptScorePartSwitch("P2", "P1", render);
    expect(result).toEqual({ selectedPartId: "P1", error: null }); expect(playback).toEqual({ position: 42.75, playing: true }); expect(render).toHaveBeenCalledWith("P1");
  });

  it("keeps the previous part selected when rendering fails", async () => {
    const result = await attemptScorePartSwitch("P2", "P3", async () => { throw new Error("OSMD rejected Guitar"); });
    expect(result).toEqual({ selectedPartId: "P2", error: "OSMD rejected Guitar" });
  });

  it("remembers a valid selection separately per song", () => {
    const storage = new MemoryStorage(); const parts = parseMusicXmlParts(xml);
    rememberScorePart(storage, "song-a", "P3"); rememberScorePart(storage, "song-b", FULL_SCORE_PART_ID);
    expect(restoreScorePart(storage, "song-a", parts)).toBe("P3"); expect(restoreScorePart(storage, "song-b", parts)).toBe(FULL_SCORE_PART_ID);
  });

  it("keeps mobile controls inside the score panel instead of widening the document", async () => {
    const css = await readFile(new URL("./score-parts.css", import.meta.url), "utf8");
    expect(css).toContain("max-width: 100%"); expect(css).toContain("overflow-x: auto"); expect(css).toContain("overflow-x: hidden");
  });
});
