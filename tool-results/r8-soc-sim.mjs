/** R8 QA: register two sims, befriend admin, then duel each other (in-duel presence test). */
const BASE = 'http://127.0.0.1:3000';

async function register(name) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password: 'SimPass123!', locale: 'en' }),
  });
  const j = res.status === 409 ? await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password: 'SimPass123!' }),
  }).then((r) => r.json()) : await res.json();
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  return { id: j.user?.id, cookie };
}

const adminToken = process.argv[2];
if (!adminToken) { console.error('usage: node r8-soc-sim.mjs <adminSessionToken>'); process.exit(1); }
const adminH = { 'Content-Type': 'application/json', cookie: `doi_session=${adminToken}` };

const a = await register('sim_r8');
const b = await register('sim_r9');
console.log('registered', a.id, b.id);

// mutual add → auto-accept friendship with admin
for (const s of [a, b]) {
  await fetch(`${BASE}/api/friends`, { method: 'POST', headers: adminH, body: JSON.stringify({ action: 'add', username: 'x' }) }).catch(() => {});
}
await fetch(`${BASE}/api/friends`, { method: 'POST', headers: adminH, body: JSON.stringify({ action: 'add', username: 'sim_r8' }) });
await fetch(`${BASE}/api/friends`, { method: 'POST', headers: adminH, body: JSON.stringify({ action: 'add', username: 'sim_r9' }) });
await fetch(`${BASE}/api/friends`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: a.cookie }, body: JSON.stringify({ action: 'add', username: 'admin' }) });
await fetch(`${BASE}/api/friends`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: b.cookie }, body: JSON.stringify({ action: 'add', username: 'admin' }) });

const fr = await fetch(`${BASE}/api/friends`, { headers: { cookie: adminH.cookie } }).then((r) => r.json());
console.log('admin friends:', fr.friends.map((f) => `${f.username}(online=${f.online},dueling=${f.dueling},queuing=${f.queuing})`));

// keep process alive briefly for the script to be inspected
setTimeout(() => {
  console.log('COOKIES', JSON.stringify({ a: a.cookie, b: b.cookie }));
  process.exit(0);
}, 1500);
