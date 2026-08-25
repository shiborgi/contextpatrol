import path from "node:path";
import { LIMITS, PROVIDER_NAME, PROVIDER_VERSION } from "./constants.js";
import { ContextPatrolError } from "./errors.js";
import { type CachedFacts, IndexStore } from "./index-store.js";
import { canonicalJson, compareText, digest } from "./json.js";
import { parseFile } from "./parser.js";
import { loadSource, verifySourceUnchanged } from "./source.js";
import type { ContextReport, QueryRequest, SourceFile } from "./types.js";

interface IndexedFile {
  file: SourceFile;
  facts: CachedFacts;
  score: number;
}

function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [])].sort(
    compareText,
  );
}

function score(file: SourceFile, facts: CachedFacts, terms: string[]): number {
  const pathTerms = file.path.toLowerCase();
  return terms.reduce((total, term) => {
    const symbolHits = facts.terms.filter((value) => value === term).length;
    return total + symbolHits * 4 + (pathTerms.includes(term) ? 2 : 0);
  }, 0);
}

function factsAtPath(facts: CachedFacts, file: SourceFile): CachedFacts {
  return {
    ...facts,
    symbols: facts.symbols.map((symbol) => ({
      ...symbol,
      id: `sym:${file.path}#${symbol.name}:${symbol.startLine}`,
      path: file.path,
    })),
  };
}

function resolveImport(
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
    ...[
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
      ".go",
      ".rs",
      ".java",
      ".cs",
      ".kt",
      ".php",
      ".rb",
      ".swift",
      ".c",
    ].map((extension) => `${base}${extension}`),
    ...[".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"].map(
      (extension) => `${base}/index${extension}`,
    ),
  ];
  return candidates.find((candidate) => files.has(candidate));
}

