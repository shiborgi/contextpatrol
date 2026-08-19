import { compareBytewise } from "../hash.js";
import type { FileFact } from "../model.js";
import { isShimPath } from "../typescript-extractor.js";
import type { CodeGraph } from "./code-graph.js";
import type { Community } from "./communities.js";
import type { DeadCodeEntry } from "./dead-code.js";
import type { Surprise } from "./surprises.js";

export interface Question {
  text: string;
  nodeId: string;
}

export interface QuestionSignals {
  graph: CodeGraph;
  communities: Community[];
  godSymbols: Array<{ qualifiedName: string; score: number }>;
  surprises: Surprise[];
  deadCode: DeadCodeEntry[];
  fileFacts: FileFact[];
}

export function generateQuestions(signals: QuestionSignals): Question[] {
  const questions: Question[] = [];

  // 1. Hub
  const topHub = [...signals.godSymbols].sort(
    (a, b) => b.score - a.score || compareBytewise(a.qualifiedName, b.qualifiedName),
  )[0];
  if (topHub) {
    questions.push({
      text: `What depends on ${topHub.qualifiedName}?`,
      nodeId: `sym:${topHub.qualifiedName}`,
    });
  }

  // 2. Surprise
  const topSurprise = signals.surprises[0];
  if (topSurprise) {
    questions.push({
      text: `Why does ${topSurprise.from} connect to ${topSurprise.to}?`,
      nodeId: `sym:${topSurprise.from}`,
    });
  }

  // 3. Test gap
  const testedFiles = new Set<string>();
  for (const edge of signals.graph.edges) {
    if (edge.kind === "TESTED_BY" && edge.to.startsWith("file:")) {
      testedFiles.add(edge.to.slice(5));
    }
  }
  const gapFile = signals.fileFacts.find(
    (f) => f.symbols.length > 0 && !isShimPath(f.path) && !testedFiles.has(f.path),
  );
  if (gapFile) {
    questions.push({
      text: `What tests cover ${gapFile.path}?`,
      nodeId: `file:${gapFile.path}`,
    });
  }

  // 4. Dead code
  const dead = signals.deadCode[0];
  if (dead) {
    questions.push({
      text: `Is ${dead.qualifiedName} still needed?`,
      nodeId: `sym:${dead.qualifiedName}`,
    });
  }

  // 5. Community
  const largestCommunity = [...signals.communities].sort(
    (a, b) => b.memberCount - a.memberCount || compareBytewise(a.id, b.id),
  )[0];
  const hubMember = pickHubMember(signals.graph, largestCommunity);
  if (largestCommunity && hubMember) {
    questions.push({
      text: `What is the role of community ${largestCommunity.id}?`,
      nodeId: `sym:${hubMember}`,
    });
  }

  return questions;
}

/** The community member with the highest incoming CALLS count, ties broken
 * bytewise; never a deterministic-arbitrary members[0]. */
function pickHubMember(
  graph: CodeGraph,
  community: Community | undefined,
): string | null {
  if (!community) {
    return null;
  }
  const inDegree = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.kind === "CALLS" && edge.to.startsWith("sym:")) {
      const qname = edge.to.slice(4);
      inDegree.set(qname, (inDegree.get(qname) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestScore = -1;
  for (const member of community.members) {
    const score = inDegree.get(member) ?? 0;
    if (
      best === null ||
      score > bestScore ||
      (score === bestScore && compareBytewise(member, best) < 0)
    ) {
      best = member;
      bestScore = score;
    }
  }
  return best;
}
