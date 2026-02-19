/**
 * Minimal heap contract used for topK selection.
 * Intended for a fixed-size min-heap to keep best K items.
 */
export interface Heap<T> {
  size(): number;
  peek(): T | undefined;
  push(item: T): void;
  pop(): T | undefined;
  /** Converts heap contents to array (order implementation-defined). */
  toArray(): T[];
}

export interface TopKSelector<T> {
  /**
   * Returns top K items by comparator.
   * Comparator should behave like Array.sort: <0 means a before b.
   */
  topK(items: Iterable<T>, k: number, comparator: (a: T, b: T) => number): T[];
}
