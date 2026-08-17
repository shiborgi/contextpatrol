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
  return {
    workspace: request.workspace,
    intent,
    focus,
    tokenBudget: request.tokenBudget,
    changedPaths,
  };
}
