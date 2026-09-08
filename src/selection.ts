import type { EffectiveQuery, QueryResponse, SelectedFile } from "./contracts.js";
import type { AnalysisGraph } from "./graph.js";
import { canonicalJson, compareText, digest } from "./json.js";
import type { Diagnostics, SourceFile } from "./source.js";

export function select(
  files: SourceFile[],
  graph: AnalysisGraph,
  request: EffectiveQuery,
  diagnostics: Diagnostics,
): SelectedFile[] {
  const terms = [
    ...new Set(request.task.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []),
  ].slice(0, 64);
  const impacted = new Set(graph.impacted);
  const degree = new Map<string, number>();
  const adjacent = new Set<string>();
  for (const edge of graph.edges) {
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    if (request.paths.includes(edge.from)) adjacent.add(edge.to);
  }
  const selected = files
    .map((file) => {
      let score = 0;
      const reasons: string[] = [];
      const reward = (points: number, reason: string) => {
        score += points;
        reasons.push(reason);
      };
      if (request.paths.includes(file.path)) reward(1000, "explicit seed");
      if (impacted.has(file.path))
        reward(
          request.profile === "review" ? 160 : 100,
          "reverse-transitive importer of seed",
        );
      if (adjacent.has(file.path)) reward(80, "local dependency of seed");
      const lowerPath = file.path.toLowerCase();
      const content = file.content.toLowerCase();
      const pathHits = terms.filter((term) => lowerPath.includes(term));
      const contentHits = terms.filter((term) => content.includes(term));
      if (pathHits.length)
        reward(
          pathHits.length * 20,
          `task path terms: ${pathHits.slice(0, 6).join(", ")}`,
        );
      if (contentHits.length)
        reward(
          contentHits.length * 3,
          `task content terms: ${contentHits.slice(0, 6).join(", ")}`,
        );
      const centrality = Math.min(degree.get(file.path) ?? 0, 20);
      if (centrality)
        reward(
          centrality * (request.profile === "architecture" ? 12 : 2),
          `imported by ${degree.get(file.path)} local files`,
        );
      const metadata =
        /(?:^|\/)(?:readme\.md|package\.json|pyproject\.toml|.*config\.[^/]+)$/i.test(
          file.path,
        );
      const test =
        /(?:^|\/)(?:tests?|__tests__)(?:\/|_)|(?:\.test|\.spec)\.|(?:^|\/)test_[^/]+\.py$/i.test(
          file.path,
        );
      if (request.profile === "overview" && metadata)
        reward(100, "overview: project metadata or documentation");
      if (
        request.profile === "architecture" &&
        /(?:^|\/)(?:index|main|app|server|routes?)\.[^/]+$/.test(file.path)
      )
        reward(60, "architecture: entry-point path heuristic");
      if (
        request.profile === "implementation" &&
        ["javascript", "typescript", "python"].includes(file.language) &&
        !test
      )
        reward(30, "implementation: source file");
      if (request.profile === "review" && test)
        reward(100, "review: test-path heuristic (not coverage)");
      if (!reasons.length) reasons.push("deterministic repository fallback");
      const result: SelectedFile = {
        path: file.path,
        language: file.language,
        score,
        reasons: [...reasons, ...(graph.evidence.get(file.path) ?? [])],
      };
      const length = {
        overview: 0,
        architecture: 320,
        implementation: 2400,
        review: 1200,
      }[request.profile];
      if (length) {
        const first =
          terms
            .map((term) => content.indexOf(term))
            .filter((index) => index >= 0)
            .sort((a, b) => a - b)[0] ?? 0;
        const start = Math.max(
          0,
          file.content.lastIndexOf("\n", Math.max(0, first - 160)) + 1,
        );
        result.excerpt = file.content.slice(start, start + length);
        if (start > 0 || start + length < file.content.length)
          diagnostics.add("Excerpts are partial task-centered source windows.", true);
      }
      return result;
    })
    .sort((a, b) => b.score - a.score || compareText(a.path, b.path));
  if (selected.length > request.budget.maxFiles)
    diagnostics.add("File selection truncated at budget.maxFiles.", true);
  return selected.slice(0, request.budget.maxFiles);
}

export function finalize(response: QueryResponse, maxBytes: number): QueryResponse {
  const marker =
    "Output budget truncated files, excerpts, graph, signals, or diagnostics.";
  const sign = (): number => {
    response.stats.selectedFiles = response.files.length;
    const { digest: _digest, ...payload } = response;
    response.digest = digest(payload);
    return Buffer.byteLength(canonicalJson(response)) + 1;
  };
  let size = sign();
  while (size > maxBytes) {
    response.stats.truncated = true;
    if (!response.diagnostics.includes(marker)) response.diagnostics.unshift(marker);
    let excess = size - maxBytes;
    // Remove measured tails in batches instead of reserializing once per edge.
    const trim = <T>(items: T[], minimum = 0): void => {
      while (items.length > minimum && excess > 0) {
        excess -= Buffer.byteLength(canonicalJson(items.pop())) + 1;
      }
    };
    if (response.diagnostics.length > 3) {
      trim(response.diagnostics, 3);
    } else if (response.files.some((file) => file.excerpt !== undefined)) {
      for (const file of [...response.files].reverse()) {
        if (excess <= 0) break;
        if (file.excerpt === undefined) continue;
        excess -= Buffer.byteLength(canonicalJson({ excerpt: file.excerpt })) - 1;
        delete file.excerpt;
      }
    } else if (response.graph.cycles.length) {
      trim(response.graph.cycles);
    } else if (response.graph.edges.length) {
      trim(response.graph.edges);
    } else if (response.files.length) {
      trim(response.files);
      const retained = new Set(response.files.map((file) => file.path));
      response.graph.nodes = response.graph.nodes.filter((node) => retained.has(node));
      response.graph.impacted = response.graph.impacted.filter((node) =>
        retained.has(node),
      );
    } else if (response.diagnostics.length > 1) {
      trim(response.diagnostics, 1);
    } else if (response.signals.length) {
      trim(response.signals);
    } else throw new Error("Cannot fit minimum response in output budget");
    size = sign();
  }
  return response;
}
