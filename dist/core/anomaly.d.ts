/**
 * Cost anomaly detector.
 *
 * Flags an `llm_output` whose cost is more than `ratio` × the median cost
 * for that (provider, model) over the last `windowSize` calls. The
 * per-model bucketing is what makes this useful: without it, the first
 * opus call after a stream of haiku calls would always look anomalous.
 *
 * Design choices (researched alternatives in `docs/`-style comments here
 * so the next maintainer can change their mind cheaply):
 *
 * - Plain `cost > ratio × median` (not MAD or z-score). Less statistically
 *   robust, but the audit line "$X is N× the median for <model>" is what
 *   users actually want to read. MAD slots into `observe()` later without
 *   any external API change.
 * - Per (provider, model) ring buffer. O(windowSize) memory per model.
 * - Compare against history *before* recording the new sample, so a
 *   single anomaly doesn't immediately become its own normal.
 * - Skip cost == 0 (free model, missing usage) — neither flag nor poison
 *   the baseline.
 * - Cold-start skip until `minSamples` populated — a single call vs an
 *   empty bucket is meaningless.
 */
export interface AnomalyConfig {
    readonly enabled: boolean;
    /** A call is anomalous when its cost > `ratio` × the bucket median. */
    readonly ratio: number;
    /** Don't flag until the bucket has at least this many samples. */
    readonly minSamples: number;
    /** Per-bucket ring-buffer size. Drifts gracefully when workload changes. */
    readonly windowSize: number;
}
export interface AnomalyDetection {
    readonly isAnomaly: boolean;
    /** Median cost in the bucket (0 if not enough samples yet). */
    readonly median: number;
    /** Observed cost divided by median (0 if median is 0). */
    readonly observedRatio: number;
}
export declare class AnomalyDetector {
    private readonly config;
    private readonly buckets;
    constructor(config: AnomalyConfig);
    /**
     * Observe a call's cost. Returns whether it looks anomalous *against the
     * bucket's prior history* and records the sample for future comparisons.
     */
    observe(provider: string, model: string | undefined, cost: number): AnomalyDetection;
    private bucketFor;
}
//# sourceMappingURL=anomaly.d.ts.map