// Exit choice (Design, "Recompute policy"; Requirement 4.7).
// `costs[e]` is the field value of exit e at the agent's node (Infinity when unreachable), `known[e]` is 1 when the agent
// knows exit e, `current` is the exit now chosen (-1 for none). The first choice, with no current known exit, takes the
// smallest known cost with no margin. Afterwards the agent switches if and only if the best cost is lower than the
// current cost by more than `marginCells`. Ties go to the lowest exit index. Returns `current` when nothing is known or
// every known exit is unreachable.
export function chooseExit(current: number, costs: ArrayLike<number>, known: ArrayLike<number>, marginCells: number): number {
  let best = -1;
  let bestCost = Infinity;
  for (let e = 0; e < costs.length; e++) {
    if (known[e] !== 1) continue;
    const c = costs[e]!;
    if (c < bestCost) {
      bestCost = c;
      best = e;
    }
  }
  if (best < 0) return current; // nothing known, or nothing reachable
  if (current < 0 || current >= costs.length || known[current] !== 1) return best;
  return bestCost < costs[current]! - marginCells ? best : current;
}
