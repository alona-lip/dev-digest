/**
 * Code-index ports for repo-intel — what the indexer needs from a parser and a
 * token counter, independent of the tool behind them (ast-grep, js-tiktoken).
 * Implementations live in `server/src/adapters/{astgrep,tokenizer}`; the
 * container wires them and tests may swap them (ContainerOverrides).
 *
 * The constants are here, not in repo-intel, because both sides need them:
 * the parser adapter and the import-graph adapter filter by the same
 * extensions the indexer walks.
 */

/** Source extensions the code parser understands (repo-intel walk + import graph). */
export const SUPPORTED_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** Signatures are trimmed to this many chars in the parse phase (cache stability). */
export const MAX_SIGNATURE_CHARS = 120;

/** A declared symbol (regex extractor row shape). */
export interface ExtractedSymbol {
  name: string;
  kind: string;
  line: number;
}

/** A reference to a symbol (regex extractor row shape). */
export interface ExtractedReference {
  toSymbol: string;
  line: number;
}

/** AST-accurate symbol — a superset of ExtractedSymbol. */
export interface ParsedSymbol extends ExtractedSymbol {
  /** True when the declaration is reached through an `export` form. */
  exported: boolean;
  /** Declaration head trimmed to MAX_SIGNATURE_CHARS; null for kinds without one. */
  signature: string | null;
  /** 1-based line of the closing token of the declaration body. */
  endLine: number;
}

export interface ParsedReference extends ExtractedReference {
  /** Path passed in by the caller — surfaced so consumers can fan-out. */
  refFile: string;
}

export interface ParsedImport {
  name: string;
  source: string;
  isType: boolean;
}

export interface ParsedInvocationHead {
  /** The bare identifier being invoked (callee name, ctor name, or JSX tag). */
  name: string;
  /** 1-based line of the invocation. */
  line: number;
  /** Which AST shape produced this head. */
  kind: 'call' | 'new' | 'jsx';
}

/**
 * In-memory source parser (no I/O). Every method is a plain function — safe to
 * destructure — and returns `[]` / `null` for a file it can't parse.
 */
export interface CodeParser {
  /** The grammar for a path, or null when the extension isn't supported. */
  langForFile(file: string): string | null;
  parseSymbols(file: string, source: string): ParsedSymbol[];
  parseReferences(file: string, source: string): ParsedReference[];
  parseImports(file: string, source: string): ParsedImport[];
  parseInvocationHeads(file: string, source: string): ParsedInvocationHead[];
}

/** Token counter for the repo-map budget search. Must never throw. */
export interface Tokenizer {
  count(text: string): number;
}
