import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("learning integration guards", () => {
  it("lazy-loads the heavy score path and cleans it before every route render", async () => {
    const source = await readFile(new URL("../main.ts", import.meta.url), "utf8");
    expect(source).toContain('import("./learning/learning-mode")');
    expect(source).toContain("learningCleanup?.()");
    expect(source).not.toContain('from "./learning/learning-mode"');
  });

  it("keeps the 88-key view horizontally contained on narrow screens", async () => {
    const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
    expect(css).toContain('[data-l="visualizer"]');
    expect(css).toContain("overflow-x: auto");
    expect(css).not.toContain("overflow-x: visible");
  });

  it("keeps the external API URL configurable without embedding server credentials", async () => {
    const config = await readFile(new URL("../config.ts", import.meta.url), "utf8");
    expect(config).toContain("VITE_LEARNING_API_URL");
    expect(config).not.toMatch(/service.?role|anthropic/i);
  });
});
