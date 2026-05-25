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
const NO_DETECTION = { isAnomaly: false, median: 0, observedRatio: 0 };
export class AnomalyDetector {
    config;
    buckets = new Map();
    constructor(config) {
        this.config = config;
    }
    /**
     * Observe a call's cost. Returns whether it looks anomalous *against the
     * bucket's prior history* and records the sample for future comparisons.
     */
    observe(provider, model, cost) {
        if (cost <= 0 || !Number.isFinite(cost)) {
            // A zero / NaN cost is uninformative; skip without polluting the bucket.
            return NO_DETECTION;
        }
        const bucket = this.bucketFor(provider, model);
        let detection = NO_DETECTION;
        if (bucket.filled >= this.config.minSamples) {
            const median = bucketMedian(bucket);
            const observedRatio = median > 0 ? cost / median : 0;
            detection = {
                isAnomaly: this.config.enabled && observedRatio > this.config.ratio,
                median,
                observedRatio,
            };
        }
        // Always record the sample (after comparing) so the baseline drifts.
        bucket.slots[bucket.next] = cost;
        bucket.next = (bucket.next + 1) % this.config.windowSize;
        if (bucket.filled < this.config.windowSize) {
            bucket.filled++;
        }
        return detection;
    }
    bucketFor(provider, model) {
        const key = `${provider}|${model ?? "?"}`;
        let b = this.buckets.get(key);
        if (!b) {
            b = { slots: new Array(this.config.windowSize), next: 0, filled: 0 };
            this.buckets.set(key, b);
        }
        return b;
    }
}
function bucketMedian(bucket) {
    const populated = [];
    for (let i = 0; i < bucket.filled; i++) {
        const v = bucket.slots[i];
        if (typeof v === "number") {
            populated.push(v);
        }
    }
    if (populated.length === 0) {
        return 0;
    }
    populated.sort((a, b) => a - b);
    const mid = Math.floor(populated.length / 2);
    if (populated.length % 2 === 1) {
        return populated[mid];
    }
    return (populated[mid - 1] + populated[mid]) / 2;
}
//# sourceMappingURL=anomaly.js.map