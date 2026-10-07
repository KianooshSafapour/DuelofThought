import { MISSIONS, hitsBody } from '../src/lib/game/orbit-missions.ts';
// pod placement sanity: no pod inside a body, no pod inside the capture ring (trivial), all within board
for (const m of MISSIONS) {
  m.pods.forEach((p, i) => {
    if (hitsBody(p.x, p.y, m.bodies, -2)) console.log(`WARN ${m.id} pod#${i} inside a body`);
    if (Math.hypot(p.x - m.target.x, p.y - m.target.y) < m.target.r) console.log(`WARN ${m.id} pod#${i} inside capture ring`);
    if (p.x < 0 || p.x > 1600 || p.y < 0 || p.y > 1200) console.log(`WARN ${m.id} pod#${i} outside board`);
  });
}
console.log('pod sanity done');
// start sanity: start not inside a body / target not inside a body
for (const m of MISSIONS) {
  if (hitsBody(m.start.x, m.start.y, m.bodies, 12)) console.log(`WARN ${m.id} start inside body`);
  if (hitsBody(m.target.x, m.target.y, m.bodies, 4)) console.log(`WARN ${m.id} target inside body`);
}
console.log('body sanity done');
