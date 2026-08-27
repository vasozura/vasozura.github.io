import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "./safe-url";

describe("safe URL handling", () => {
  it("allows HTTPS and root-relative resources", () => {
    expect(safeHttpUrl("https://example.com/song.mp3")).toBe("https://example.com/song.mp3");
    expect(safeHttpUrl("/assets/cover.webp")).toBe("/assets/cover.webp");
  });

  it("rejects executable and insecure remote schemes", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("http://example.com/song.mp3")).toBeNull();
  });
});
