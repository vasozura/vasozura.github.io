import { describe, expect, it } from "vitest";
import demoSongs from "../../public/data/demo-songs.json";
import { validateSongCollection } from "./song-validation";

describe("demo song data", () => {
  it("contains the three verified releases and passes model validation", () => {
    expect(demoSongs).toHaveLength(3);
    expect(validateSongCollection(demoSongs)).toEqual([]);
  });

  it("preserves every verified YouTube link", () => {
    expect(demoSongs.map((song) => song.youtubeUrl)).toEqual([
      "https://youtu.be/CyVj82pN18o",
      "https://youtu.be/cGEGZxQW34g",
      "https://youtu.be/ZAFk4sxfsic",
    ]);
  });

  it("rejects duplicate slugs", () => {
    const invalid = [demoSongs[0], { ...demoSongs[1], slug: demoSongs[0].slug }];
    expect(validateSongCollection(invalid)).toContainEqual({
      path: "songs[1].slug",
      message: "Song slugs must be unique.",
    });
  });
});
