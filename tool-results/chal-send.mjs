import { io } from 'socket.io-client';
import { readFileSync } from 'fs';
const token = process.argv[2];
const sock = io('http://localhost:3003', { transports: ['polling'], extraHeaders: { cookie: `doi_session=${token}` } });
sock.on('connect', () => {
  console.log('connected');
  sock.emit('presence:hello');
  setTimeout(() => sock.emit('challenge:send', { toUserId: 'cmtxgeqsu000fn98567wlnojm' }), 800);
});
sock.on('challenge:sent', (d) => { console.log('sent', JSON.stringify(d)); setTimeout(()=>process.exit(0), 25000); });
sock.on('challenge:cancelled', () => { console.log('cancelled-by-target'); process.exit(0); });
sock.on('error', (d) => { console.log('ERR', JSON.stringify(d)); process.exit(1); });
setTimeout(() => process.exit(0), 32000);
