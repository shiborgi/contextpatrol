import { PROTOCOL_VERSION, parseQuery, type QueryResponse } from "./contracts.js";
import { buildGraph } from "./graph.js";
import { compareText } from "./json.js";
import { extract, type Facts } from "./language.js";
import { finalize, select } from "./selection.js";
import { Diagnostics, loadSource } from "./source.js";

export async function query(input: unknown): Promise<QueryResponse> {
  const request = parseQuery(input);
  const diagnostics = new Diagnostics();
  const { files, snapshot } = loadSource(request.root, diagnostics);
  const facts = new Map<string, Facts>();
  const signals = new Set<string>();
  for (const file of files) {
    const extracted = await extract(file, diagnostics);
    facts.set(file.path, extracted);
    for (const signal of extracted.signals) signals.add(signal);
  }
  const graph = buildGraph(files, facts, request, diagnostics);
  const selected = select(files, graph, request, diagnostics);
  const selectedPaths = new Set(selected.map((file) => file.path));
  const edges = graph.edges.filter(
    (edge) => selectedPaths.has(edge.from) && selectedPaths.has(edge.to),
  );
  const cycles = graph.cycles.filter((cycle) =>
    cycle.every((node) => selectedPaths.has(node)),
  );
  if (
    graph.nodes.length > selected.length ||
    edges.length < graph.edges.length ||
    cycles.length < graph.cycles.length
  )
    diagnostics.add(
      "Output graph restricted to selected files; omitted dependencies and cycles are not evidence of absence.",
      true,
    );
  return finalize(
    {
      protocolVersion: PROTOCOL_VERSION,
      profile: request.profile,
      snapshot,
      signals: [...signals].sort(compareText),
      files: selected,
      graph: {
        nodes: [...selectedPaths].sort(compareText),
        edges,
        cycles,
        impacted: graph.impacted.filter((node) => selectedPaths.has(node)),
      },
      diagnostics: diagnostics.list(),
      stats: {
        scannedFiles: files.length,
        selectedFiles: selected.length,
        truncated: diagnostics.truncated,
      },
      digest: "",
    },
    request.budget.maxBytes,
  );
}
