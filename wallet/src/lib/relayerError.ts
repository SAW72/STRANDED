/**
 * User-facing text for Relayer HTTP errors.
 * 400, 429, and 502 use the server's `message` when it is present.
 * Other statuses, non-JSON bodies, and a missing `message` return null
 * so callers keep their existing sentences.
 */

const READABLE_STATUS = new Set([400, 429, 502]);

const ISO_TIME_SOURCE =
  "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})";

export type RelayerMessageContext = {
  /** Clock used for `retryAfter` and for "today". Tests pin this. */
  now?: Date;
  /** Locale for the retry time. Omitted in the app so the browser locale is used. */
  locale?: string;
};

function asRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function readMessage(body: Record<string, unknown>): string | null {
  if (typeof body.message !== "string") return null;
  const trimmed = body.message.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function browserTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : undefined;
  } catch {
    return undefined;
  }
}

function sameLocalDay(
  when: Date,
  now: Date,
  locale: string | undefined,
  timeZone: string | undefined,
): boolean {
  try {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    if (timeZone) options.timeZone = timeZone;
    const day = new Intl.DateTimeFormat(locale, options);
    return day.format(when) === day.format(now);
  } catch {
    return (
      when.getFullYear() === now.getFullYear() &&
      when.getMonth() === now.getMonth() &&
      when.getDate() === now.getDate()
    );
  }
}

function formatLocalRetry(when: Date, now: Date, locale?: string): string | null {
  if (Number.isNaN(when.getTime()) || Number.isNaN(now.getTime())) return null;
  const timeZone = browserTimeZone();
  try {
    const sameDay = sameLocalDay(when, now, locale, timeZone);
    const options: Intl.DateTimeFormatOptions = sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
    if (timeZone) options.timeZone = timeZone;
    return sameDay ? when.toLocaleTimeString(locale, options) : when.toLocaleString(locale, options);
  } catch {
    return null;
  }
}

function retryInstant(body: Record<string, unknown>, now: Date): Date | null {
  if (typeof body.retryAt === "string" && body.retryAt.trim()) {
    const at = new Date(body.retryAt.trim());
    if (!Number.isNaN(at.getTime())) return at;
  }
  if (typeof body.retryAfter === "number" && Number.isFinite(body.retryAfter) && body.retryAfter >= 0) {
    const at = new Date(now.getTime() + body.retryAfter * 1000);
    if (!Number.isNaN(at.getTime())) return at;
  }
  return null;
}

function withLocalTime(message: string, local: string): string {
  const iso = new RegExp(ISO_TIME_SOURCE, "g");
  if (!iso.test(message)) {
    const stem = message.replace(/[\s.]+$/, "");
    return `${stem}. You can try again at ${local}.`;
  }
  return message.replace(new RegExp(ISO_TIME_SOURCE, "g"), local);
}

/**
 * Main error text for HTTP 400, 429, and 502 when the body has a `message`.
 * On 429, an ISO timestamp in that message is replaced with local time.
 * Returns null when the caller should keep its existing reason.
 */
export function relayerUserMessage(
  status: number,
  body: unknown,
  context?: RelayerMessageContext,
): string | null {
  try {
    if (!READABLE_STATUS.has(status)) return null;
    const record = asRecord(body);
    if (!record) return null;
    const message = readMessage(record);
    if (!message) return null;
    if (status !== 429) return message;

    const now = context?.now && !Number.isNaN(context.now.getTime()) ? context.now : new Date();
    const when = retryInstant(record, now);
    if (!when) return message;
    const local = formatLocalRetry(when, now, context?.locale);
    if (!local) return message;
    return withLocalTime(message, local);
  } catch {
    return null;
  }
}
