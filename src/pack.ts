import { clipText, estimateTokens, packBudget } from "./budget.js";
import {
  DEFAULT_DENYLIST,
  ESTIMATOR,
  FOCUS_VALUES,
  type Focus,
  LIMITS,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
} from "./constants.js";
import type { Capsule, Evidence, PackRequest } from "./contracts.js";
import { PatrolError } from "./errors.js";
import {
  dirtyEntries,
  headOf,
  listFiles,
  resolveWorkspace,
  type WorkspaceIdentity,
} from "./git-workspace.js";
import { compareBytewise, digestOf } from "./hash.js";
import type { SymbolFact } from "./model.js";
import { canonicalizePath, isDenied, redact } from "./security.js";
import { finalizeSnapshot, type ScanResult, scanWorkspace } from "./snapshot.js";
import { readSource } from "./source-reader.js";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "be",
  "it",
  "this",
  "that",
  "which",
  "as",
  "at",
  "by",
  "from",
  "into",
  "about",
  "over",
  "under",
  "do",
  "does",
  "did",
]);

interface NormalizedRequest {
  workspace: string;
  intent: string;
  focus: Focus[];
  tokenBudget: number;
  changedPaths: string[];
}

function normalize(request: PackRequest): NormalizedRequest {
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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((term) => term.length >= 2 && !STOPWORDS.has(term));
}

function symbolScore(
  symbol: SymbolFact,
  terms: string[],
  changedPaths: string[],
): number {
  const name = symbol.name.toLowerCase();
  const qualified = symbol.qualifiedName.toLowerCase();
  const path = symbol.path.toLowerCase();
  const context = `${symbol.signature} ${symbol.jsdoc}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (name.includes(term)) {
      score += 3;
    }
    if (qualified.includes(term)) {
      score += 2;
    }
    if (path.includes(term)) {
      score += 2;
    }
    if (context.includes(term)) {
      score += 1;
    }
  }
  if (symbol.exported) {
    score += 1;
  }
  for (const cp of changedPaths) {
    const lower = cp.toLowerCase();
    if (path === lower || path.startsWith(`${lower}/`)) {
      score += 10;
      break;
    }
  }
  return score;
}

interface Candidate {
  evidence: Evidence;
  clipable: boolean;
}

function symbolId(symbol: SymbolFact, kind: "sym" | "src"): string {
  return `${kind}:${symbol.qualifiedName}#L${symbol.range.startLine}-${symbol.range.endLine}`;
}

