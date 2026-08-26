import type { LocalizedText } from "./types/song";

export type Language = "ka" | "en";

const storageKey = "zura-lang";

export function getInitialLanguage(): Language {
  try {
    return window.localStorage.getItem(storageKey) === "en" ? "en" : "ka";
  } catch {
    return "ka";
  }
}

export function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(storageKey, language);
  } catch {
    // The language switch still works when browser storage is unavailable.
  }
}

export function localize(value: LocalizedText | null, language: Language): string | null {
  if (!value) return null;
  return value[language] ?? value[language === "ka" ? "en" : "ka"];
}
