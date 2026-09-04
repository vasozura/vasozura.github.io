import { describe, expect, it } from "vitest";
import { getLearningCopy } from "./copy";

describe("learning interface translations", () => {
  it("keeps the production learning controls bilingual", () => {
    expect(getLearningCopy("ka")).toMatchObject({ title: "სწავლის რეჟიმი", piano: "ფორტეპიანო", prepare: "სავარჯიშოს მომზადება" });
    expect(getLearningCopy("en")).toMatchObject({ title: "Learning mode", piano: "Piano", prepare: "Prepare exercise" });
  });
});