function buildArchitectureEvidence(
  fileFacts: { path: string; language: string; symbols: SymbolFact[] }[],
): Evidence {
  const byLanguage = new Map<string, number>();
  const byDir = new Map<string, number>();
  let symbolCount = 0;
  const entryPoints: string[] = [];

  for (const file of fileFacts) {
    byLanguage.set(file.language, (byLanguage.get(file.language) ?? 0) + 1);
    const dir = file.path.includes("/") ? (file.path.split("/")[0] ?? ".") : ".";
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
    symbolCount += file.symbols.length;
    if (/^(src\/)?index\.(ts|js|tsx|jsx)$/i.test(file.path)) {
      entryPoints.push(file.path);
    }
  }

  const languages = [...byLanguage.entries()]
    .sort((a, b) => compareBytewise(a[0], b[0]))
    .map(([lang, count]) => `${lang}: ${count}`)
    .join(", ");
  const dirs = [...byDir.entries()]
    .sort((a, b) => compareBytewise(a[0], b[0]))
    .map(([dir, count]) => `${dir} (${count})`)
    .join(", ");

  const text = [
    `Files: ${fileFacts.length} (${languages || "none"})`,
    `Symbols: ${symbolCount}`,
    `Top-level: ${dirs || "none"}`,
    entryPoints.length > 0 ? `Entry points: ${entryPoints.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: "arch:repository",
    kind: "architecture",
    title: "Repository architecture",
    text,
    provenance: "heuristic",
    confidence: 0.7,
    estimatedTokens: estimateTokens(text),
  };
}

function symbolEvidence(symbol: SymbolFact): Evidence {
  const parts = [symbol.signature];
  if (symbol.jsdoc) {
    parts.push(symbol.jsdoc);
  }
  const text = redact(parts.join("\n"));
  return {
    id: symbolId(symbol, "sym"),
    kind: "symbol",
    title: symbol.name,
    text,
    path: symbol.path,
    range: symbol.range,
    provenance: "extracted",
    confidence: symbol.confidence,
    estimatedTokens: estimateTokens(text),
  };
}

function sourceEvidence(symbol: SymbolFact): Evidence {
  const text = redact(symbol.source);
  return {
    id: symbolId(symbol, "src"),
    kind: "source",
    title: symbol.name,
    text,
    path: symbol.path,
    range: symbol.range,
    provenance: "extracted",
    confidence: symbol.confidence,
    estimatedTokens: estimateTokens(text),
  };
}

export interface PackOptions {
  extraDenylist?: readonly string[];
}

export async function pack(
  request: PackRequest,
  options: PackOptions = {},
): Promise<Capsule> {
  const normalized = normalize(request);
  const denylist = [...DEFAULT_DENYLIST, ...(options.extraDenylist ?? [])];

  // Drop changed paths that the policy would deny.
  const changedPaths = normalized.changedPaths.filter((p) => !isDenied(p, denylist));

  const identity = resolveWorkspace(normalized.workspace);

  const scan = await scanWorkspace(identity, denylist, LIMITS.maxFiles);
  const { snapshot } = finalizeSnapshot(scan, identity);

  const allSymbols: SymbolFact[] = [];
  for (const file of scan.fileFacts) {
    for (const symbol of file.symbols) {
      allSymbols.push(symbol);
    }
  }

  const terms = tokenize(normalized.intent);
  const ranked = allSymbols
    .map((symbol) => ({ symbol, score: symbolScore(symbol, terms, changedPaths) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        compareBytewise(a.symbol.qualifiedName, b.symbol.qualifiedName),
    );

  const candidates: Candidate[] = [];
  if (normalized.focus.includes("architecture")) {
    candidates.push({
      evidence: buildArchitectureEvidence(scan.fileFacts),
      clipable: false,
    });
  }

  if (normalized.focus.includes("symbols")) {
    for (const { symbol } of ranked.slice(0, 500)) {
      candidates.push({ evidence: symbolEvidence(symbol), clipable: false });
    }
  }

  if (normalized.focus.includes("source")) {
    for (const { symbol } of ranked.slice(0, 200)) {
      candidates.push({ evidence: sourceEvidence(symbol), clipable: true });
    }
  }

  const packed = packBudget(
    candidates.map((c) => ({
      id: c.evidence.id,
      estimatedTokens: c.evidence.estimatedTokens,
      clipable: c.clipable,
    })),
    normalized.tokenBudget,
  );

  const candidateById = new Map(candidates.map((c) => [c.evidence.id, c]));
  const evidence: Evidence[] = [];
  for (const item of packed.included) {
    const candidate = candidateById.get(item.id);
    if (!candidate) {
      continue;
    }
    let ev = candidate.evidence;
    if (item.clipped) {
      const text = clipText(ev.text, item.estimatedTokens);
      ev = {
        ...ev,
        text,
        clipped: true,
        estimatedTokens: estimateTokens(text),
      };
    }
    evidence.push(ev);
  }

  const omitted = packed.omitted.map((o) => ({ ...o }));
  if (omitted.length > 50) {
    const extra = omitted.length - 50;
    omitted.length = 50;
    omitted.push({ id: `...${extra} more`, reason: "token-budget" });
  }

  const warnings: string[] = [];
  const denied = scan.skipped.filter((s) => s.reason === "denylist").length;
  if (denied > 0) {
    warnings.push(`${denied} file(s) excluded by denylist`);
  }
  const tooLarge = scan.skipped.filter(
    (s) => s.reason === "too-large" || s.reason === "binary",
  );
  if (tooLarge.length > 0) {
    warnings.push(`${tooLarge.length} file(s) skipped (too-large or binary)`);
  }
  if (scan.truncated) {
    warnings.push(
      `workspace exceeds maxFiles (${LIMITS.maxFiles}); snapshot is partial`,
    );
  }

  await verifyUnchanged(identity, denylist, scan);

  const requestDigest = digestOf({
    protocolVersion: PROTOCOL_VERSION,
    workspace: identity.workspaceId,
    intent: normalized.intent,
    focus: normalized.focus,
    tokenBudget: normalized.tokenBudget,
    changedPaths,
  });

  const capsuleId = `ctx-${digestOf({ requestDigest, snapshotDigest: snapshot.snapshotDigest }).slice(0, 16)}`;
  const estimatedTokens = evidence.reduce((sum, ev) => sum + ev.estimatedTokens, 0);

  const body: Omit<Capsule, "capsuleDigest"> = {
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    capsuleId,
    requestDigest,
    intent: normalized.intent,
    focus: normalized.focus,
    snapshot,
    budget: {
      requestedTokens: normalized.tokenBudget,
      estimatedTokens,
      estimator: ESTIMATOR,
    },
    changedPaths,
    evidence,
    omitted,
    warnings,
  };

  const capsule: Capsule = {
    ...body,
    capsuleDigest: digestOf(body),
  };

  return capsule;
}

async function verifyUnchanged(
  identity: WorkspaceIdentity,
  denylist: readonly string[],
  scan: ScanResult,
): Promise<void> {
  if (headOf(identity.root) !== identity.head) {
    throw new PatrolError(
      "SOURCE_CHANGED",
      "workspace HEAD changed during the operation",
    );
  }

  const afterFiles = listFiles(identity.root)
    .filter((p) => !isDenied(p, denylist))
    .slice(0, LIMITS.maxFiles)
    .sort(compareBytewise);
  if (
    afterFiles.join("\0") !==
    scan.eligiblePaths.slice().sort(compareBytewise).join("\0")
  ) {
    throw new PatrolError(
      "SOURCE_CHANGED",
      "workspace files changed during the operation",
    );
  }

  const norm = (e: { path: string; status: string }) => `${e.path}\0${e.status}`;
  const beforeDirty = scan.dirtyEntries.map(norm).sort(compareBytewise).join("\n");
  const afterDirty = dirtyEntries(identity.root)
    .map(norm)
    .sort(compareBytewise)
    .join("\n");
  if (beforeDirty !== afterDirty) {
    throw new PatrolError(
      "SOURCE_CHANGED",
      "workspace dirty state changed during the operation",
    );
  }

  for (const file of scan.dirtyFiles) {
    const read = await readSource(`${identity.root}/${file.path}`);
    const digest = read.skipped
      ? digestOf({ path: file.path, reason: read.reason })
      : read.digest;
    if (digest !== file.digest) {
      throw new PatrolError(
        "SOURCE_CHANGED",
        `file ${file.path} changed during the operation`,
      );
    }
  }
}
