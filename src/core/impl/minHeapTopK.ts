import type { Heap, TopKSelector } from "../heap.js";

class ArrayHeap<T> implements Heap<T> {
  private readonly data: T[] = [];

  constructor(private readonly less: (a: T, b: T) => boolean) {}

  size(): number {
    return this.data.length;
  }

  peek(): T | undefined {
    return this.data[0];
  }

  push(item: T): void {
    const a = this.data;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i]!, a[p]!)) break;
      [a[i]!, a[p]!] = [a[p]!, a[i]!];
      i = p;
    }
  }

  pop(): T | undefined {
    const a = this.data;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  toArray(): T[] {
    return Array.from(this.data);
  }

  private siftDown(i: number): void {
    const a = this.data;
    const n = a.length;

    while (true) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;

      if (l < n && this.less(a[l]!, a[smallest]!)) smallest = l;
      if (r < n && this.less(a[r]!, a[smallest]!)) smallest = r;
      if (smallest === i) return;

      [a[i]!, a[smallest]!] = [a[smallest]!, a[i]!];
      i = smallest;
    }
  }
}

/**
 * Keeps a fixed-size min-heap of the best K items.
 *
 * Comparator uses Array.sort semantics (a before b if <0). We treat "best" as comparator descending,
 * so the heap tracks the *worst of the best* at the top.
 */
export class MinHeapTopKSelector<T> implements TopKSelector<T> {
  topK(items: Iterable<T>, k: number, comparator: (a: T, b: T) => number): T[] {
    if (k <= 0) return [];

    // less(a,b) means a is WORSE than b (for min-heap of worst items)
    const heap = new ArrayHeap<T>((a, b) => comparator(a, b) > 0);

    for (const item of items) {
      if (heap.size() < k) {
        heap.push(item);
        continue;
      }
      const worst = heap.peek()!;
      // if item is better than worst => replace
      if (comparator(item, worst) < 0) {
        heap.pop();
        heap.push(item);
      }
    }

    const arr = heap.toArray();
    arr.sort(comparator);
    return arr;
  }
}
