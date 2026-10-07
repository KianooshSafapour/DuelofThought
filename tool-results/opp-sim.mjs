/** Simulated second player for matchmaking QA (Node + socket.io-client). */
import { io } from 'socket.io-client';
import { readFileSync } from 'fs';

const argToken = process.argv[2] ?? '';
let token = argToken;
if (!token) {
  const hdrs = readFileSync('/tmp/login-headers.txt', 'utf8');
  token = /doi_session=([^;\s]+)/.exec(hdrs)?.[1] ?? '';
}
if (!token) { console.error('NO TOKEN'); process.exit(1); }
console.log('token ok');

const sock = io('http://localhost:3003', {
  transports: ['polling', 'websocket'],
  extraHeaders: { cookie: `doi_session=${token}` },
  reconnectionAttempts: 5,
});

let mySide = 1;
let state = null;

const tryMove = () => {
  if (state && !state.finished && state.turn === mySide) {
    setTimeout(() => {
      if (state && !state.finished && state.turn === mySide) { console.log('move 5'); sock.emit('move', { col: 5 }); }
    }, 1200);
  }
};

sock.on('connect', () => { console.log('connected'); sock.emit('queue:join', { ranked: true }); });
sock.on('connect_error', (e) => console.log('connect_error:', e.message));
sock.on('match', (d) => {
  mySide = d.yourSide;
  console.log('MATCH side=', mySide, 'vs', d.opponent?.username);
  setTimeout(tryMove, 1500);
});
sock.on('state', (d) => { state = typeof d.state === 'string' ? JSON.parse(d.state) : d.state; tryMove(); });
sock.on('game:over', (d) => console.log('GAME OVER', JSON.stringify(d).slice(0, 100)));
sock.on('game:rewards', (d) => {
  console.log('REWARDS', JSON.stringify(d).slice(0, 150));
  setTimeout(() => { sock.disconnect(); process.exit(0); }, 600);
});
sock.on('error', (d) => console.log('SRV ERROR', JSON.stringify(d)));
setTimeout(() => { console.log('TIMEOUT'); process.exit(0); }, 60_000);
