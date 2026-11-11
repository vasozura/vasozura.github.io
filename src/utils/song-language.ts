import type { LocalizedText } from "../types/song";

const patterns: Array<[string, RegExp]> = [
  ["KA", /[\u10A0-\u10FF]/u], ["RU", /[\u0400-\u04FF]/u], ["EL", /[\u0370-\u03FF]/u],
  ["AR", /[\u0600-\u06FF]/u], ["HI", /[\u0900-\u097F]/u],
];
const latinHints: Array<[string, RegExp]> = [
  ["EN", /\b(?:the|and|you|your|love|leave|life|heart|mine|with|without|just|two|words|silent|snow|dream)\b/i],
  ["ES", /\b(?:el|la|los|las|una|amor|vida|corazón|palabras|silencio|balas|duelo)\b/i],
  ["PT", /\b(?:você|amor|vida|coração|palavras|silêncio|amei|duas|homem)\b/i],
  ["FR", /\b(?:le|la|les|une|amour|mots|silence|neige|deux|aimais)\b/i],
  ["IT", /\b(?:il|gli|una|amore|vita|parole|silenzio|candele|amavo)\b/i],
  ["DE", /\b(?:der|die|das|und|liebe|kerzen|schnee|zwei|worte)\b/i],
  ["TR", /\b(?:bir|ve|seni|sevdim|sessizce|aşk)\b/i],
  ["SW", /\b(?:na|ya|moyo|nilipenda|kimya)\b/i],
];

export function displaySongLanguage(stored: string | null, title: LocalizedText, lyrics: LocalizedText | null): string | null {
  const text = [title.ka, title.en, lyrics?.ka, lyrics?.en].filter(Boolean).join(" \n ");
  for (const [code, pattern] of patterns) if (pattern.test(text)) return code;
  if (/[A-Za-zÀ-ž]/u.test(text)) {
    for (const [code, pattern] of latinHints) if (pattern.test(text)) return code;
    if (stored && stored.toLowerCase() !== "ka") return stored.toUpperCase();
    return "LAT";
  }
  return stored ? stored.toUpperCase() : null;
}
