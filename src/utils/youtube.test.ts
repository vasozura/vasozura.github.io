import { describe, expect, it } from "vitest";
import { extractYouTubeVideoId, youtubePrivacyEmbedUrl } from "./youtube";

describe("extractYouTubeVideoId", () => {
  it.each([
    ["https://youtu.be/CyVj82pN18o", "CyVj82pN18o"],
    ["https://www.youtube.com/watch?v=cGEGZxQW34g", "cGEGZxQW34g"],
    ["https://youtube.com/shorts/ZAFk4sxfsic", "ZAFk4sxfsic"],
    ["https://www.youtube.com/embed/CyVj82pN18o", "CyVj82pN18o"],
  ])("extracts from %s", (url, expected) => expect(extractYouTubeVideoId(url)).toBe(expected));

  it("rejects unrelated and malformed URLs", () => {
    expect(extractYouTubeVideoId("https://example.com/watch?v=CyVj82pN18o")).toBeNull();
    expect(extractYouTubeVideoId("not-a-url")).toBeNull();
  });

  it("uses the privacy-enhanced embed host", () => expect(youtubePrivacyEmbedUrl("CyVj82pN18o")).toBe("https://www.youtube-nocookie.com/embed/CyVj82pN18o?rel=0"));
});
