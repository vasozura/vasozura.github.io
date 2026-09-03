import { describe, expect, it } from "vitest";
import { parseRoute } from "./router";

describe("hash routing", () => {
  it("parses song, admin and home anchors", () => {
    expect(parseRoute("#/song/two-words")).toEqual({ name: "song", slug: "two-words" });
    expect(parseRoute("#/admin/songs/taflis-tvali/preview")).toEqual({ name: "admin-preview", slug: "taflis-tvali" });
    expect(parseRoute("#/admin")).toEqual({ name: "admin" });
    expect(parseRoute("#music")).toEqual({ name: "home", anchor: "music" });
  });
});
