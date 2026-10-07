/** WebAudio procedural sound effects — no audio assets needed. */

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(v: boolean) { enabled = v; }

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.15, delay = 0, slide?: number) {
  const a = ac();
  if (!a || !enabled) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  drop() { tone(320, 0.12, 'triangle', 0.2, 0, 180); },
  capture() { tone(520, 0.15, 'sine', 0.18, 0, 640); tone(660, 0.1, 'sine', 0.1, 0.06); },
  bad() { tone(140, 0.2, 'sawtooth', 0.12, 0, 90); },
  win() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => tone(n, 0.22, 'triangle', 0.2, i * 0.11));
    tone(1319, 0.4, 'sine', 0.15, 0.44);
  },
  lose() { tone(330, 0.3, 'triangle', 0.15, 0, 180); tone(220, 0.45, 'triangle', 0.15, 0.18, 110); },
  coin() { tone(988, 0.08, 'square', 0.08); tone(1319, 0.18, 'square', 0.08, 0.08); },
  achievement() { [659, 831, 988, 1319].forEach((n, i) => tone(n, 0.2, 'sine', 0.16, i * 0.09)); },
  levelup() { [392, 523, 659, 784, 1047].forEach((n, i) => tone(n, 0.18, 'triangle', 0.18, i * 0.08)); },
  click() { tone(700, 0.05, 'sine', 0.07); },
  chat() { tone(880, 0.06, 'sine', 0.08, 0); tone(1175, 0.08, 'sine', 0.06, 0.05); },
  timeout() { tone(440, 0.15, 'square', 0.1); tone(440, 0.15, 'square', 0.1, 0.2); },
};

/* ---------------- procedural ambient music (opt-in, no assets) ----------------
 * Three hand-tuned procedural "moods", all pure WebAudio — nothing to download:
 *  night  — slow D-minor pad, breathing lowpass, random-walk pentatonic plucks
 *  desert — Hijaz-flavored drone with wind noise and sparse distant plucks
 *  battle — low drone with a soft frame-drum pulse and shimmering minor seconds */

export type MusicMood = 'night' | 'desert' | 'battle';
const MOOD_KEY = 'doi_music_mood';

let musicEnabled = false;
let musicMood: MusicMood = 'night';
let musicTimer: ReturnType<typeof setInterval> | null = null;
let musicPulseTimer: ReturnType<typeof setInterval> | null = null;
let musicMaster: GainNode | null = null;
let musicVoices: OscillatorNode[] = [];
let musicNodes: AudioScheduledSourceNode[] = []; // noise buffers etc.

/** Scales per mood (Hz). night: D-minor pentatonic-ish; desert: D Hijaz; battle: D-minor low. */
const SCALES: Record<MusicMood, number[]> = {
  night: [146.83, 174.61, 196.0, 220.0, 261.63, 293.66, 349.23],
  desert: [146.83, 155.56, 185.0, 196.0, 220.0, 233.08, 277.18],
  battle: [73.42, 87.31, 98.0, 110.0, 130.81, 146.83, 174.61],
};

/** Read persisted preferences (call once on app mount). */
export function initMusicPref(): boolean {
  try {
    musicEnabled = localStorage.getItem('doi_music') === '1';
    const m = localStorage.getItem(MOOD_KEY);
    if (m === 'night' || m === 'desert' || m === 'battle') musicMood = m;
  } catch { /* noop */ }
  return musicEnabled;
}

export function isMusicEnabled(): boolean {
  return musicEnabled;
}

export function getMusicMood(): MusicMood {
  return musicMood;
}

export function setMusicMood(m: MusicMood) {
  if (m === musicMood && musicEnabled) return;
  musicMood = m;
  try { localStorage.setItem(MOOD_KEY, m); } catch { /* noop */ }
  if (musicEnabled) startMusic(); // crossfade via stop+start
}

