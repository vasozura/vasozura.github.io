import { describe, expect, it } from "vitest";
import { displaySongLanguage } from "./song-language";

describe("catalog language display", () => {
  it("does not label obvious non-Georgian songs as KA", () => {
    expect(displaySongLanguage("ka", { ka: "leave a mark", en: null }, null)).toBe("EN");
    expect(displaySongLanguage("ka", { ka: "Всего два слова", en: null }, null)).toBe("RU");
    expect(displaySongLanguage("ka", { ka: "Te amé en silencio", en: null }, null)).toBe("ES");
  });
  it("keeps Georgian script Georgian and uses a neutral Latin code when evidence is insufficient", () => {
    expect(displaySongLanguage("en", { ka: "მიყვარხარ", en: null }, null)).toBe("KA");
    expect(displaySongLanguage("ka", { ka: "Mimino", en: null }, null)).toBe("LAT");
  });
});
