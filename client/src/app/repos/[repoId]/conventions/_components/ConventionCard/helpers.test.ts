import { describe, it, expect } from "vitest";
import { confidenceColor, confidencePct } from "./helpers";

describe("confidence bar", () => {
  it("colours by the same rounded percent the card shows", () => {
    // 0.846 is shown as "85%", so it must be green, like ConfidenceNum's 85.
    expect(confidencePct(0.846)).toBe(85);
    expect(confidenceColor(0.846)).toBe("var(--ok)");
    expect(confidencePct(0.646)).toBe(65);
    expect(confidenceColor(0.646)).toBe("var(--warn)");
  });

  it("falls to the next band just below each cut-off", () => {
    expect(confidenceColor(0.844)).toBe("var(--warn)");
    expect(confidenceColor(0.644)).toBe("var(--text-muted)");
  });

  it("clamps out-of-range values", () => {
    expect(confidencePct(1.4)).toBe(100);
    expect(confidencePct(-0.2)).toBe(0);
  });
});
