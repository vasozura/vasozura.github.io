import { describe, expect, it } from "vitest";
import { cleanupLiteralNewlines, safeStorageFilename, validateFile } from "./file-validation";

describe("file validation", () => {
  it("accepts supported content within its limit", () => expect(validateFile({ name: "song.mp3", type: "audio/mpeg", size: 1024 }, "audio")).toEqual([]));
  it("rejects mismatched extensions, MIME types and oversize files", () => expect(validateFile({ name: "song.wav", type: "audio/wav", size: 101 * 1024 * 1024 }, "audio")).toHaveLength(3));
  it("normalizes storage names", () => expect(safeStorageFilename("ჩემი Song (Final).MP3")).toBe("song-final-.mp3"));
});

describe("lyrics cleanup", () => {
  it("converts literal newline escapes", () => expect(cleanupLiteralNewlines("line one\\nline two\\r\\nline three")).toBe("line one\nline two\nline three"));
});
