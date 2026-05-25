/**
 * Outbound notifications (webhook → Slack/Discord/anything that takes a
 * JSON POST). Fire-and-forget: the governor never awaits us on the hot
 * path; a slow webhook can't slow down the gateway. Failures are routed
 * back through `onError` so the governor can audit them — a misconfigured
 * Slack URL must be visible in `clawguard report`, not silent.
 *
 * Zero dependencies — uses Node 18+'s global `fetch` and `AbortController`.
 */
export type NotificationKind = "budget_threshold" | "kill_switch" | "breaker_open" | "cost_anomaly";
export interface NotificationEvent {
    readonly type: NotificationKind;
    readonly ts: string;
    readonly [key: string]: unknown;
}
export interface Notifier {
    /** Fire-and-forget; never throws, never blocks. */
    send(event: NotificationEvent): void;
}
/** No-op notifier used when no webhook URL is configured. */
export declare class NullNotifier implements Notifier {
    send(): void;
}
export type FetchLike = (input: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}) => Promise<{
    ok: boolean;
    status: number;
}>;
export interface WebhookOptions {
    readonly url: string;
    readonly timeoutMs?: number;
    /** Injectable for tests; defaults to the global fetch. */
    readonly fetch?: FetchLike;
    /** Invoked when the POST fails or returns non-2xx. */
    readonly onError?: (event: NotificationEvent, error: unknown) => void;
}
export declare class WebhookNotifier implements Notifier {
    private readonly url;
    private readonly timeoutMs;
    private readonly fetchImpl;
    private readonly onError;
    constructor(options: WebhookOptions);
    send(event: NotificationEvent): void;
}
//# sourceMappingURL=notifier.d.ts.map