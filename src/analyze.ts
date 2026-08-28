import { finalize, refreshBudget } from "./budget.js";
import { LIMITS, PROVIDER_NAME, PROVIDER_VERSION } from "./constants.js";
import { ContextPatrolError } from "./errors.js";
import { IndexStore } from "./index-store.js";
import { compareText, digest } from "./json.js";
import { parseFile } from "./parser.js";
import { queryTerms, score } from "./ranking.js";
import { resolveImport } from "./relations.js";
import { noopLogger, type RunContext } from "./run-context.js";
import { snippet } from "./snippets.js";
import { loadSource, verifySourceUnchanged } from "./source.js";
import { testSignals } from "./tests.js";
import type { CachedFacts, ContextReport, QueryRequest, SourceFile } from "./types.js";

interface IndexedFile {
  file: SourceFile;
  facts: CachedFacts;
  score: number;
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

export async function queryContext(
  request: QueryRequest,
  ctx?: RunContext,
): Promise<ContextReport> {
  const log = ctx?.log ?? noopLogger;
  log.debug("analysis started");
  const source = loadSource(request);
  const store = new IndexStore(source.root);
  try {
    const terms = queryTerms(request.query);
    const changedPaths = request.baseline
      ? new Set(source.changes.map((entry) => entry.path))
      : new Set<string>();
    const indexed: IndexedFile[] = [];
    for (const file of source.files) {
      const cached = store.get(file.hash);
      const facts = factsAtPath(cached ?? (await parseFile(file)), file);
      if (!cached) store.put(file.hash, facts);
      indexed.push({
        file,
        facts,
        score: score(file, facts, terms, changedPaths.has(file.path), request.ranking),
      });
    }
    const ranked = indexed.sort(
      (left, right) =>
        right.score - left.score || compareText(left.file.path, right.file.path),
    );
    const selectedOrFallback = ranked.slice(0, LIMITS.maxSelectedFiles);
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
      .map(({ file, facts }) => snippet(file, terms, request.sourceDepth, facts));
    const changes = request.facets.includes("changes") ? source.changes : [];
    const tests = request.facets.includes("tests")
      ? testSignals(source.files, source.changes)
      : { files: [], changedSourceWithoutTest: [] };
    const rankingHintsApplied =
      request.ranking !== undefined &&
      ((request.ranking.boostIdents?.length ?? 0) > 0 ||
        (request.ranking.boostPaths?.length ?? 0) > 0 ||
        (request.ranking.dampenPaths?.length ?? 0) > 0);
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
        ...(rankingHintsApplied ? { rankingHintsApplied: true } : {}),
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
      const unchangedFile = report.files.findLastIndex(
        (file) => !changedPaths.has(file.path),
      );
      if (report.snippets.length > 0) report.snippets.pop();
      else if (report.relations.length > 0) report.relations.pop();
      else if (report.symbols.length > 0) report.symbols.pop();
      else if (unchangedFile >= 0) report.files.splice(unchangedFile, 1);
      else if (report.tests.files.length > 0) report.tests.files.pop();
      else if (report.tests.changedSourceWithoutTest.length > 0)
        report.tests.changedSourceWithoutTest.pop();
      else if (report.changes.length > (source.changes.length > 0 ? 1 : 0))
        report.changes.pop();
      else if (report.files.length > 0 && source.changes.length === 0)
        report.files.pop();
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
