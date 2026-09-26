export const FULL_SCORE_PART_ID = "__full_score__";
const STORAGE_PREFIX = "zura:score-part:";

export interface MusicXmlPart { id: string; name: string; abbreviation: string | null; }
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
