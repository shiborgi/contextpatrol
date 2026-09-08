import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { LIMITS, PROFILES, PROTOCOL_VERSION, VERSION } from "./contracts.js";
import { canonicalJson } from "./json.js";
import { query } from "./query.js";

const HELP = `ContextPatrol ${VERSION} (Node.js 22.13+)\n\nUsage:\n  contextpatrol query [--input FILE|-]   Read one Patrol Protocol ${PROTOCOL_VERSION} JSON query (stdin by default)\n  contextpatrol info                    Print provider information\n  contextpatrol --help                  Show help\n  contextpatrol --version               Show version\n\nQuery: {"protocolVersion":"${PROTOCOL_VERSION}","root":"/absolute/repo","task":"describe task"}\nProfiles: ${PROFILES.join(", ")}\nRead-only filesystem analysis; no code execution or network access.\n`;

export async function runCli(
  args: string[],
  stdin: AsyncIterable<Uint8Array | string> = process.stdin,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    if (args.length === 1 && ["--help", "-h", "help"].includes(args[0] ?? ""))
      return { stdout: HELP, stderr: "", exitCode: 0 };
    if (args.length === 1 && ["--version", "version"].includes(args[0] ?? ""))
      return { stdout: `${VERSION}\n`, stderr: "", exitCode: 0 };
    if (args.length === 1 && args[0] === "info")
      return {
        stdout: `${canonicalJson({ name: "contextpatrol", version: VERSION, protocolVersion: PROTOCOL_VERSION, profiles: PROFILES })}\n`,
        stderr: "",
        exitCode: 0,
      };
    if (
      args[0] !== "query" ||
      !(
        args.length === 1 ||
        (args.length === 3 &&
          args[1] === "--input" &&
          args[2] &&
          !args[2].startsWith("--"))
      )
    )
      throw new Error(
        "Usage: contextpatrol query [--input FILE|-], info, --help, or --version",
      );
    const chunks: Buffer[] = [];
    let size = 0;
    if (args[2] && args[2] !== "-") {
      const handle = await open(
        args[2],
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > LIMITS.maxInputBytes)
          throw new Error("input must be a regular file of at most 65536 bytes");
        const buffer = Buffer.alloc(LIMITS.maxInputBytes + 1);
        while (size < buffer.length) {
          const { bytesRead } = await handle.read(
            buffer,
            size,
            buffer.length - size,
            null,
          );
          if (!bytesRead) break;
          size += bytesRead;
        }
        chunks.push(buffer.subarray(0, size));
      } finally {
        await handle.close();
      }
    } else {
      for await (const chunk of stdin) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > LIMITS.maxInputBytes) throw new Error("input exceeds 65536 bytes");
        chunks.push(buffer);
      }
    }
    if (size > LIMITS.maxInputBytes) throw new Error("input exceeds 65536 bytes");
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      throw new Error("input must be one valid UTF-8 JSON object");
    }
    return {
      stdout: `${canonicalJson(await query(input))}\n`,
      stderr: "",
      exitCode: 0,
    };
  } catch (error) {
    // Do not echo malformed input or source contents into diagnostics.
    const message =
      error instanceof Error && !("code" in error)
        ? error.message
        : "input or repository is inaccessible";
    return { stdout: "", stderr: `contextpatrol: ${message}\n`, exitCode: 1 };
  }
}
