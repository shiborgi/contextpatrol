import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { LIMITS } from "../constants.js";
import { PatrolError } from "../errors.js";
import { compareBytewise } from "../hash.js";
import { canonicalizePath } from "../security.js";

const projectOverlaySchema = z
  .object({
    includePaths: z.array(z.string().min(1)).max(LIMITS.maxChangedPaths).optional(),
    excludePaths: z.array(z.string().min(1)).max(LIMITS.maxChangedPaths).optional(),
  })
  .strict();

export interface ProjectOverlay {
  includePaths?: string[];
  excludePaths?: string[];
}

export function loadProjectOverlay(gitRoot: string): ProjectOverlay | null {
  const overlayPath = join(gitRoot, "contextpatrol.project.json");
  let raw: string;
  try {
    raw = readFileSync(overlayPath, "utf8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return null;
    }
    throw new PatrolError("REQUEST_INVALID", `failed to read overlay: ${err.message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PatrolError(
      "REQUEST_INVALID",
      "invalid JSON in contextpatrol.project.json",
    );
  }

  const result = projectOverlaySchema.safeParse(parsed);
  if (!result.success) {
    throw new PatrolError(
      "REQUEST_INVALID",
      "invalid contextpatrol.project.json: " + result.error.message,
    );
  }

  const overlay = result.data;

  const includePaths: string[] = [];
  for (const raw of overlay.includePaths ?? []) {
    const canonical = canonicalizePath(raw);
    if (canonical === null) {
      throw new PatrolError(
        "REQUEST_INVALID",
        `invalid include path in overlay: ${raw}`,
      );
    }
    if (!includePaths.includes(canonical)) {
      includePaths.push(canonical);
    }
  }
  includePaths.sort(compareBytewise);

  const excludePaths: string[] = [];
  for (const raw of overlay.excludePaths ?? []) {
    const canonical = canonicalizePath(raw);
    if (canonical === null) {
      throw new PatrolError(
        "REQUEST_INVALID",
        `invalid exclude path in overlay: ${raw}`,
      );
    }
    if (!excludePaths.includes(canonical)) {
      excludePaths.push(canonical);
    }
  }
  excludePaths.sort(compareBytewise);

  return {
    includePaths: includePaths.length > 0 ? includePaths : undefined,
    excludePaths: excludePaths.length > 0 ? excludePaths : undefined,
  };
}
