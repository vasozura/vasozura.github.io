import { describe, expect, it } from "vitest";
import { canUseProtectedLearningApi, errorMessage, formatClock } from "./learning-mode";

describe("public learning guards", () => {
  it("does not call protected production endpoints without a session", () => {
    expect(canUseProtectedLearningApi(false, false)).toBe(false);
    expect(canUseProtectedLearningApi(false, true)).toBe(true);
    expect(canUseProtectedLearningApi(true, false)).toBe(true);
  });

  it("formats the persistent transport position", () => {
    expect(formatClock(134)).toBe("02:14");
    expect(formatClock(253)).toBe("04:13");
  });

  it("never renders raw bearer or JWT diagnostics", () => {
    const message = errorMessage(new Error("A bearer access token is required"));
    expect(message).toBe("Authentication is required for this action.");
    expect(message).not.toMatch(/bearer|token|jwt/i);
  });
});