function testSignals(
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

function snippet(file: SourceFile, terms: string[]): ContextReport["snippets"][number] {
  const lines = file.content.split("\n");
  const match = lines.findIndex((line) =>
    terms.some((term) => line.toLowerCase().includes(term)),
  );
  const start = Math.max(0, (match < 0 ? 0 : match) - 12);
  const selected = lines.slice(start, start + 25);
  let text = selected.join("\n");
  if (Buffer.byteLength(text, "utf8") > 2_400)
    text = Buffer.from(text, "utf8").subarray(0, 2_400).toString("utf8");
  return {
    path: file.path,
    startLine: start + 1,
    endLine: start + selected.length,
    text,
    clipped: start > 0 || start + selected.length < lines.length,
  };
}

function finalize(report: Omit<ContextReport, "reportDigest">): ContextReport {
  return { ...report, reportDigest: digest(report) };
}

function outputBytes(report: Omit<ContextReport, "reportDigest">): number {
  return Buffer.byteLength(canonicalJson(finalize(report)), "utf8") + 1;
}

function refreshBudget(
  report: Omit<ContextReport, "reportDigest">,
  available: {
    files: number;
    symbols: number;
    relations: number;
    snippets: number;
    changes: number;
    testFiles: number;
    testGaps: number;
    unresolvedRelations: number;
  },
): number {
  report.coverage.omittedFiles = available.files - report.files.length;
  report.coverage.omittedSymbols = available.symbols - report.symbols.length;
  report.coverage.omittedRelations = available.relations - report.relations.length;
  report.coverage.omittedSnippets = available.snippets - report.snippets.length;
  report.coverage.unresolvedRelations = available.unresolvedRelations;
  let bytes = outputBytes(report);
  while (report.budget.outputBytes !== bytes) {
    report.budget.outputBytes = bytes;
    bytes = outputBytes(report);
  }
  return bytes;
}

export async function queryContext(request: QueryRequest): Promise<ContextReport> {
  const source = loadSource(request);
  const store = new IndexStore(source.root);
  try {
    const terms = queryTerms(request.query);
    const indexed: IndexedFile[] = [];
    for (const file of source.files) {
      const cached = store.get(file.hash);
      const facts = factsAtPath(cached ?? (await parseFile(file)), file);
      if (!cached) store.put(file.hash, facts);
      indexed.push({ file, facts, score: score(file, facts, terms) });
    }
    const matchingHashes = store.search(terms);
    const ranked = indexed.sort(
      (left, right) =>
        right.score - left.score || compareText(left.file.path, right.file.path),
    );
    const selected = ranked
      .filter(
        ({ file, score: value }) =>
          matchingHashes.size === 0 || matchingHashes.has(file.hash) || value > 0,
      )
      .slice(0, LIMITS.maxSelectedFiles);
    const selectedOrFallback =
      selected.length > 0 ? selected : ranked.slice(0, LIMITS.maxSelectedFiles);
    const known = new Set(source.files.map((file) => file.path));
    const selectedPaths = new Set(selectedOrFallback.map(({ file }) => file.path));
    const relationSources = indexed.filter(
      ({ file, facts }) =>
        selectedPaths.has(file.path) ||
        facts.imports.some((specifier) =>
          selectedPaths.has(resolveImport(file.path, specifier, known) ?? ""),
        ),
    );
    const relationFacts: ContextReport["relations"] = [];
    let unresolvedRelations = 0;
    for (const { file, facts } of relationSources) {
      for (const specifier of facts.imports) {
        const target = resolveImport(file.path, specifier, known);
        if (target)
          relationFacts.push({ kind: "imports", from: file.path, to: target });
        else if (specifier.startsWith(".")) unresolvedRelations += 1;
      }
    }
    relationFacts.sort((left, right) =>
      compareText(`${left.from}\0${left.to}`, `${right.from}\0${right.to}`),
    );
    const allSymbols = selectedOrFallback
      .flatMap(({ facts }) => facts.symbols)
      .sort((left, right) => compareText(left.id, right.id));
    const allSnippets = selectedOrFallback
      .slice(0, LIMITS.maxSnippets)
      .map(({ file }) => snippet(file, terms));
    const changes = request.facets.includes("changes") ? source.changes : [];
    const tests = request.facets.includes("tests")
      ? testSignals(source.files, source.changes)
      : { files: [], changedSourceWithoutTest: [] };
    const report: Omit<ContextReport, "reportDigest"> = {
      schemaVersion: 1,
      provider: { name: PROVIDER_NAME, version: PROVIDER_VERSION },
      requestDigest: digest(request),
      target: {
        kind: source.kind,
        commit: source.commit,
        dirtyDigest: source.dirtyDigest,
        contentDigest: source.contentDigest,
      },
      budget: {
        maxOutputBytes: request.maxOutputBytes,
        outputBytes: 0,
        limited: false,
      },
      summary: {
        query: request.query,
        filesConsidered: source.eligibleFiles,
        filesSelected: selectedOrFallback.length,
      },
      files: request.facets.includes("structure")
        ? selectedOrFallback.map(({ file, score: value }) => ({
            path: file.path,
            score: value,
            language: file.language,
            lines: file.lines,
          }))
        : [],
      symbols: request.facets.includes("symbols")
        ? allSymbols.slice(0, LIMITS.maxSymbols)
        : [],
      relations: request.facets.includes("relations")
        ? relationFacts.slice(0, LIMITS.maxRelations)
        : [],
      changes,
      tests,
      snippets: request.facets.includes("source") ? allSnippets : [],
      coverage: {
        eligibleFiles: source.eligibleFiles,
        analyzedFiles: source.files.length,
        skippedBinary: source.skippedBinary,
        skippedOversized: source.skippedOversized,
        omittedFiles: 0,
        omittedSymbols: 0,
        omittedRelations: 0,
        omittedSnippets: 0,
        unresolvedRelations: 0,
      },
    };
    const available = {
      files: selectedOrFallback.length,
      symbols: request.facets.includes("symbols") ? allSymbols.length : 0,
      relations: request.facets.includes("relations") ? relationFacts.length : 0,
      snippets: request.facets.includes("source") ? allSnippets.length : 0,
      changes: changes.length,
      testFiles: tests.files.length,
      testGaps: tests.changedSourceWithoutTest.length,
      unresolvedRelations,
    };
    while (refreshBudget(report, available) > request.maxOutputBytes) {
      if (report.snippets.length > 0) report.snippets.pop();
      else if (report.relations.length > 0) report.relations.pop();
      else if (report.symbols.length > 0) report.symbols.pop();
      else if (report.files.length > 0) report.files.pop();
      else if (report.tests.files.length > 0) report.tests.files.pop();
      else if (report.tests.changedSourceWithoutTest.length > 0)
        report.tests.changedSourceWithoutTest.pop();
      else if (report.changes.length > 0) report.changes.pop();
      else
        throw new ContextPatrolError(
          "BUDGET_TOO_SMALL",
          "requested output budget cannot hold the required report envelope",
          2,
        );
      report.budget.limited = true;
    }
    refreshBudget(report, available);
    verifySourceUnchanged(request, source.contentDigest);
    return finalize(report);
  } finally {
    store.close();
  }
}
