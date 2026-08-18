import { compareBytewise } from "../hash.js";
import type { FileFact } from "../model.js";
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
    (f) => f.symbols.length > 0 && !testedFiles.has(f.path),
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
  const firstMember = largestCommunity?.members[0];
  if (largestCommunity && firstMember) {
    questions.push({
      text: `What is the role of community ${largestCommunity.id}?`,
      nodeId: `sym:${firstMember}`,
    });
  }

  return questions;
}
