/** R7 friend-challenge QA: sim_r7 connects for presence, waits for a challenge, accepts it, then plays. */
import { io } from 'socket.io-client';
import { readFileSync } from 'fs';

const jar = readFileSync('/tmp/sim7.jar', 'utf8');
const token = /doi_session\t?([^;\s]+)/.exec(jar.replace(/\t/g, '\t'))?.[1] ?? /doi_session[=\s]+([^;\s]+)/.exec(jar)?.[1] ?? '';
if (!token) { console.error('NO TOKEN'); process.exit(1); }
console.log('token ok');

const sock = io('http://localhost:3003', {
  transports: ['polling', 'websocket'],
  extraHeaders: { cookie: `doi_session=${token}` },
  reconnectionAttempts: 5,
});

let mySide = 1;
let state = null;
let acceptTimer = null;

const tryMove = () => {
  if (state && !state.finished && state.turn === mySide) {
    setTimeout(() => {
      if (state && !state.finished && state.turn === mySide) {
        // pick a random legal-ish column for variety
        const col = Math.floor(Math.random() * 9);
        console.log('move', col);
        sock.emit('move', { col });
      }
    }, 1500);
  }
};

sock.on('connect', () => { console.log('connected (presence)'); sock.emit('presence:hello'); });
sock.on('connect_error', (e) => console.log('connect_error:', e.message));

sock.on('challenge:incoming', (d) => {
  console.log('CHALLENGE from', d.from?.username, 'id', d.id);
  clearTimeout(acceptTimer);
  acceptTimer = setTimeout(() => { console.log('accepting challenge'); sock.emit('challenge:accept', { id: d.id }); }, 2000);
});
sock.on('challenge:sent', (d) => console.log('challenge:sent', JSON.stringify(d)));
sock.on('challenge:declined', () => console.log('challenge:declined'));
sock.on('challenge:cancelled', () => console.log('challenge:cancelled'));
sock.on('challenge:expired', () => console.log('challenge:expired'));

sock.on('match', (d) => {
  mySide = d.yourSide;
  console.log('MATCH side=', mySide, 'vs', d.opponent?.username);
  setTimeout(tryMove, 2000);
});
sock.on('state', (d) => { state = typeof d.state === 'string' ? JSON.parse(d.state) : d.state; tryMove(); });
sock.on('game:rewards', (d) => console.log('REWARDS', JSON.stringify(d).slice(0, 120)));
sock.on('opponent:left', () => console.log('opponent:left'));
sock.on('error', (d) => console.log('ERROR', JSON.stringify(d)));
sock.on('disconnect', (r) => console.log('disconnect', r));

setTimeout(() => { console.log('sim done'); process.exit(0); }, 300_000);
