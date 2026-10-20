export class PointsError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function ledgerErrorCode(err: unknown): "duplicate" | "append-only" | "excluded_action" | null {
  const message = errorText(err);
  if (message.includes("excluded_action")) return "excluded_action";
  if (message.includes("append-only")) return "append-only";
  if (message.includes("duplicate")) return "duplicate";
  return null;
}

function errorText(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const cause = "cause" in err ? errorText(err.cause) : "";
    return `${err.message}\n${cause}`;
  }
  return String(err);
}
