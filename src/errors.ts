export type ErrorCode =
  | "BUDGET_TOO_SMALL"
  | "INTERNAL"
  | "REQUEST_INVALID"
  | "REQUEST_TOO_LARGE"
  | "SOURCE_CHANGED"
  | "SOURCE_INVALID"
  | "USAGE";

export class ContextPatrolError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly exitCode = code === "REQUEST_INVALID" || code === "USAGE" ? 2 : 1,
  ) {
    super(message);
  }
}
