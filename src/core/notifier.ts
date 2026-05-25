/**
 * Outbound notifications (webhook → Slack/Discord/anything that takes a
 * JSON POST). Fire-and-forget: the governor never awaits us on the hot
 * path; a slow webhook can't slow down the gateway. Failures are routed
 * back through `onError` so the governor can audit them — a misconfigured
 * Slack URL must be visible in `clawguard report`, not silent.
 *
 * Zero dependencies — uses Node 18+'s global `fetch` and `AbortController`.
 */

export type NotificationKind =
  | "budget_threshold"
  | "kill_switch"
  | "breaker_open"
  | "cost_anomaly";

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
export class NullNotifier implements Notifier {
  send(): void {
    // intentionally empty
  }
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number }>;

export interface WebhookOptions {
  readonly url: string;
  readonly timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetch?: FetchLike;
  /** Invoked when the POST fails or returns non-2xx. */
  readonly onError?: (event: NotificationEvent, error: unknown) => void;
}

export class WebhookNotifier implements Notifier {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly onError: ((event: NotificationEvent, error: unknown) => void) | undefined;

  constructor(options: WebhookOptions) {
    this.url = options.url;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImpl =
      options.fetch ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike);
    this.onError = options.onError;
  }

  send(event: NotificationEvent): void {
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
