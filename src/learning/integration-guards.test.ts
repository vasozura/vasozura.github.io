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
    expect(css).toContain("max-width: 100%");
    expect(css).toContain("min-width: 0");
    expect(css).toContain("overflow-x: auto");
    expect(css).not.toContain("overflow-x: visible");
  });

  it("keeps the external API URL configurable without embedding server credentials", async () => {
    const config = await readFile(new URL("../config.ts", import.meta.url), "utf8");
    const deployWorkflow = await readFile(
      new URL("../../.github/workflows/deploy-pages.yml", import.meta.url),
      "utf8",
    );
    expect(config).toContain("VITE_LEARNING_API_URL");
    expect(config).not.toMatch(/service.?role|anthropic/i);
    expect(deployWorkflow).toContain("VITE_LEARNING_API_URL: ${{ vars.VITE_LEARNING_API_URL }}");
  });

  it("uses the generated client and omits browser credentials", async () => {
    const adapter = await readFile(new URL("./api-client.ts", import.meta.url), "utf8");
    const generatedClient = await readFile(
      new URL("../lib/zura-api/client.ts", import.meta.url),
      "utf8",
    );
    expect(adapter).toContain('from "../lib/zura-api"');
    expect(generatedClient).toContain('credentials: "omit"');
    expect(generatedClient).toContain("getAccessToken");
    expect(generatedClient).not.toMatch(/service.?role|postgres(?:ql)?:\/\//i);
  });
});
