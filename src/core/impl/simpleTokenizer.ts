import type { Token } from "../types.js";
import type { TokenizeOptions, Tokenizer } from "../tokenizer.js";

const DEFAULT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "if",
  "in",
  "into",
  "is",
  "it",
  "no",
  "not",
  "of",
  "on",
  "or",
  "such",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "will",
  "with",
]);

function isAlphaNum(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

/**
 * Fast ASCII-ish tokenizer:
 * - splits on non-alphanum
 * - optionally lowercases
 * - optionally removes stop words
 * - yields token positions (token index)
 */
export class SimpleTokenizer implements Tokenizer {
  private readonly stopWords: Set<string>;

  constructor(stopWords: Set<string> = DEFAULT_STOP_WORDS) {
    this.stopWords = stopWords;
  }

  *tokenize(text: string, options?: TokenizeOptions): Iterable<Token> {
    const normalizeCase = options?.normalizeCase ?? true;
    const removeStopWords = options?.removeStopWords ?? false;

    const n = text.length;
    let i = 0;
    let position = 0;

    while (i < n) {
      // skip separators
      while (i < n && !isAlphaNum(text.charCodeAt(i))) i++;
      if (i >= n) break;

      const start = i;
      while (i < n && isAlphaNum(text.charCodeAt(i))) i++;
      const end = i;

      let term = text.slice(start, end);
      if (normalizeCase) term = term.toLowerCase();

      if (!removeStopWords || !this.stopWords.has(term)) {
        yield { term, position, startOffset: start, endOffset: end };
      }

      position++;
    }
  }
}
