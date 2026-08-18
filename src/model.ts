export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "constructor"
  | "interface"
  | "type"
  | "enum"
  | "callable-variable";

export interface SymbolFact {
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  path: string;
  signature: string;
  jsdoc: string;
  source: string;
  range: { startLine: number; endLine: number };
  exported: boolean;
  confidence: number;
  isTest: boolean;
  heritage: { extends: string[]; implements: string[] };
}

export type ImportKind = "named" | "default" | "namespace" | "side-effect";

export interface ImportFact {
  kind: ImportKind;
  importedName: string | null;
  moduleSpecifier: string;
  range: { startLine: number; endLine: number };
}

export type ReceiverKind = "identifier" | "property" | "this" | "unresolved";

export interface CallFact {
  callerQualifiedName: string;
  calleeText: string;
  receiver: ReceiverKind;
  range: { startLine: number; endLine: number };
}

export type RationaleMarker = "WHY" | "NOTE" | "HACK" | "TODO" | "FIXME";

export interface RationaleFact {
  marker: RationaleMarker;
  symbolQualifiedName: string;
  text: string;
  range: { startLine: number; endLine: number };
}

export interface RouteFact {
  method: string;
  path: string;
  handlerName: string | null;
  range: { startLine: number; endLine: number };
}

export interface FileFact {
  path: string;
  language: "typescript" | "javascript" | "markdown" | "json" | "other";
  size: number;
  lines: number;
  digest: string;
  symbols: SymbolFact[];
  imports: ImportFact[];
  calls: CallFact[];
  rationale: RationaleFact[];
  routes: RouteFact[];
}
