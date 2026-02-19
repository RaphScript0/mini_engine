import { describe, expect, it } from "vitest";
import { MinHeapTopKSelector } from "../minHeapTopK.js";

describe("MinHeapTopKSelector", () => {
  it("returns best K by comparator", () => {
    const sel = new MinHeapTopKSelector<number>();
    const out = sel.topK([5, 1, 3, 2, 4], 3, (a, b) => b - a); // descending
    expect(out).toEqual([5, 4, 3]);
  });
});
