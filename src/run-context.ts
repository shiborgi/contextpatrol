export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export function stderrLogger(threshold: LogLevel | "silent"): Logger {
  if (threshold === "silent") return noopLogger;
  const emit = (level: LogLevel, message: string): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) return;
    process.stderr.write(`[contextpatrol] ${level}: ${message}\n`);
  };
  return {
    debug: (message) => emit("debug", message),
    info: (message) => emit("info", message),
    warn: (message) => emit("warn", message),
    error: (message) => emit("error", message),
  };
}

export interface RunContext {
  readonly log: Logger;
}
