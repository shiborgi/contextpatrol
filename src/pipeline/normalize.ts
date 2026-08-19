import { FOCUS_VALUES, type Focus } from "../constants.js";
import type { PackRequest } from "../contracts.js";
import { PatrolError } from "../errors.js";
import { compareBytewise } from "../hash.js";
import { canonicalizePath } from "../security.js";

export interface NormalizedRequest {
  workspace: string;
  intent: string;
  focus: Focus[];
  tokenBudget: number;
  changedPaths: string[];
  gitRef?: string;
  baseRef?: string;
  includePaths?: string[];
  excludePaths?: string[];
}

export function normalize(request: PackRequest): NormalizedRequest {
  const intent = request.intent.trim();
  if (intent === "") {
    throw new PatrolError("REQUEST_INVALID", "intent is empty");
  }
  const focusOrder = [...FOCUS_VALUES];
  const focus = focusOrder.filter((f) => (request.focus as string[]).includes(f));
  if (focus.length === 0) {
    throw new PatrolError("REQUEST_INVALID", "focus is empty");
  }
  const changedPaths: string[] = [];
  for (const raw of request.changedPaths ?? []) {
    const canonical = canonicalizePath(raw);
    if (canonical === null) {
      throw new PatrolError("REQUEST_INVALID", `invalid changed path: ${raw}`);
    }
    if (!changedPaths.includes(canonical)) {
      changedPaths.push(canonical);
    }
  }
  changedPaths.sort(compareBytewise);

  let gitRef: string | undefined;
  if (request.gitRef !== undefined) {
    const trimmed = request.gitRef.trim();
    if (trimmed === "") {
      throw new PatrolError("REQUEST_INVALID", "gitRef is empty");
    }
    gitRef = trimmed;
  }

  let baseRef: string | undefined;
  if (request.baseRef !== undefined) {
    const trimmed = request.baseRef.trim();
    if (trimmed === "") {
      throw new PatrolError("REQUEST_INVALID", "baseRef is empty");
    }
    baseRef = trimmed;
  }

  const includePaths: string[] = [];
  for (const raw of request.includePaths ?? []) {
    const canonical = canonicalizePath(raw);
    if (canonical === null) {
      throw new PatrolError("REQUEST_INVALID", `invalid include path: ${raw}`);
    }
    if (!includePaths.includes(canonical)) {
      includePaths.push(canonical);
    }
  }
  includePaths.sort(compareBytewise);

  const excludePaths: string[] = [];
  for (const raw of request.excludePaths ?? []) {
    const canonical = canonicalizePath(raw);
    if (canonical === null) {
      throw new PatrolError("REQUEST_INVALID", `invalid exclude path: ${raw}`);
    }
    if (!excludePaths.includes(canonical)) {
      excludePaths.push(canonical);
    }
  }
  excludePaths.sort(compareBytewise);

  return {
    workspace: request.workspace,
    intent,
    focus,
    tokenBudget: request.tokenBudget,
    changedPaths,
    gitRef,
    baseRef,
    includePaths: includePaths.length > 0 ? includePaths : undefined,
    excludePaths: excludePaths.length > 0 ? excludePaths : undefined,
  };
}
