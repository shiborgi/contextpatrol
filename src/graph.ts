import path from "node:path";
import type { EffectiveQuery, Graph } from "./contracts.js";
import { compareText } from "./json.js";
import type { Facts } from "./language.js";
import type { Diagnostics, SourceFile } from "./source.js";

export interface AnalysisGraph extends Graph {
  evidence: Map<string, string[]>;
}
export function buildGraph(
  files: SourceFile[],
  facts: Map<string, Facts>,
  request: EffectiveQuery,
  diagnostics: Diagnostics,
): AnalysisGraph {
  const nodes = files.map((file) => file.path);
  const available = new Set(nodes);
  const goModule = files
    .find((file) => file.path === "go.mod")
    ?.content.match(/^[ \t]*module[ \t]+(\S+)[ \t]*$/m)?.[1];
  const edgeKeys = new Set<string>();
  const edges: Graph["edges"] = [];
  const evidence = new Map<string, string[]>();
  const resolve = (candidates: string[]): string | undefined =>
    candidates.find((candidate) => available.has(candidate));
  const pyCandidates = (base: string) => [
    `${base}.py`,
    `${base}/__init__.py`,
    `${base}.pyi`,
  ];
  diagnostics.add(
    "Heuristic local resolution only: no aliases, package exports, Python runtime search path, call graph, or test coverage; require may be shadowed. Stack signals are hints.",
  );
  for (const file of files) {
    for (const fact of facts.get(file.path)?.imports ?? []) {
      const targets = new Set<string>();
      const spec = fact.specifier;
      if (file.language === "python") {
        const dots = spec.match(/^\.+/)?.[0].length ?? 0;
        const module = spec.slice(dots).replaceAll(".", "/");
        let bases: string[];
        if (dots) {
          const directory = path.posix.dirname(file.path);
          const base = path.posix.normalize(
            path.posix.join(directory, "../".repeat(dots - 1), module),
          );
          bases = base === ".." || base.startsWith("../") ? [] : [base];
        } else bases = [module, `src/${module}`];
        for (const base of bases) {
          const target = resolve(pyCandidates(base));
          if (target) targets.add(target);
          for (const member of fact.members ?? []) {
            const child = resolve(
              pyCandidates(path.posix.join(base, member.replaceAll(".", "/"))),
            );
            if (child) targets.add(child);
          }
          if (targets.size) break;
        }
      } else if (file.language === "go") {
        if (spec.startsWith("./") || spec.startsWith("../")) {
          const dir = path.posix.normalize(
            path.posix.join(path.posix.dirname(file.path), spec),
          );
          for (const node of nodes) {
            if (node.endsWith(".go") && path.posix.dirname(node) === dir) {
              targets.add(node);
            }
          }
        } else if (goModule && (spec === goModule || spec.startsWith(`${goModule}/`))) {
          const dir = spec === goModule ? "." : spec.slice(goModule.length + 1);
          for (const node of nodes) {
            if (node.endsWith(".go") && path.posix.dirname(node) === dir) {
              targets.add(node);
            }
          }
        }
      } else if (file.language === "rust") {
        if (spec.startsWith("mod:")) {
          const modName = spec.slice(4);
          const dir = path.posix.dirname(file.path);
          const candidates = [
            path.posix.join(dir, `${modName}.rs`),
            path.posix.join(dir, modName, "mod.rs"),
          ];
          const target = resolve(candidates);
          if (target) targets.add(target);
        } else if (spec.startsWith("crate::")) {
          const modPath = spec.slice(7).split("::")[0] ?? "";
          if (modPath) {
            const candidates = [
              `src/${modPath}.rs`,
              `src/${modPath}/mod.rs`,
              `${modPath}.rs`,
              `${modPath}/mod.rs`,
            ];
            const target = resolve(candidates);
            if (target) targets.add(target);
          }
        } else if (spec.startsWith("super::")) {
          const dir = path.posix.dirname(file.path);
          const modPath = spec.slice(7).split("::")[0] ?? "";
          if (modPath) {
            const candidates = [
              path.posix.join(dir, `${modPath}.rs`),
              path.posix.join(dir, modPath, "mod.rs"),
            ];
            const target = resolve(candidates);
            if (target) targets.add(target);
          }
        }
      } else if (spec.startsWith("./") || spec.startsWith("../")) {
        const base = path.posix.normalize(
          path.posix.join(path.posix.dirname(file.path), spec),
        );
        if (!base.startsWith("../") && base !== ".." && !spec.includes("\\")) {
          const extensions = [
            ".ts",
            ".tsx",
            ".mts",
            ".cts",
            ".js",
            ".jsx",
            ".mjs",
            ".cjs",
            ".json",
          ];
          const mapped = /\.[cm]?jsx?$/.test(base)
            ? [
                base.replace(/\.js$/, ".ts"),
                base.replace(/\.js$/, ".tsx"),
                base.replace(/\.jsx$/, ".tsx"),
                base.replace(/\.mjs$/, ".mts"),
                base.replace(/\.cjs$/, ".cts"),
              ]
            : [];
          const target = resolve([
            base,
            ...mapped,
            ...extensions.map((ext) => base + ext),
            ...extensions.map((ext) => `${base}/index${ext}`),
          ]);
          if (target) targets.add(target);
        }
      } else {
        diagnostics.add(
          `External or alias import not resolved: ${file.path}:${fact.line} (${spec.slice(0, 80)})`,
        );
        continue;
      }
      if (!targets.size)
        diagnostics.add(
          `Unresolved local/possible external import: ${file.path}:${fact.line} (${spec.slice(0, 80)})`,
        );
      for (const target of [...targets].sort(compareText)) {
        const key = `${file.path}\0${target}`;
        if (edgeKeys.has(key)) continue;
        if (edges.length >= 20000) {
          diagnostics.add("Graph edge limit reached (20000).", true);
          continue;
        }
        edgeKeys.add(key);
        edges.push({ from: file.path, to: target, kind: "imports" });
        const reasons = evidence.get(file.path) ?? [];
        if (reasons.length < 3)
          reasons.push(`literal import at line ${fact.line} resolves to ${target}`);
        evidence.set(file.path, reasons);
      }
    }
  }
  edges.sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to));
  const forward = new Map(nodes.map((node) => [node, [] as string[]]));
  const reverse = new Map(nodes.map((node) => [node, [] as string[]]));
  for (const edge of edges) {
    forward.get(edge.from)?.push(edge.to);
    reverse.get(edge.to)?.push(edge.from);
  }
  const reached = new Set(request.paths.filter((seed) => available.has(seed)));
  for (const seed of request.paths)
    if (!available.has(seed)) diagnostics.add(`Seed unavailable or excluded: ${seed}`);
  let frontier = [...reached];
  for (let depth = 0; depth < request.budget.maxDepth; depth++) {
    const next: string[] = [];
    for (const target of frontier)
      for (const importer of reverse.get(target) ?? [])
        if (!reached.has(importer)) {
          reached.add(importer);
          next.push(importer);
        }
    frontier = next;
    if (!frontier.length) break;
  }
  if (
    frontier.some((node) => reverse.get(node)?.some((parent) => !reached.has(parent)))
  )
    diagnostics.add("Reverse impact truncated at budget.maxDepth.", true);
  const impacted = [...reached]
    .filter((node) => !request.paths.includes(node))
    .sort(compareText);
  // Bounded DFS reports representative closed cycles, not every possible cycle.
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const active: string[] = [];
  const positions = new Map<string, number>();
  const visit = (node: string): void => {
    visited.add(node);
    positions.set(node, active.length);
    active.push(node);
    for (const target of forward.get(node) ?? []) {
      const index = positions.get(target);
      if (index !== undefined) {
        if (cycles.length < 100) cycles.push([...active.slice(index), target]);
        else diagnostics.add("Cycle count limit reached (100).", true);
      } else if (!visited.has(target)) {
        if (active.length < request.budget.maxDepth) visit(target);
        else diagnostics.add("Cycle traversal truncated at budget.maxDepth.", true);
      }
    }
    active.pop();
    positions.delete(node);
  };
  if (request.budget.maxDepth === 0) {
    if (edges.length)
      diagnostics.add("Cycle traversal truncated at budget.maxDepth.", true);
  } else for (const node of nodes) if (!visited.has(node)) visit(node);
  diagnostics.add(
    "Cycles are bounded DFS representatives; impact is reverse imports excluding seeds, not proof of runtime behavior.",
  );
  return { nodes, edges, cycles, impacted, evidence };
}
