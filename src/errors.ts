export type ErrorCode =
  | "USAGE"
  | "REQUEST_INVALID"
  | "REQUEST_READ_FAILED"
  | "REQUEST_TOO_LARGE"
  | "WORKSPACE_INVALID"
  | "SOURCE_CHANGED"
  | "INTERNAL";

const EXIT_CODES: Record<ErrorCode, number> = {
  USAGE: 2,
  REQUEST_INVALID: 2,
  REQUEST_READ_FAILED: 2,
  REQUEST_TOO_LARGE: 2,
  WORKSPACE_INVALID: 1,
  SOURCE_CHANGED: 1,
  INTERNAL: 1,
};

export class PatrolError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "PatrolError";
    this.code = code;
    this.exitCode = EXIT_CODES[code];
  }
}
