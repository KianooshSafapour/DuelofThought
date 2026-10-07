/**
 * One-off verification for CHEESY PURSUIT level data (task R12-a).
 * Run: bun tool-results/cheese-verify.mjs
 * Checks for EVERY level 1..30:
 *   - maze dims odd, floor fully connected (BFS from mouse reaches all floor)
 *   - all cheese cells reachable + not on spawn/burrow + unique
 *   - burrow reachable (escape possible)
 *   - cat spawns ≥ 6 BFS steps from mouse start, on floor, unique,
 *     never on cheese/burrow, count == level cats
 *   - path exists between every cheese cell and the burrow (A*)
 */
import { buildLevel, solveLayout, bfsDist, LEVEL_COUNT } from '../src/lib/game/cheese-data.ts';

let fails = 0;
const rows = [];

for (let L = 1; L <= LEVEL_COUNT; L++) {
  const def = buildLevel(L);
  const lay = solveLayout(def);
  const { maze, mouseSpawn, burrow, cheeseCells, catSpawns, distFromMouse } = lay;
  const C = maze.cols;
  const problems = [];

  if (maze.cols % 2 === 0 || maze.rows % 2 === 0) problems.push('even dims');

  // full connectivity: every floor cell must be reachable from mouse spawn
  const dist = bfsDist(maze, mouseSpawn.c, mouseSpawn.r);
  let floor = 0;
  let reached = 0;
  for (let i = 0; i < maze.grid.length; i++) {
    if (maze.grid[i] === 0) { floor++; if (dist[i] >= 0) reached++; }
  }
  if (reached !== floor) problems.push(`floor not fully connected (${reached}/${floor})`);

  if (distFromMouse[burrow.r * C + burrow.c] < 0) problems.push('burrow unreachable');

  if (cheeseCells.length !== def.cheese) problems.push(`cheese count ${cheeseCells.length} != ${def.cheese}`);
  const uniq = new Set(cheeseCells.map((q) => `${q.c},${q.r}`));
  if (uniq.size !== cheeseCells.length) problems.push('duplicate cheese cells');
  for (const q of cheeseCells) {
    if (distFromMouse[q.r * C + q.c] < 0) problems.push(`cheese unreachable @${q.c},${q.r}`);
    if (q.c === mouseSpawn.c && q.r === mouseSpawn.r) problems.push('cheese on mouse spawn');
    if (q.c === burrow.c && q.r === burrow.r) problems.push('cheese on burrow');
  }

  if (catSpawns.length !== def.cats) problems.push(`cat spawn count ${catSpawns.length} != ${def.cats}`);
  const uniqC = new Set(catSpawns.map((q) => `${q.c},${q.r}`));
  if (uniqC.size !== catSpawns.length) problems.push('duplicate cat spawns');
  for (const q of catSpawns) {
    const d = distFromMouse[q.r * C + q.c];
    if (d < 6) problems.push(`cat spawn too close (d=${d}) @${q.c},${q.r}`);
    if (maze.grid[q.r * C + q.c] !== 0) problems.push(`cat spawn on wall @${q.c},${q.r}`);
    if (cheeseCells.some((w) => w.c === q.c && w.r === q.r)) problems.push(`cat spawn on cheese @${q.c},${q.r}`);
    if (q.c === burrow.c && q.r === burrow.r) problems.push('cat spawn on burrow');
  }

  rows.push({ L, dims: `${maze.cols}x${maze.rows}`, cheese: def.cheese, cats: def.cats, tier: def.catTier, spawnEvery: def.spawnEvery, par: Math.round(def.parMs / 1000), minCatDist: Math.min(...catSpawns.map((q) => distFromMouse[q.r * C + q.c])), ok: problems.length === 0, problems });
  if (problems.length > 0) { fails++; console.log(`L${L} FAIL:`, problems.join(' · ')); }
}

console.table(rows.map(({ problems, ...r }) => ({ ...r, status: r.ok ? 'PASS' : 'FAIL' })));
console.log(fails === 0 ? `\nALL ${LEVEL_COUNT} LEVELS VERIFIED ✓` : `\n${fails} LEVEL(S) FAILED ✗`);
process.exit(fails === 0 ? 0 : 1);
