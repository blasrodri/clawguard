import { describe, expect, it, vi } from "vitest";
import { guarded } from "../src/core/guard.js";

describe("guarded", () => {
  it("returns the body result on success", () => {
    expect(guarded(() => 42, -1)).toBe(42);
  });

  it("returns the fallback and reports when the body throws (fail-open)", () => {
    const onCatch = vi.fn();
    const out = guarded<{ block: boolean } | undefined>(
      () => {
        throw new Error("boom");
      },
      undefined,
      onCatch,
    );
    expect(out).toBeUndefined();
    expect(onCatch).toHaveBeenCalledOnce();
  });

  it("can fail closed by returning a blocking fallback", () => {
    const out = guarded(
      () => {
        throw new Error("boom");
      },
      { block: true },
    );
    expect(out).toEqual({ block: true });
  });
});
