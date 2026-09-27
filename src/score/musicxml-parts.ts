export const FULL_SCORE_PART_ID = "__full_score__";
const STORAGE_PREFIX = "zura:score-part:";

export interface MusicXmlPart { id: string; name: string; abbreviation: string | null; }
export type StaffVisibility = "all" | `staff:${number}`;
export interface MusicXmlStaff { number: number; clefSign: string | null; clefLine: number | null; label: string; }
export interface PartSelectionStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; }

const decodeXml = (value: string): string => value
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const textOf = (xml: string, tag: string): string | null => {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "iu"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim()) : null;
};

export function parseMusicXmlParts(xml: string): MusicXmlPart[] {
  const partList = xml.match(/<part-list(?:\s[^>]*)?>([\s\S]*?)<\/part-list>/iu)?.[1];
  if (!partList) return [];
  const parts: MusicXmlPart[] = [];
  for (const match of partList.matchAll(/<score-part\s+[^>]*\bid\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/score-part>/giu)) {
    const id = decodeXml(match[2].trim()); const name = textOf(match[3], "part-name")?.trim();
    if (id && name && !parts.some((part) => part.id === id)) parts.push({ id, name, abbreviation: textOf(match[3], "part-abbreviation")?.trim() || null });
  }
  return parts;
}

export function parseMusicXmlStaves(xml: string, partId: string): MusicXmlStaff[] {
  if (partId === FULL_SCORE_PART_ID) return [];
  const escaped = partId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const part = xml.match(new RegExp(`<part(?=[\\s>])[^>]*\\bid\\s*=\\s*(["'])${escaped}\\1[^>]*>([\\s\\S]*?)</part>`, "iu"))?.[2];
  if (!part) return [];
  const declared = Math.max(1, ...[...part.matchAll(/<staves(?:\s[^>]*)?>(\d+)<\/staves>/giu)].map((match) => Number(match[1]) || 1));
  const clefs = new Map<number, { sign: string | null; line: number | null }>();
  for (const match of part.matchAll(/<clef(?:\s[^>]*)?>([\s\S]*?)<\/clef>/giu)) {
    const opening = match[0].match(/^<clef(?:\s[^>]*)?>/iu)?.[0] ?? "";
    const number = Number(opening.match(/\bnumber\s*=\s*(["'])(\d+)\1/iu)?.[2] ?? 1);
    clefs.set(number, { sign: textOf(match[1], "sign")?.toUpperCase() ?? null, line: Number(textOf(match[1], "line")) || null });
  }
  const count = Math.max(declared, ...clefs.keys());
  const partName = parseMusicXmlParts(xml).find((entry) => entry.id === partId)?.name ?? "";
  const piano = /\b(piano|pno|keyboard)\b/iu.test(partName);
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const clef = clefs.get(number) ?? { sign: null, line: null };
    const label = piano && clef.sign === "G" && clef.line === 2 ? "TREBLE" : piano && clef.sign === "F" && clef.line === 4 ? "BASS" : `STAFF ${number}`;
    return { number, clefSign: clef.sign, clefLine: clef.line, label };
  });
}

export function resolveStaffVisibility(staves: readonly MusicXmlStaff[], remembered?: StaffVisibility | null): StaffVisibility {
  if (remembered === "all") return "all";
  if (remembered && staves.some((staff) => remembered === `staff:${staff.number}`)) return remembered;
  return "all";
}

export function staffVisibilityForPart(selections: ReadonlyMap<string, StaffVisibility>, partId: string, staves: readonly MusicXmlStaff[]): StaffVisibility {
  return resolveStaffVisibility(staves, selections.get(partId));
}

export function visibleStaffNumbers(staves: readonly MusicXmlStaff[], selection: StaffVisibility): number[] {
  if (selection === "all") return staves.map((staff) => staff.number);
  const number = Number(selection.slice("staff:".length));
  return staves.some((staff) => staff.number === number) ? [number] : staves.map((staff) => staff.number);
}

export function chooseDefaultMusicXmlPart(parts: readonly MusicXmlPart[], rememberedId?: string | null): string | null {
  if (rememberedId === FULL_SCORE_PART_ID || parts.some((part) => part.id === rememberedId)) return rememberedId ?? null;
  const vocal = parts.find((part) => /\b(vocal|voice|vocals|singer|soprano|alto|tenor|baritone|choir)\b/iu.test(`${part.name} ${part.abbreviation ?? ""}`));
  if (vocal) return vocal.id;
  const piano = parts.find((part) => /\b(piano|pno|keyboard)\b/iu.test(`${part.name} ${part.abbreviation ?? ""}`));
  return piano?.id ?? parts[0]?.id ?? null;
}

export function filterMusicXmlToPart(xml: string, partId: string): string {
  const parts = parseMusicXmlParts(xml);
  if (!parts.some((part) => part.id === partId)) throw new Error(`MusicXML part ${partId} is unavailable.`);
  const escaped = partId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const scorePartPattern = new RegExp(`<score-part\\s+[^>]*\\bid\\s*=\\s*(["'])${escaped}\\1[^>]*>[\\s\\S]*?</score-part>`, "iu");
  const selectedDefinition = xml.match(scorePartPattern)?.[0];
  const selectedPart = [...xml.matchAll(/<part(?=[\s>])[^>]*\bid\s*=\s*(["'])(.*?)\1[^>]*>[\s\S]*?<\/part>/giu)].find((match) => decodeXml(match[2]) === partId)?.[0];
  if (!selectedDefinition || !selectedPart) throw new Error(`MusicXML part ${partId} has no matching definition and notation.`);
  const withPartList = xml.replace(/<part-list(?:\s[^>]*)?>[\s\S]*?<\/part-list>/iu, `<part-list>${selectedDefinition}</part-list>`);
  return withPartList.replace(/<part(?=[\s>])[^>]*\bid\s*=\s*(["'])(.*?)\1[^>]*>[\s\S]*?<\/part>/giu, (part) => part === selectedPart ? part : "");
}

export function scorePartStorageKey(songId: string): string { return `${STORAGE_PREFIX}${encodeURIComponent(songId)}`; }
export function rememberScorePart(storage: PartSelectionStorage, songId: string, partId: string): void { storage.setItem(scorePartStorageKey(songId), partId); }
export function restoreScorePart(storage: PartSelectionStorage, songId: string, parts: readonly MusicXmlPart[]): string | null { return chooseDefaultMusicXmlPart(parts, storage.getItem(scorePartStorageKey(songId))); }

export async function attemptScorePartSwitch(currentPartId: string, nextPartId: string, render: (partId: string) => Promise<void>): Promise<{ selectedPartId: string; error: string | null }> {
  try { await render(nextPartId); return { selectedPartId: nextPartId, error: null }; }
  catch (error) { return { selectedPartId: currentPartId, error: error instanceof Error ? error.message : "The selected score part could not be rendered." }; }
}
