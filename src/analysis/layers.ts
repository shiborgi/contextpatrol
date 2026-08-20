import { compareBytewise } from "../hash.js";

export interface Layer {
  id: string;
  name: string;
  nodeIds: string[];
}

interface LayerLabel {
  id: string;
  name: string;
}

// WORK-7.2.1: deterministic, ordered first-match path patterns. The first rule
// whose matcher fires wins, so the table order is part of the contract and
// must stay stable. Rule order matters (e.g. test/ before docs so a hypothetical
// test/*.md stays in test; entry basenames only under src/ or root).
const RULES: Array<{ matcher: (path: string) => boolean; label: LayerLabel }> = [
  {
    matcher: (p) =>
      /^(test|tests|__tests__|spec|specs)\//.test(p) || /\.(test|spec)\./.test(p),
    label: { id: "layer:test", name: "Test" },
  },
  {
    matcher: (p) => /^(docs|documentation)\//.test(p) || /\.(md|mdx)$/i.test(p),
    label: { id: "layer:docs", name: "Docs" },
  },
  {
    matcher: (p) => {
      const top = p.split("/")[0];
      if (top === "bin" || top === "cli" || top === "cmd") {
        return true;
      }
      const base = p.split("/").pop() ?? p;
      const inSrc = p.startsWith("src/") || !p.includes("/");
      return (
        /^(cli|index|main|app|server)\.(ts|js|tsx|jsx|mts|cts)$/i.test(base) && inSrc
      );
    },
    label: { id: "layer:entry", name: "Entry" },
  },
  {
    matcher: (p) => /^(pipeline|wave|workflow)\//.test(p),
    label: { id: "layer:workflow", name: "Workflow" },
  },
  {
    matcher: (p) => /^(graph|analysis)\//.test(p),
    label: { id: "layer:analysis", name: "Analysis" },
  },
  {
    matcher: (p) =>
      /^(infra|git)\//.test(p) || p.split("/").pop()?.startsWith("git") === true,
    label: { id: "layer:infra", name: "Infra" },
  },
];

const FALLBACK: LayerLabel = { id: "layer:other", name: "Other" };

export function layerLabelOf(path: string): LayerLabel {
  for (const rule of RULES) {
    if (rule.matcher(path)) {
      return rule.label;
    }
  }
  return FALLBACK;
}

export function assignLayers(filePaths: readonly string[]): Layer[] {
  const byId = new Map<string, { label: LayerLabel; nodeIds: string[] }>();

  for (const path of filePaths) {
    const label = layerLabelOf(path);
    const group = byId.get(label.id) ?? { label, nodeIds: [] };
    group.nodeIds.push(`file:${path}`);
    byId.set(label.id, group);
  }

  return [...byId.values()]
    .map(({ label, nodeIds }) => ({
      id: label.id,
      name: label.name,
      nodeIds: [...nodeIds].sort(compareBytewise),
    }))
    .sort((a, b) => compareBytewise(a.id, b.id));
}
