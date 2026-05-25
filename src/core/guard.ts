/**
 * Run a function, swallowing any throw and returning a fallback instead.
 * This is what lets clarguard wrap every OpenClaw hook so an internal bug
 * or a disk error degrades to a no-op (fail-open) or a block (fail-closed)
 * rather than crashing the host gateway turn.
 */
export function guarded<T>(body: () => T, onError: T, onCatch?: (err: unknown) => void): T {
  try {
    return body();
  } catch (err) {
    onCatch?.(err);
    return onError;
  }
}
