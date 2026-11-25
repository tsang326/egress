// Spatial hash and density (Design, "Spatial hash and density"; Requirements 2.4 to 2.6).
// A uniform grid per floor with buckets of DENSITY_RADIUS_M, rebuilt every step by a counting sort. Only the buckets that
// held agents in the previous step are cleared. Agents that are Out or inside a stair channel are not in the hash;
// incapacitated agents stay in it and count towards density.
import { CELL_SIZE_M, DENSITY_RADIUS_M } from '../constants';
import { STATE_INCAPACITATED, STATE_MOVING, STATE_PRE_MOVE } from '../agents/state';
import type { AgentStore, Plan } from '../types';
export class SpatialHash {
  private readonly bw: Int32Array; // buckets across, per floor
  private readonly bh: Int32Array; // buckets down, per floor
  private readonly base: Int32Array; // first bucket index of each floor
  private readonly count: Int32Array; // agents per bucket (0 for every bucket not touched in the last rebuild)
  private readonly start: Int32Array; // first item slot of a touched bucket
  private readonly fill: Int32Array;
  private readonly items: Int32Array;
  private readonly touched: Int32Array;
  private nTouched = 0;
  private readonly bucketOf: Int32Array; // per agent, -1 when the agent is not in the hash
  private readonly floorOf: Uint8Array;
  private readonly bucketM: number;
  constructor(plan: Plan, nAgents: number, bucketM: number = DENSITY_RADIUS_M) {
    this.bucketM = bucketM;
    const nf = plan.floors.length;
    this.bw = new Int32Array(nf);
    this.bh = new Int32Array(nf);
    this.base = new Int32Array(nf);
    let total = 0;
    plan.floors.forEach((f, i) => {
      this.bw[i] = Math.max(1, Math.ceil((f.widthCells * CELL_SIZE_M) / bucketM));
      this.bh[i] = Math.max(1, Math.ceil((f.heightCells * CELL_SIZE_M) / bucketM));
      this.base[i] = total;
      total += this.bw[i]! * this.bh[i]!;
    });
    this.count = new Int32Array(total);
    this.start = new Int32Array(total);
    this.fill = new Int32Array(total);
    this.items = new Int32Array(Math.max(1, nAgents));
    this.touched = new Int32Array(Math.max(1, Math.min(total, nAgents)));
    this.bucketOf = new Int32Array(Math.max(1, nAgents)).fill(-1);
    this.floorOf = new Uint8Array(Math.max(1, nAgents));
  }
  private bucketIndex(f: number, x: number, y: number): number {
    const bx = Math.min(this.bw[f]! - 1, Math.max(0, Math.floor(x / this.bucketM)));
    const by = Math.min(this.bh[f]! - 1, Math.max(0, Math.floor(y / this.bucketM)));
    return this.base[f]! + by * this.bw[f]! + bx;
  }
  // Puts every agent that is pre-movement, moving or incapacitated into its bucket, in agent index order.
  rebuild(a: AgentStore): void {
    for (let k = 0; k < this.nTouched; k++) this.count[this.touched[k]!] = 0;
    this.nTouched = 0;
    for (let i = 0; i < a.n; i++) {
      const s = a.state[i]!;
      if (s !== STATE_PRE_MOVE && s !== STATE_MOVING && s !== STATE_INCAPACITATED) {
        this.bucketOf[i] = -1;
        continue;
      }
      const f = a.floor[i]!;
      const b = this.bucketIndex(f, a.x[i]!, a.y[i]!);
      this.bucketOf[i] = b;
      this.floorOf[i] = f;
      if (this.count[b] === 0) this.touched[this.nTouched++] = b;
      this.count[b]!++;
    }
    let off = 0;
    for (let k = 0; k < this.nTouched; k++) {
      const b = this.touched[k]!;
      this.start[b] = off;
      this.fill[b] = 0;
      off += this.count[b]!;
    }
    for (let i = 0; i < a.n; i++) {
      const b = this.bucketOf[i]!;
      if (b >= 0) this.items[this.start[b]! + this.fill[b]!++] = i;
    }
  }
  // Writes into `out` the ids of the other agents on the same floor whose centre is within `radiusM` of agent i, taking
  // positions from `xs` and `ys`, in bucket order (3 x 3 buckets, row by row) then agent index. Returns how many.
  // The bucket of agent i is the one it had at the last rebuild, so `radiusM` must stay below one bucket minus the
  // distance agents move in a step.
  neighbours(i: number, radiusM: number, xs: Float64Array, ys: Float64Array, out: Int32Array): number {
    const b = this.bucketOf[i]!;
    if (b < 0) return 0;
    const f = this.floorOf[i]!;
    const local = b - this.base[f]!;
    const w = this.bw[f]!;
    const bx = local % w;
    const by = (local - bx) / w;
    const r2 = radiusM * radiusM;
    const xi = xs[i]!;
    const yi = ys[i]!;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = by + dy;
      if (ny < 0 || ny >= this.bh[f]!) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = bx + dx;
        if (nx < 0 || nx >= w) continue;
        const nb = this.base[f]! + ny * w + nx;
        const cnt = this.count[nb]!;
        if (cnt === 0) continue;
        const s = this.start[nb]!;
        for (let k = 0; k < cnt; k++) {
          const j = this.items[s + k]!;
          if (j === i) continue;
          const ddx = xs[j]! - xi;
          const ddy = ys[j]! - yi;
          if (ddx * ddx + ddy * ddy <= r2) out[n++] = j;
        }
      }
    }
    return n;
  }
  // Number of other agents within `radiusM` of agent i (same positions as `neighbours`).
  countWithin(i: number, radiusM: number, xs: Float64Array, ys: Float64Array): number {
    const b = this.bucketOf[i]!;
    if (b < 0) return 0;
    const f = this.floorOf[i]!;
    const local = b - this.base[f]!;
    const w = this.bw[f]!;
    const bx = local % w;
    const by = (local - bx) / w;
    const r2 = radiusM * radiusM;
    const xi = xs[i]!;
    const yi = ys[i]!;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = by + dy;
      if (ny < 0 || ny >= this.bh[f]!) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = bx + dx;
        if (nx < 0 || nx >= w) continue;
        const nb = this.base[f]! + ny * w + nx;
        const cnt = this.count[nb]!;
        const s = this.start[nb]!;
        for (let k = 0; k < cnt; k++) {
          const j = this.items[s + k]!;
          if (j === i) continue;
          const ddx = xs[j]! - xi;
          const ddy = ys[j]! - yi;
          if (ddx * ddx + ddy * ddy <= r2) n++;
        }
      }
    }
    return n;
  }
  // D = neighbours / (pi r^2), persons/m2. 0 for an agent with no neighbour (Requirement 2.5).
  density(a: AgentStore, i: number): number {
    const n = this.countWithin(i, DENSITY_RADIUS_M, a.x, a.y);
    return n === 0 ? 0 : n / (Math.PI * DENSITY_RADIUS_M * DENSITY_RADIUS_M);
  }
}
