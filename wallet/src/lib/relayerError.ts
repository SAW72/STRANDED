/**
 * User-facing text for Relayer HTTP errors.
 * 400, 429, and 502 use the server's `message` when it is present.
 * A non-JSON or non-object HTTP 502, 503, or 504 uses {@link RESCUE_SERVICE_BUSY}.
 * Other statuses and a missing `message` return null so callers keep their existing sentences.
 */

export const RESCUE_SERVICE_BUSY =
  "The rescue service is busy or unavailable right now. Please try again in a minute.";

/** POST /v1/quotes timed out. Signing stays blocked because there is no quote. */
export const RESCUE_SERVICE_TIMEOUT =
  "The rescue service didn't respond. Please try again in a minute.";

/**
 * POST /v1/rescues timed out. The relayer may still broadcast after the client gives up.
 */
export const RESCUE_SUBMIT_TIMEOUT =
  "The rescue service didn't respond in time. It may still go through, so check your wallet activity before trying again.";

/** Fetch failed before a response. The request may not have reached the service. */
export const RESCUE_UNREACHABLE =
  "We couldn't reach the rescue service. Check your connection and try again.";

/** A throw after POST /v1/rescues started. The broadcast may already be in flight. */
export const RESCUE_SEND_FAILED =
  "Something went wrong sending the rescue. Check your wallet activity, then get a new quote and try again.";

export const RESCUE_NOT_AVAILABLE =
  "The rescue service is not available right now. Please try again in a minute.";

export const RESCUE_COULD_NOT_SEND =
  "The rescue could not be sent. Request a fresh quote and try again.";

export const SIGNATURE_CANCELLED = "You cancelled the signature in your wallet.";

export const SIGNATURE_FAILED = "Your wallet couldn't sign this request. Please try again.";

/** Client deadline for POST /v1/quotes and POST /v1/rescues. */
export const RELAYER_FETCH_TIMEOUT_MS = 25_000;

const BUSY_WITHOUT_JSON = new Set([502, 503, 504]);

const READABLE_STATUS = new Set([400, 429, 502]);

const ISO_TIME_SOURCE =
  "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})";

export type RelayerMessageContext = {
  /** Clock used for `retryAfter` and for "today". Tests pin this. */
  now?: Date;
  /** Locale for the retry time. Omitted in the app so the browser locale is used. */
  locale?: string;
  /** Test override for {@link RELAYER_FETCH_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * `Retry-After` response header. Used for HTTP 429 only when the body has
   * no usable `retryAt` or `retryAfter`.
   */
  retryAfterHeader?: string | null;
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

function notInThePast(when: Date, now: Date): Date | null {
  if (Number.isNaN(when.getTime()) || Number.isNaN(now.getTime())) return null;
  if (when.getTime() < now.getTime()) return null;
  return when;
}

function secondsFromNow(seconds: number, now: Date): Date | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return notInThePast(new Date(now.getTime() + seconds * 1000), now);
}

/** Delta-seconds, or an HTTP-date. Garbage, negative, and past values are ignored. */
function retryFromHeader(header: string | null | undefined, now: Date): Date | null {
  if (typeof header !== "string") return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return secondsFromNow(Number(trimmed), now);
  return notInThePast(new Date(trimmed), now);
}

function retryInstant(
  body: Record<string, unknown>,
  now: Date,
  header: string | null | undefined,
): Date | null {
  if (typeof body.retryAt === "string" && body.retryAt.trim()) {
    const at = notInThePast(new Date(body.retryAt.trim()), now);
    if (at) return at;
  }
  if (typeof body.retryAfter === "number") {
    const at = secondsFromNow(body.retryAfter, now);
    if (at) return at;
  }
  return retryFromHeader(header, now);
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
 * HTTP 502, 503, or 504 whose body is not a JSON object.
 * A JSON error object keeps its own `message` or the caller's existing mapping.
 */
export function busyServiceMessage(status: number, body: unknown): string | null {
  if (!BUSY_WITHOUT_JSON.has(status)) return null;
  if (body !== null && typeof body === "object" && !Array.isArray(body)) return null;
  return RESCUE_SERVICE_BUSY;
}

export function relayerFetchSignal(context?: RelayerMessageContext): AbortSignal {
  const requested = context?.timeoutMs;
  const ms =
    typeof requested === "number" && Number.isFinite(requested) && requested > 0
      ? requested
      : RELAYER_FETCH_TIMEOUT_MS;
  return AbortSignal.timeout(ms);
}

export function isRelayerTimeout(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ("name" in err && err.name === "TimeoutError") return true;
  const cause = "cause" in err ? err.cause : undefined;
  return Boolean(cause && typeof cause === "object" && "name" in cause && cause.name === "TimeoutError");
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
    const when = retryInstant(record, now, context?.retryAfterHeader);
    if (!when) return message;
    const local = formatLocalRetry(when, now, context?.locale);
    if (!local) return message;
    return withLocalTime(message, local);
  } catch {
    return null;
  }
}
