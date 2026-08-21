import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LIMITS, PROTOCOL_VERSION } from "./constants.js";
import { descriptor, errorSchema, packRequestSchema } from "./contracts.js";
import { PatrolError } from "./errors.js";
import { canonicalJsonLine } from "./hash.js";
import { pack } from "./pack.js";

const VERSION = readPackageVersion();

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"),
        "utf8",
      ),
    ) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

const USAGE = `contextpatrol ${VERSION}

Usage:
  contextpatrol protocol
  contextpatrol pack --request FILE|-
  contextpatrol --help
  contextpatrol --version

Commands:
  protocol    Print the provider descriptor (JSON).
  pack        Build a context capsule from a strict JSON request.

Options:
  --request FILE|-   Read the pack request from a file or stdin (-).
  --protocol-version N  Select the protocol version (only 1 is supported).
  --help, -h         Show this help.
  --version, -v      Print the version.
`;

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(
  argv: string[],
  stdin: () => Promise<Buffer>,
): Promise<CliResult> {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return ok(USAGE);
  }
  if (args.includes("--version") || args.includes("-v")) {
    return ok(`${VERSION}\n`);
  }

  const command = args[0];
  if (command === "protocol") {
    return ok(canonicalJsonLine(descriptor()));
  }

  if (command === "pack") {
    return runPack(args.slice(1), stdin);
  }

  return err(new PatrolError("USAGE", `unknown command: ${command ?? "(empty)"}`));
}

async function runPack(
  args: string[],
  stdin: () => Promise<Buffer>,
): Promise<CliResult> {
  let requestSource: string | null = null;
  let cliProtocolVersion: number | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--request") {
      requestSource = args[i + 1] ?? null;
      i += 1;
    } else if (arg === "--protocol-version") {
      const rawVersion = args[i + 1];
      if (rawVersion === undefined) {
        return err(new PatrolError("USAGE", "--protocol-version requires a value"));
      }
      cliProtocolVersion = Number(rawVersion);
      i += 1;
    } else {
      return err(new PatrolError("USAGE", `unknown pack option: ${arg}`));
    }
  }
  if (requestSource === null) {
    return err(new PatrolError("USAGE", "pack requires --request FILE|-"));
  }

  let raw: Buffer;
  try {
    raw = requestSource === "-" ? await stdin() : readFileSync(requestSource);
  } catch {
    return err(new PatrolError("REQUEST_READ_FAILED", "could not read request"));
  }
  if (raw.length > LIMITS.maxRequestBytes) {
    return err(new PatrolError("REQUEST_TOO_LARGE", "request exceeds maxRequestBytes"));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return err(new PatrolError("REQUEST_INVALID", "request is not valid JSON"));
  }

  const requestRecord =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const requestProtocol = requestRecord?.protocolVersion;
  const requestedProtocolVersion =
    requestProtocol ?? cliProtocolVersion ?? PROTOCOL_VERSION;
  if (
    typeof requestedProtocolVersion !== "number" ||
    !Number.isInteger(requestedProtocolVersion) ||
    (requestProtocol !== undefined &&
      cliProtocolVersion !== undefined &&
      requestProtocol !== cliProtocolVersion) ||
    requestedProtocolVersion !== PROTOCOL_VERSION
  ) {
    return err(
      new PatrolError(
        "PROTOCOL_UNSUPPORTED",
        "requested protocol version is unsupported",
        {
          requestedProtocolVersion,
          supportedProtocolVersions: [PROTOCOL_VERSION],
        },
      ),
    );
  }
  const result = packRequestSchema.safeParse({
    ...(requestRecord ?? {}),
    protocolVersion: PROTOCOL_VERSION,
  });
  if (!result.success) {
    const detail = result.error.issues
      .map(
        (issue) =>
          `${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
      )
      .join("; ");
    return err(new PatrolError("REQUEST_INVALID", `invalid request: ${detail}`));
  }

  try {
    const capsule = await pack(result.data);
    return ok(canonicalJsonLine(capsule));
  } catch (e) {
    return toError(e);
  }
}

function ok(stdout: string): CliResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function err(error: PatrolError): CliResult {
  return { exitCode: error.exitCode, stdout: "", stderr: `${formatError(error)}\n` };
}

function toError(e: unknown): CliResult {
  if (e instanceof PatrolError) {
    return err(e);
  }
  const message = e instanceof Error ? e.message : String(e);
  return err(new PatrolError("INTERNAL", message));
}

function formatError(error: PatrolError): string {
  const body = errorSchema.parse({
    error: error.code,
    message: error.message,
    ...error.details,
  });
  return canonicalJsonLine(body).trimEnd();
}
