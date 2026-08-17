import { DEFAULT_DENYLIST } from "../constants.js";
import { isDenied } from "../security.js";

export function buildDenylist(extraDenylist?: readonly string[]): string[] {
  return [...DEFAULT_DENYLIST, ...(extraDenylist ?? [])];
}

export function filterAllowedPaths(
  paths: readonly string[],
  denylist: readonly string[],
): string[] {
  return paths.filter((p) => !isDenied(p, denylist));
}
