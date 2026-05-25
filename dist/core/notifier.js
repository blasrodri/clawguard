/**
 * Outbound notifications (webhook → Slack/Discord/anything that takes a
 * JSON POST). Fire-and-forget: the governor never awaits us on the hot
 * path; a slow webhook can't slow down the gateway. Failures are routed
 * back through `onError` so the governor can audit them — a misconfigured
 * Slack URL must be visible in `clawguard report`, not silent.
 *
 * Zero dependencies — uses Node 18+'s global `fetch` and `AbortController`.
 */
/** No-op notifier used when no webhook URL is configured. */
export class NullNotifier {
    send() {
        // intentionally empty
    }
}
export class WebhookNotifier {
    url;
    timeoutMs;
    fetchImpl;
    onError;
    constructor(options) {
        this.url = options.url;
        this.timeoutMs = options.timeoutMs ?? 5_000;
        this.fetchImpl =
            options.fetch ?? globalThis.fetch;
        this.onError = options.onError;
    }
    send(event) {
        if (!this.fetchImpl) {
            this.onError?.(event, new Error("global fetch not available (Node < 18?)"));
            return;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        void this.fetchImpl(this.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(event),
            signal: controller.signal,
        })
            .then((res) => {
            if (!res.ok) {
                this.onError?.(event, new Error(`webhook returned ${res.status}`));
            }
        })
            .catch((err) => {
            this.onError?.(event, err);
        })
            .finally(() => clearTimeout(timer));
    }
}
//# sourceMappingURL=notifier.js.map