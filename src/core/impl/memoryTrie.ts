import type { Term } from "../types.js";
import type { Trie, TrieInsertOptions, TriePrefixResult } from "../trie.js";

type Node = {
  children: Map<string, Node>;
  terminal: boolean;
  weight: number;
};

function makeNode(): Node {
  return { children: new Map(), terminal: false, weight: 0 };
}

export class MemoryTrie implements Trie {
  private readonly root: Node = makeNode();

  insert(term: Term, opts?: TrieInsertOptions): void {
    let cur = this.root;
    for (let i = 0; i < term.length; i++) {
      const ch = term[i]!;
      let next = cur.children.get(ch);
      if (!next) {
        next = makeNode();
        cur.children.set(ch, next);
      }
      cur = next;
    }

    cur.terminal = true;
    if (opts?.trackFrequency) cur.weight++;
  }

  remove(term: Term): void {
    // simple lazy-unset; cleanup not strictly needed for core correctness
    let cur: Node | undefined = this.root;
    for (let i = 0; i < term.length; i++) {
      cur = cur.children.get(term[i]!);
      if (!cur) return;
    }
    cur.terminal = false;
    cur.weight = 0;
  }

  has(term: Term): boolean {
    let cur: Node | undefined = this.root;
    for (let i = 0; i < term.length; i++) {
      cur = cur.children.get(term[i]!);
      if (!cur) return false;
    }
    return cur.terminal;
  }

  complete(prefix: string, limit: number = 10): TriePrefixResult[] {
    let cur: Node | undefined = this.root;
    for (let i = 0; i < prefix.length; i++) {
      cur = cur.children.get(prefix[i]!);
      if (!cur) return [];
    }

    const out: TriePrefixResult[] = [];
    const stack: Array<{ node: Node; suffix: string }> = [{ node: cur, suffix: "" }];

    while (stack.length && out.length < limit) {
      const { node, suffix } = stack.pop()!;
      if (node.terminal) out.push({ term: prefix + suffix, weight: node.weight || undefined });

      // push children in reverse lexicographic so pop() yields lexicographic-ish
      const keys = Array.from(node.children.keys()).sort().reverse();
      for (const ch of keys) {
        stack.push({ node: node.children.get(ch)!, suffix: suffix + ch });
      }
    }

    // if weights exist, prefer higher weight but keep stable-ish output
    out.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || (a.term < b.term ? -1 : 1));
    return out.slice(0, limit);
  }
}
