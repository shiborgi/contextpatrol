#!/usr/bin/env node
import { Buffer } from "node:buffer";
import process from "node:process";
import { runCli } from "../dist/src/cli.js";

const result = await runCli(process.argv, async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
