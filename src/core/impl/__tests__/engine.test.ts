import { describe, expect, it } from "vitest";
import {
  MemoryInvertedIndex,
  MemorySearchEngine,
  MemoryTrie,
  MinHeapTopKSelector,
  SimpleTokenizer,
  TfIdfRanker,
} from "../../index.js";

describe("MemorySearchEngine", () => {
  it("indexes docs and returns tf-idf ranked hits", () => {
    const engine = new MemorySearchEngine({
      tokenizer: new SimpleTokenizer(),
      index: new MemoryInvertedIndex(),
      trie: new MemoryTrie(),
      ranker: new TfIdfRanker(),
      topK: new MinHeapTopKSelector(),
    });

    engine.upsertDocuments([
      { id: "d1", text: "hello world world" },
      { id: "d2", text: "hello there" },
      { id: "d3", text: "unrelated" },
    ]);

    const res = engine.search("hello world", { limit: 10, enablePrefix: false });
    expect(res.hits.map((h) => h.docId)).toEqual(["d1", "d2"]);
    expect(res.hits[0]!.score).toBeGreaterThan(res.hits[1]!.score);
  });

  it("supports prefix completion contributing to results", () => {
    const engine = new MemorySearchEngine({
      tokenizer: new SimpleTokenizer(),
      index: new MemoryInvertedIndex(),
      trie: new MemoryTrie(),
      ranker: new TfIdfRanker(),
      topK: new MinHeapTopKSelector(),
    });

    engine.upsertDocuments([
      { id: "d1", text: "typescript" },
      { id: "d2", text: "type theory" },
      { id: "d3", text: "python" },
    ]);

    // prefix "typ" should complete to "type" and "typescript"
    const res = engine.search("typ", { limit: 10, enablePrefix: true, prefixLimit: 10 });
    expect(res.hits.map((h) => h.docId)).toContain("d1");
    expect(res.hits.map((h) => h.docId)).toContain("d2");
  });

  it("supports cursor pagination", () => {
    const engine = new MemorySearchEngine({
      tokenizer: new SimpleTokenizer(),
      index: new MemoryInvertedIndex(),
      trie: new MemoryTrie(),
      ranker: new TfIdfRanker(),
      topK: new MinHeapTopKSelector(),
    });

    engine.upsertDocuments([
      { id: "a", text: "cat" },
      { id: "b", text: "cat cat" },
      { id: "c", text: "cat cat cat" },
    ]);

    const page1 = engine.search("cat", { limit: 2, enablePrefix: false });
    expect(page1.hits).toHaveLength(2);
    expect(page1.nextCursor).toBeTypeOf("string");

    const page2 = engine.search("cat", { limit: 2, enablePrefix: false, cursor: page1.nextCursor });
    expect(page2.hits.map((h) => h.docId)).not.toEqual(page1.hits.map((h) => h.docId));
  });
});
