import path from "node:path";
import { compareText } from "./json.js";
import type { ContextReport, SourceFile } from "./types.js";

export function testSignals(
  files: SourceFile[],
  changes: ContextReport["changes"],
): ContextReport["tests"] {
  const testFiles = files
    .filter((file) =>
      /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[^.]+$/i.test(file.path),
    )
    .map((file) => file.path)
    .sort(compareText);
  const changedSourceWithoutTest = changes
    .filter((change) => change.status !== "deleted")
    .map((change) => change.path)
    .filter(
      (file) =>
        !/(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[^.]+$/i.test(file),
    )
    .filter((file) => {
      const stem = path.posix.basename(file).replace(/\.[^.]+$/, "");
      return !testFiles.some((test) => path.posix.basename(test).includes(stem));
    })
    .sort(compareText);
  return { files: testFiles, changedSourceWithoutTest };
}
