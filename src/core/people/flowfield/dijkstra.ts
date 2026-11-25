// Binary-heap Dijkstra on the multi-floor graph (Design, Flow_Field "Dijkstra implementation").
// The heap is two typed arrays ordered by (cost, node index) with lazy deletion, so ties break the same way in every run.
import type { ExitField } from '../types';
import { edgeCost, neighbours, type Graph } from './costs';

class MinHeap {
  keys = new Float64Array(1024);
  vals = new Int32Array(1024);
  size = 0;
  private less(i: number, j: number): boolean {
    return this.keys[i]! < this.keys[j]! || (this.keys[i] === this.keys[j] && this.vals[i]! < this.vals[j]!);
  }
  private swap(i: number, j: number): void {
    const k = this.keys[i]!;
    this.keys[i] = this.keys[j]!;
    this.keys[j] = k;
    const v = this.vals[i]!;
    this.vals[i] = this.vals[j]!;
    this.vals[j] = v;
  }
  push(key: number, val: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      k.set(this.keys);
      this.keys = k;
      const v = new Int32Array(this.size * 2);
      v.set(this.vals);
      this.vals = v;
    }
    let i = this.size++;
    this.keys[i] = key;
    this.vals[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  // Removes the minimum; read it from `topKey` and `topVal` first.
  pop(): void {
    this.size--;
    if (this.size === 0) return;
    this.keys[0] = this.keys[this.size]!;
    this.vals[0] = this.vals[this.size]!;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.size && this.less(l, m)) m = l;
      if (r < this.size && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
  }
}

export interface DijkstraStats {
  settled: number;
}

// Cost to go to the exit group `seeds` (nodes, cost 0) for the node weights `w` (Infinity removes a node).
// `next[v]` is the neighbour of v that gives cost[v], taking the first one in the fixed visiting order when several
// give exactly the same cost; -1 at seeds and at nodes with no route.
export function computeField(g: Graph, w: Float64Array, seeds: Int32Array, exitIndex: number, stats?: DijkstraStats): ExitField {
  const cost = new Float64Array(g.nodeCount).fill(Infinity);
  const next = new Int32Array(g.nodeCount).fill(-1);
  const done = new Uint8Array(g.nodeCount);
  const heap = new MinHeap();
  const to = new Int32Array(g.maxDegree);
  const base = new Float64Array(g.maxDegree);
  const link = new Uint8Array(g.maxDegree);
  for (const s of seeds) {
    if (w[s] === Infinity || cost[s] === 0) continue;
    cost[s] = 0;
    heap.push(0, s);
  }
  let settled = 0;
  while (heap.size > 0) {
    const key = heap.keys[0]!;
    const u = heap.vals[0]!;
    heap.pop();
    if (done[u] === 1 || key > cost[u]!) continue;
    done[u] = 1;
    settled++;
    const n = neighbours(g, w, u, to, base, link);
    for (let i = 0; i < n; i++) {
      const v = to[i]!;
      if (done[v] === 1) continue;
      const cand = cost[u]! + edgeCost(g, w, u, v, base[i]!, link[i] === 1);
      if (cand < cost[v]!) {
        cost[v] = cand;
        heap.push(cand, v);
      }
    }
  }
  // Second pass: the first neighbour in visiting order that attains the final cost (strictly smaller replaces).
  for (let v = 0; v < g.nodeCount; v++) {
    if (done[v] === 0 || cost[v] === 0) continue;
    const n = neighbours(g, w, v, to, base, link);
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const u = to[i]!;
      if (done[u] === 0) continue;
      const cand = cost[u]! + edgeCost(g, w, u, v, base[i]!, link[i] === 1);
      if (cand < best) {
        best = cand;
        next[v] = u;
      }
    }
  }
  if (stats) stats.settled += settled;
  return { exitIndex, cost, next };
}
