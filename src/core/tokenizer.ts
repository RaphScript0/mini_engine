import type { Token } from "./types.js";

export interface TokenizeOptions {
  /** If true, normalize case (implementation-defined, usually lowercase). */
  normalizeCase?: boolean;
  /** If true, drop tokens that are common stop-words. */
  removeStopWords?: boolean;
}

/**
 * Turns text into a stream of tokens.
 *
 * Contract notes:
 * - should be deterministic for given input+options
 * - should avoid allocations where possible (iterators/generators ok)
 */
export interface Tokenizer {
  tokenize(text: string, options?: TokenizeOptions): Iterable<Token>;
}
