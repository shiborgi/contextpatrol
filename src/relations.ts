import path from "node:path";
import { SOURCE_EXTENSIONS } from "./constants.js";

export function resolveImport(
  from: string,
  specifier: string,
  files: Set<string>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(from), specifier),
  );
  const candidates = [
    base,
    ...[...SOURCE_EXTENSIONS].map((extension) => `${base}${extension}`),
    ...[...SOURCE_EXTENSIONS].map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => files.has(candidate));
}
