import path from "node:path";
import { SOURCE_EXTENSIONS } from "./constants.js";

export interface PathAlias {
  pattern: string;
  target: string;
  baseDir: string;
}

export function resolveImport(
  from: string,
  specifier: string,
  files: Set<string>,
  aliases: PathAlias[] = [],
): string | undefined {
  if (specifier.startsWith(".")) {
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
  for (const alias of aliases) {
    const resolved = resolveAlias(alias, specifier, files);
    if (resolved) return resolved;
  }
  return undefined;
}

function resolveAlias(
  alias: PathAlias,
  specifier: string,
  files: Set<string>,
): string | undefined {
  const star = alias.pattern.indexOf("*");
  if (star === -1) {
    if (specifier !== alias.pattern) return undefined;
    return resolveCandidates(alias.target, alias.baseDir, files);
  }
  const prefix = alias.pattern.slice(0, star);
  const suffix = alias.pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return undefined;
  const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
  const target = alias.target.replace("*", wildcard);
  return resolveCandidates(target, alias.baseDir, files);
}

function resolveCandidates(
  target: string,
  baseDir: string,
  files: Set<string>,
): string | undefined {
  const base = path.posix.normalize(path.posix.join(baseDir, target));
  const candidates = [
    base,
    ...[...SOURCE_EXTENSIONS].map((extension) => `${base}${extension}`),
    ...[...SOURCE_EXTENSIONS].map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => files.has(candidate));
}
