import { describe, expect, it } from "vitest";

import { AnomalyDetector, type AnomalyConfig } from "../src/core/anomaly.js";

function cfg(over: Partial<AnomalyConfig> = {}): AnomalyConfig {
  return { enabled: true, ratio: 5, minSamples: 10, windowSize: 200, ...over };
}

describe("AnomalyDetector", () => {
  it("does not flag during the cold-start period", () => {
    const d = new AnomalyDetector(cfg({ minSamples: 10 }));
    for (let i = 0; i < 9; i++) {
      expect(d.observe("anthropic", "haiku", 0.01).isAnomaly).toBe(false);
    }
    // 10th call with a huge cost is still not flagged — bucket only has 9 samples.
    expect(d.observe("anthropic", "haiku", 100).isAnomaly).toBe(false);
  });

  it("flags a spike against the per-model baseline", () => {
    const d = new AnomalyDetector(cfg({ ratio: 5, minSamples: 10 }));
    for (let i = 0; i < 10; i++) {
      d.observe("anthropic", "haiku", 0.01);
    }
    // 6× the median: anomaly.
    const det = d.observe("anthropic", "haiku", 0.06);
    expect(det.isAnomaly).toBe(true);
    expect(det.median).toBeCloseTo(0.01, 6);
    expect(det.observedRatio).toBeCloseTo(6, 6);
  });

  it("does not flag a call merely at or just over the ratio", () => {
    const d = new AnomalyDetector(cfg({ ratio: 5, minSamples: 10 }));
    for (let i = 0; i < 10; i++) {
      d.observe("anthropic", "haiku", 0.01);
    }
    expect(d.observe("anthropic", "haiku", 0.05).isAnomaly).toBe(false);
  });

  it("keeps opus and haiku baselines independent (no cross-contamination)", () => {
    const d = new AnomalyDetector(cfg({ minSamples: 10 }));
    for (let i = 0; i < 10; i++) {
      d.observe("anthropic", "haiku", 0.01);
    }
    // The first opus call doesn't have its own baseline yet — must not be
    // judged against haiku's. Cold-start applies per bucket.
    expect(d.observe("anthropic", "claude-opus", 5).isAnomaly).toBe(false);
  });

  it("returns no detection when disabled (but still tracks the baseline)", () => {
    const d = new AnomalyDetector(cfg({ enabled: false }));
    for (let i = 0; i < 10; i++) {
      d.observe("anthropic", "haiku", 0.01);
    }
    const det = d.observe("anthropic", "haiku", 1);
    expect(det.isAnomaly).toBe(false);
    // The median is still computed (so flipping enabled on later "just works").
    expect(det.median).toBeCloseTo(0.01, 6);
  });

  it("ignores zero-cost calls (free models / missing usage) on both sides", () => {
    const d = new AnomalyDetector(cfg({ minSamples: 3 }));
    // Three zero-cost calls do NOT populate the bucket.
    d.observe("anthropic", "haiku", 0);
    d.observe("anthropic", "haiku", 0);
    d.observe("anthropic", "haiku", 0);
    expect(d.observe("anthropic", "haiku", 1).isAnomaly).toBe(false);
  });

  it("compares against history before recording, so a single spike isn't its own normal", () => {
    const d = new AnomalyDetector(cfg({ ratio: 5, minSamples: 5 }));
    for (let i = 0; i < 5; i++) {
      d.observe("anthropic", "haiku", 0.01);
    }
    // Big spike — flagged.
    expect(d.observe("anthropic", "haiku", 1).isAnomaly).toBe(true);
    // Next normal call: baseline still small (the 1 only just landed), still flagged-or-not based on prior median.
    // Bucket median after 5 × 0.01 + 1 × 1 is still ~0.01 (six samples; middle of sorted = 0.01).
    expect(d.observe("anthropic", "haiku", 0.01).isAnomaly).toBe(false);
  });
});
