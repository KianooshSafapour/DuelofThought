/**
 * Engine ground-truth verification (QA): replays every solver-produced
 * solution through the REAL shipped engine (src/lib/game/boulder-engine.ts).
 */
import { readFileSync } from 'fs';
import { createGame, step } from '../src/lib/game/boulder-engine';
import { LEVELS as L1 } from '../src/lib/game/boulder-levels';
import { LEVELS as L2 } from '../src/lib/game/boulder2-levels';

function verify(label: string, levels: typeof L1, sols: { i: number; par: number; optimal: number; seq: string | null }[]): boolean {
  let ok = true;
  for (const s of sols) {
    const def = levels[s.i - 1];
    if (!s.seq) { console.log(`${label} L${s.i}: NO SEQUENCE ✗`); ok = false; continue; }
    let g = createGame(def, s.i - 1);
    let pushes = 0;
    for (const mv of s.seq) {
      const r = step(g, mv as 'U' | 'D' | 'L' | 'R');
      if (!r.moved && !r.pushed) {
        console.log(`${label} L${s.i}: STUCK at move ${mv} (step index) — par ${s.par} ✗`);
        ok = false;
        break;
      }
      g = r.state;
      pushes = g.pushes;
    }
    if (g.solved) {
      const parMatch = pushes === s.par ? 'par ✓' : `par MISMATCH (${pushes} vs ${s.par}) ✗`;
      if (pushes !== s.par) ok = false;
      console.log(`${label} L${s.i}: solved in ${pushes} pushes · ${parMatch}`);
    } else if (ok) {
      console.log(`${label} L${s.i}: sequence ended NOT solved ✗`);
      ok = false;
    }
  }
  return ok;
}

const s1 = JSON.parse(readFileSync('/home/z/my-project/tool-results/solutions1.json', 'utf8'));
const s2 = JSON.parse(readFileSync('/home/z/my-project/tool-results/solutions2.json', 'utf8'));
const a = verify('BY1', L1, s1);
const b = verify('BY2', L2, s2);
console.log(a && b ? '\nENGINE GROUND TRUTH: ALL 48 LEVELS BEATABLE ✓' : '\nENGINE VERIFICATION FAILURES ✗');
process.exit(a && b ? 0 : 1);
