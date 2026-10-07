/**
 * Boulder Yard (سنگ‌چین) — campaign level data. Modernized homage to
 * Bulldozer (The Code Zone, 2000) — task T9-e.
 *
 * ASCII legend: '#' wall · '.' floor · 'B' boulder · 'T' target pad ·
 * 'P' player start · '*' boulder sitting on a target · ' ' void (outside).
 *
 * Every one of the 24 levels is machine-verified solvable by
 * tool-results/boulder-solver.mjs (push-optimal BFS with player-region
 * dedup + dead-square pruning). `par` = the solver's optimal push count,
 * re-asserted on every solver run.
 *
 * Campaign: 3 yards (آیین‌گاه) × 8 levels, sequential unlock.
 */

export interface BoulderLevelDef {
  /** Solver-verified optimal push count (par == optimum). */
  par: number;
  /** Rectangular ASCII map; all rows same length. */
  ascii: string[];
}

export const YARD_SIZE = 8;

export const LEVELS: BoulderLevelDef[] = [
  /* ----------------------- Yard 1 — آیین‌گاهِ آغاز ----------------------- */
  // 1 — first push: walk around, push the boulder onto the pad.
  { par: 2, ascii: [
    '#########',
    '#.......#',
    '#.B.T.P.#',
    '#.......#',
    '#########',
  ] },
  // 2 — two boulders, push down then sideways.
  { par: 4, ascii: [
    '#########',
    '#...#...#',
    '#.B...B.#',
    '#..T.T..#',
    '#...P...#',
    '#########',
  ] },
  // 3 — a wall forces a turn.
  { par: 3, ascii: [
    '##########',
    '#........#',
    '#..B.....#',
    '#..#.T...#',
    '#..P.....#',
    '##########',
  ] },
  // 4 — three boulders, same routine.
  { par: 6, ascii: [
    '##########',
    '#........#',
    '#.B.B.B..#',
    '#........#',
    '#.T.T.T..#',
    '#........#',
    '#...P....#',
    '##########',
  ] },
  // 5 — two chambers, walk the corridor between pushes.
  { par: 4, ascii: [
    '##########',
    '#....#...#',
    '#.B..#.B.#',
    '#....#...#',
    '#.T..#.T.#',
    '#..P.....#',
    '##########',
  ] },
  // 6 — reposition first, then finish the push.
  { par: 4, ascii: [
    '#########',
    '#.......#',
    '#..B....#',
    '#.##....#',
    '#..#.T..#',
    '#..P....#',
    '#########',
  ] },
  // 7 — long rows: slide each boulder along its lane.
  { par: 8, ascii: [
    '##########',
    '#........#',
    '#.B....T.#',
    '#.B..T...#',
    '#........#',
    '#...P....#',
    '##########',
  ] },
  // 8 — yard finale: four boulders, four pads.
  { par: 4, ascii: [
    '###########',
    '#....#....#',
    '#.B..#.B..#',
    '#.T..#.T..#',
    '#.........#',
    '#..B...B..#',
    '#..T...T..#',
    '#....P....#',
    '###########',
  ] },

  /* ---------------------- Yard 2 — آیین‌گاهِ پیچاپیچ ---------------------- */
  // 9 — staggered pads: every boulder needs its own turn plan.
  { par: 10, ascii: [
    '##########',
    '#........#',
    '#.B......#',
    '#.B...T..#',
    '#.B.T....#',
    '#..T.....#',
    '#..P.....#',
    '##########',
  ] },
  // 10 — three chambers of different shapes.
  { par: 5, ascii: [
    '##########',
    '#...#....#',
    '#.B.#..B.#',
    '#...#....#',
    '#.T.#..T.#',
    '#...#.P..#',
    '#..B.....#',
    '#..T.....#',
    '##########',
  ] },
  // 11 — the straight path wedges the boulder; find the safe lane.
  { par: 5, ascii: [
    '##########',
    '#....#...#',
    '#.B..#...#',
    '#....#...#',
    '#..###...#',
    '#..#.....#',
    '#..T..P..#',
    '#........#',
    '##########',
  ] },
  // 12 — around the pillar: down, across, up.
  { par: 6, ascii: [
    '##########',
    '#........#',
    '#...##...#',
    '#.B.....T#',
    '#...##...#',
    '#........#',
    '#...P....#',
    '##########',
  ] },
  // 13 — four boulders, tight ordering around the ledge.
  { par: 12, ascii: [
    '###########',
    '#....T....#',
    '#.B.B..T..#',
    '#.....###.#',
    '#.B.B.T...#',
    '#...T.....#',
    '#....P....#',
    '###########',
  ] },
  // 14 — centre pads: push down, then sideways.
  { par: 10, ascii: ['###########','#....#....#','#.B..#..B.#','#....#....#','#...T#.T..#','#.B..#..B.#','#..T.#..T.#','#....P....#','###########'] },
  // 15 — push the middle boulder out FIRST or the row jams.
  { par: 9, ascii: [
    '##########',
    '#........#',
    '#.BBB....#',
    '#........#',
    '#.T.T.T..#',
    '#........#',
    '#..P.....#',
    '##########',
  ] },
  // 16 — yard finale: order around the central block.
  { par: 12, ascii: ['##########','#........#','#.B.B.B.T#','#..###...#','#..#.#...#','#..#.#...#','#.T...T..#','#....P...#','##########'] },

  /* ----------------------- Yard 3 — آیین‌گاهِ ژرفا ----------------------- */
  // 17 — four corners.
  { par: 8, ascii: [
    '###########',
    '#.T.....T.#',
    '#..B...B..#',
    '#....#....#',
    '#..B...B..#',
    '#.T.....T.#',
    '#....P....#',
    '###########',
  ] },
  // 18 — pairs: split each pair before pushing down.
  { par: 15, ascii: [
    '###########',
    '#.........#',
    '#.BB....B.#',
    '#.......B.#',
    '#.........#',
    '#.T..T.T.T#',
    '#....P....#',
    '###########',
  ] },
  // 19 — five boulders in a staggered field.
  { par: 7, ascii: ['###########','#....#....#','#.B..#..B.#','#..T.#.T..#','#....#....#','#.B..#..B.#','#..T.P..T.#','###########'] },
  // 20 — the vault: one boulder sealed behind a one-cell door.
  { par: 6, ascii: ['##########','#....#...#','#.B..#.B.#','#..T.#.T.#','#.B..#.B.#','#..T.P.T.#','##########'] },
  // 21 — a stacked column: dismantle it bottom-up, in order.
  { par: 11, ascii: ['###########','#.........#','#..B.B..B.#','#..#.#....#','#..T.T..T.#','#..B......#','#..T.P....#','###########'] },
  // 22 — four rooms, one crossing.
  { par: 10, ascii: ['##########','#P.......#','#.B.B..B.#','#..#.#...#','#..T.T.T.#','#....#...#','#.B......#','#..T.....#','##########'] },
  // 23 — five boulders, five pads, no excuses.
  { par: 8, ascii: ['###########','#....#....#','#.B..#..B.#','#....#....#','#..T.#.T..#','#..B....B.#','#..T.P..T.#','###########'] },
  // 24 — the crown: six boulders around the twin towers.
  { par: 10, ascii: ['###########','#....#....#','#.B..#..B.#','#....#....#','#..T.#.T..#','#....#....#','#.B..P..B.#','#..T.#.T..#','###########'] },
];
