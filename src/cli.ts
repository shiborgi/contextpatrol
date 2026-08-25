import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIMITS,
  PROVIDER_NAME,
  PROVIDER_VERSION,
  SCHEMA_VERSION,
} from "./constants.js";
import { validateQueryRequest } from "./contracts.js";
import { ContextPatrolError } from "./errors.js";
import { canonicalJson } from "./json.js";
import { queryContext } from "./analyze.js";

const VERSION = readVersion();
const HELP = `ContextPatrol ${VERSION}

Usage:
  contextpatrol info
  contextpatrol query --input FILE|-
  contextpatrol --help
  contextpatrol --version
`;

function readVersion(): string {
  try {
    return (
      JSON.parse(
        readFileSync(
          join(
            dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
            "package.json",
          ),
          "utf8",
        ),
      ) as { version: string }
    ).version;
  } catch {
    return "0.0.0";
  }
}

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
  if (args.length === 0 || args.includes("--help"))
    return { exitCode: 0, stdout: HELP, stderr: "" };
  if (args.includes("--version"))
    return { exitCode: 0, stdout: `${VERSION}\n`, stderr: "" };
  if (args[0] === "info") {
    return success({
      schemaVersion: SCHEMA_VERSION,
      provider: { name: PROVIDER_NAME, version: PROVIDER_VERSION },
      facets: [
        "structure",
        "symbols",
        "relations",
        "source",
        "changes",
        "tests",
      ],
      limits: LIMITS,
      query: {
        argv: ["query", "--input", "FILE|-"],
        requestSchema:
          "https://shiborgi.dev/contextpatrol/query-request.schema.json",
        reportSchema:
          "https://shiborgi.dev/contextpatrol/context-report.schema.json",
      },
    });
  }
  if (
    args[0] !== "query" ||
    args[1] !== "--input" ||
    !args[2] ||
    args.length !== 3
  )
    return failure(
      new ContextPatrolError("USAGE", "expected query --input FILE|-", 2),
    );
  try {
    const input = args[2] === "-" ? await stdin() : readFileSync(args[2]);
    if (input.length > LIMITS.requestBytes)
      throw new ContextPatrolError(
        "REQUEST_TOO_LARGE",
        "request exceeds the input limit",
        2,
      );
    const parsed: unknown = JSON.parse(input.toString("utf8"));
    return success(await queryContext(validateQueryRequest(parsed)));
  } catch (error) {
    return failure(
      error instanceof ContextPatrolError
        ? error
        : new ContextPatrolError(
            "REQUEST_INVALID",
            "request is not valid JSON",
            2,
          ),
    );
  }
}

function success(value: unknown): CliResult {
  return { exitCode: 0, stdout: `${canonicalJson(value)}\n`, stderr: "" };
}

function failure(error: ContextPatrolError): CliResult {
  return {
    exitCode: error.exitCode,
    stdout: "",
    stderr: `${canonicalJson({ error: error.code, message: error.message })}\n`,
  };
}