export function setMusicEnabled(v: boolean) {
  musicEnabled = v;
  try { localStorage.setItem('doi_music', v ? '1' : '0'); } catch { /* noop */ }
  if (v) startMusic(); else stopMusic();
}

/** Start music after the first user gesture (browsers block autoplay). */
export function resumeMusicIfEnabled() {
  if (musicEnabled && !musicTimer) startMusic();
}

function noiseBuffer(a: AudioContext, seconds = 2): AudioBuffer {
  const buf = a.createBuffer(1, a.sampleRate * seconds, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function startMusic() {
  const a = ac();
  if (!a) return;
  stopMusic();
  const mood = musicMood;
  musicMaster = a.createGain();
  musicMaster.gain.value = 0;
  musicMaster.connect(a.destination);
  const target = mood === 'battle' ? 0.085 : 0.07;
  musicMaster.gain.linearRampToValueAtTime(target, a.currentTime + 2.5);

  // shared echo bus (desert gets the longest tail)
  const delay = a.createDelay(2);
  delay.delayTime.value = mood === 'desert' ? 0.62 : mood === 'battle' ? 0.3 : 0.45;
  const fb = a.createGain();
  fb.gain.value = mood === 'desert' ? 0.42 : mood === 'battle' ? 0.25 : 0.35;
  delay.connect(fb).connect(delay);
  delay.connect(musicMaster);

  if (mood === 'night') {
    // drone: detuned triangle pair + soft fifth through a breathing lowpass
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 620;
    lp.Q.value = 0.6;
    lp.connect(musicMaster);
    for (const [f, vol] of [[73.42, 0.05], [73.9, 0.04], [110.0, 0.028]] as const) {
      const o = a.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = a.createGain();
      g.gain.value = vol;
      o.connect(g).connect(lp);
      o.start();
      musicVoices.push(o);
    }
    const lfo = a.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoG = a.createGain();
    lfoG.gain.value = 180;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();
    musicVoices.push(lfo);

    const scale = SCALES.night;
    let idx = 3;
    const pluck = () => {
      if (!musicEnabled || musicMood !== 'night') return;
      const aa = ac();
      if (!aa || !musicMaster) return;
      idx = Math.max(0, Math.min(scale.length - 1, idx + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2))));
      const o = aa.createOscillator();
      o.type = 'sine';
      o.frequency.value = scale[idx] * 2;
      const g = aa.createGain();
      const t0 = aa.currentTime;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.03, t0 + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3);
      o.connect(g);
      g.connect(musicMaster);
      g.connect(delay);
      o.start(t0);
      o.stop(t0 + 3.2);
    };
    pluck();
    musicTimer = setInterval(pluck, 2400);
  } else if (mood === 'desert') {
    // warm open-desert drone (soft saw through heavy lowpass) + slow wind
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 0.8;
    lp.connect(musicMaster);
    for (const [f, vol] of [[73.42, 0.045], [110.0, 0.03], [146.83, 0.02]] as const) {
      const o = a.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = a.createGain();
      g.gain.value = vol;
      o.connect(g).connect(lp);
      o.start();
      musicVoices.push(o);
    }
    // breathing filter = dune wind swell
    const lfo = a.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoG = a.createGain();
    lfoG.gain.value = 240;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();
    musicVoices.push(lfo);
    // airy noise bed
    const noise = a.createBufferSource();
    noise.buffer = noiseBuffer(a, 3);
    noise.loop = true;
    const nBp = a.createBiquadFilter();
    nBp.type = 'bandpass';
    nBp.frequency.value = 800;
    nBp.Q.value = 0.4;
    const nG = a.createGain();
    nG.gain.value = 0.012;
    noise.connect(nBp).connect(nG).connect(musicMaster);
    noise.start();
    musicNodes.push(noise);
    const nLfo = a.createOscillator();
    nLfo.frequency.value = 0.07;
    const nLfoG = a.createGain();
    nLfoG.gain.value = 0.008;
    nLfo.connect(nLfoG).connect(nG.gain);
    nLfo.start();
    musicVoices.push(nLfo);

    // sparse Hijaz plucks, far away
    const scale = SCALES.desert;
    let idx = 4;
    const pluck = () => {
      if (!musicEnabled || musicMood !== 'desert') return;
      const aa = ac();
      if (!aa || !musicMaster) return;
      idx = Math.max(0, Math.min(scale.length - 1, idx + (Math.random() < 0.6 ? -1 : 1) * (1 + Math.floor(Math.random() * 2))));
      const o = aa.createOscillator();
      o.type = 'triangle';
      o.frequency.value = scale[idx] * 2;
      const g = aa.createGain();
      const t0 = aa.currentTime;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.045 + Math.random() * 0.02, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
      o.connect(g);
      g.connect(musicMaster);
      g.connect(delay);
      o.start(t0);
      o.stop(t0 + 2.6);
    };
    pluck();
    musicTimer = setInterval(pluck, 3400);
  } else {
    // battle: low minor drone + frame-drum heartbeat + shimmering minor 2nd
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    lp.connect(musicMaster);
    for (const [f, vol] of [[36.71, 0.06], [73.42, 0.045]] as const) {
      const o = a.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = a.createGain();
      g.gain.value = vol;
      o.connect(g).connect(lp);
      o.start();
      musicVoices.push(o);
    }
    // minor-second shimmer (two very close high sines beating)
    for (const f of [587.33, 622.25]) {
      const o = a.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = a.createGain();
      g.gain.value = 0.006;
      o.connect(g).connect(musicMaster);
      o.start();
      musicVoices.push(o);
    }
    // frame-drum pulse: dum . tak . dum dum tak pattern via filtered thumps
    const scale = SCALES.battle;
    const stepMs = 340;
    let step = 0;
    const pulse = () => {
      if (!musicEnabled || musicMood !== 'battle') return;
      const aa = ac();
      if (!aa || !musicMaster) return;
      const pattern = [2, 0, 1, 0, 2, 2, 1, 1]; // 2=deep dum, 1=tak, 0=rest
      const hit = pattern[step % pattern.length];
      step++;
      if (hit === 0) return;
      const t0 = aa.currentTime;
      const o = aa.createOscillator();
      o.type = 'sine';
      const base = hit === 2 ? 82 : 190;
      o.frequency.setValueAtTime(base, t0);
      o.frequency.exponentialRampToValueAtTime(base * 0.55, t0 + 0.12);
      const g = aa.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(hit === 2 ? 0.11 : 0.05, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (hit === 2 ? 0.3 : 0.14));
      o.connect(g).connect(musicMaster);
      o.start(t0);
      o.stop(t0 + 0.35);
      // occasional low voice under the dum
      if (hit === 2 && Math.random() < 0.3) {
        const oo = aa.createOscillator();
        oo.type = 'triangle';
        oo.frequency.value = scale[2 + Math.floor(Math.random() * 2)];
        const gg = aa.createGain();
        gg.gain.setValueAtTime(0, t0);
        gg.gain.linearRampToValueAtTime(0.03, t0 + 0.4);
        gg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
        oo.connect(gg).connect(delay);
        oo.start(t0);
        oo.stop(t0 + 1.8);
      }
    };
    musicPulseTimer = setInterval(pulse, stepMs);
  }
}

function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  if (musicPulseTimer) { clearInterval(musicPulseTimer); musicPulseTimer = null; }
  if (musicMaster && ctx) {
    musicMaster.gain.cancelScheduledValues(ctx.currentTime);
    musicMaster.gain.setValueAtTime(musicMaster.gain.value, ctx.currentTime);
    musicMaster.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
  }
  const voices = musicVoices;
  musicVoices = [];
  const nodes = musicNodes;
  musicNodes = [];
  setTimeout(() => {
    for (const o of voices) { try { o.stop(); } catch { /* noop */ } }
    for (const n of nodes) { try { n.stop(); } catch { /* noop */ } }
  }, 1000);
  musicMaster = null;
}
