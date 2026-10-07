'use client';

/**
 * CelebrationSprite — the victory-dance stage. Every CELEBRATION pack owns one
 * funny character (blob / robot / pigeon / camel / mummy / cactus / rocket /
 * jellyfish / dragon / phoenix) rendered as pure CSS/DOM + framer-motion —
 * no binary art assets.
 *
 * Graphics quality scales with the pack's rarity tier:
 *   COMMON    → single shape + simple bounce/pivot loop
 *   RARE      → stepped 2-pose dance + floor shadow + accessory (disco ball)
 *   EPIC      → multi-part character (head/body/limbs) + gradient stage + music notes
 *   LEGENDARY → + spotlight sweep + confetti particles + trail effects
 *   ULTIMATE  → full scene: backup dancers, fireworks, laser sweep, cannons
 *
 * API: <CelebrationSprite code={user.celebrationPack} dancing size={96} />
 * dancing=false renders the static rest pose (perf mode / cheap previews).
 */

import { motion, type TargetAndTransition, type Transition } from 'framer-motion';
import type { CSSProperties } from 'react';
import { RARITY_META, STORE_ITEMS, type Rarity } from '@/lib/game/content';

const TIER: Record<Rarity, number> = { COMMON: 0, RARE: 1, EPIC: 2, LEGENDARY: 3, ULTIMATE: 4 };

function rarityOf(code: string): Rarity {
  return STORE_ITEMS.find((i) => i.code === code && i.category === 'CELEBRATION')?.rarity ?? 'COMMON';
}

type Kf = Record<string, (number | string)[]>;

/** keyframe loop while dancing; rest pose (first keyframe) when static */
function lp(
  dancing: boolean,
  kf: Kf,
  dur: number,
  ease: Transition['ease'] = 'easeInOut',
): { animate: TargetAndTransition; transition: Transition } {
  if (!dancing) {
    const rest: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(kf)) rest[k] = v[0];
    return { animate: rest as TargetAndTransition, transition: { duration: 0 } };
  }
  return { animate: kf as TargetAndTransition, transition: { duration: dur, repeat: Infinity, ease } };
}

/** absolute-position helper in scaled units (bottom-anchored like a stage) */
function abs(l: number, b: number, w: number, h: number, extra?: CSSProperties): CSSProperties {
  return { position: 'absolute', left: l, bottom: b, width: w, height: h, ...extra };
}

interface CharProps {
  d: boolean; // dancing
  u: number; // size/100 — one "stage percent" in px
  tier: number;
}

/* ============================== characters ============================== */

/** celeb_confetti — «کانفتی خوشحال» a happy gradient blob bouncing + confetti dots (COMMON) */
function ChBlob({ d, u }: CharProps) {
  return (
    <>
      <motion.div {...lp(d, { y: [0, -12 * u, 0], scaleY: [1, 0.86, 1.1, 1] }, 0.62)} style={abs(31 * u, 18 * u, 38 * u, 34 * u)}>
        <div
          style={{
            width: '100%', height: '100%', borderRadius: '48% 52% 46% 54% / 60% 60% 42% 42%',
            background: 'linear-gradient(160deg,#fde68a 10%,#f59e0b 70%,#d97706)',
            boxShadow: `inset ${-2 * u}px ${-3 * u}px 0 rgba(146,64,14,.35), 0 ${2 * u}px ${4 * u}px rgba(0,0,0,.35)`,
          }}
        >
          {/* eyes + smile */}
          <span style={{ position: 'absolute', top: 9 * u, left: 8 * u, width: 6 * u, height: 6 * u, background: '#fff', borderRadius: '50%' }} />
          <span style={{ position: 'absolute', top: 9 * u, right: 8 * u, width: 6 * u, height: 6 * u, background: '#fff', borderRadius: '50%' }} />
          <span style={{ position: 'absolute', top: 11.5 * u, left: 9.5 * u, width: 3 * u, height: 3 * u, background: '#1c1917', borderRadius: '50%' }} />
          <span style={{ position: 'absolute', top: 11.5 * u, right: 9.5 * u, width: 3 * u, height: 3 * u, background: '#1c1917', borderRadius: '50%' }} />
          <span style={{ position: 'absolute', top: 19 * u, left: '50%', marginLeft: -4 * u, width: 8 * u, height: 3.4 * u, background: '#7c2d12', borderRadius: 3 * u }} />
        </div>
      </motion.div>
      {/* confetti dots */}
      {Array.from({ length: 7 }).map((_, i) => (
        <motion.span
          key={i}
          {...lp(d, { y: [0, -(6 + (i % 3)) * u, 0], rotate: [0, 180 + i * 40] }, 0.9 + (i % 4) * 0.17, 'linear')}
          style={abs((12 + i * 11) * u, (44 + (i % 3) * 12) * u, 3.4 * u, 2 * u, {
            background: ['#f472b6', '#34d399', '#60a5fa', '#fbbf24', '#c084fc', '#f87171', '#5eead4'][i],
            borderRadius: 1 * u,
          })}
        />
      ))}
    </>
  );
}

/** celeb_robo — «ربات راکتی» square robot doing the robot dance with pivoting arms (COMMON) */
function ChRobot({ d, u }: CharProps) {
  const arm = (side: 1 | -1): CSSProperties => ({
    position: 'absolute', bottom: 30 * u, left: side === 1 ? 20 * u : undefined, right: side === -1 ? 20 * u : undefined,
    width: 5 * u, height: 15 * u, borderRadius: 2 * u, transformOrigin: 'top center',
    background: 'linear-gradient(180deg,#e2e8f0,#94a3b8)',
  });
  return (
    <motion.div {...lp(d, { rotate: [-7, 7], y: [0, -4 * u, 0] }, 0.66)} style={abs(0, 0, 100 * u, 100 * u)}>
      {/* arms pivot around shoulders */}
      <motion.div {...lp(d, { rotate: [0, 52, 0] }, 0.66, 'linear')} style={arm(1)} />
      <motion.div {...lp(d, { rotate: [52, 0, 52] }, 0.66, 'linear')} style={arm(-1)} />
      {/* head */}
      <motion.div {...lp(d, { rotate: [6, -6] }, 0.66)} style={abs(36 * u, 56 * u, 28 * u, 22 * u, { background: 'linear-gradient(180deg,#f1f5f9,#cbd5e1)', borderRadius: 4 * u, border: `${1.4 * u}px solid #64748b` })}>
        <span style={{ position: 'absolute', top: 6 * u, left: 5 * u, width: 6 * u, height: 6 * u, background: '#22d3ee', borderRadius: 2 * u, boxShadow: `0 0 ${4 * u}px #22d3ee` }} />
        <span style={{ position: 'absolute', top: 6 * u, right: 5 * u, width: 6 * u, height: 6 * u, background: '#22d3ee', borderRadius: 2 * u, boxShadow: `0 0 ${4 * u}px #22d3ee` }} />
        <span style={{ position: 'absolute', bottom: 3 * u, left: '30%', width: '40%', height: 2.4 * u, background: '#475569', borderRadius: 2 * u }} />
        {/* antenna */}
        <span style={{ position: 'absolute', top: -7 * u, left: '46%', width: 2 * u, height: 7 * u, background: '#64748b' }} />
        <span style={{ position: 'absolute', top: -11 * u, left: '40%', width: 6 * u, height: 6 * u, background: '#f43f5e', borderRadius: '50%' }} />
      </motion.div>
      {/* body */}
      <div style={abs(34 * u, 26 * u, 32 * u, 30 * u, { background: 'linear-gradient(180deg,#cbd5e1,#94a3b8)', borderRadius: 3 * u, border: `${1.4 * u}px solid #64748b` })}>
        <span style={{ position: 'absolute', top: 6 * u, left: '50%', marginLeft: -5 * u, width: 10 * u, height: 8 * u, background: '#0f172a', borderRadius: 2 * u, boxShadow: `inset 0 0 ${3 * u}px #22d3ee` }} />
        <span style={{ position: 'absolute', bottom: 3 * u, left: 4 * u, width: 24 * u, height: 2 * u, background: '#64748b', borderRadius: 1 * u }} />
      </div>
      {/* legs + feet */}
      <div style={abs(40 * u, 12 * u, 7 * u, 15 * u, { background: '#64748b', borderRadius: 2 * u })} />
      <div style={abs(53 * u, 12 * u, 7 * u, 15 * u, { background: '#64748b', borderRadius: 2 * u })} />
      <div style={abs(37 * u, 8 * u, 13 * u, 5 * u, { background: '#334155', borderRadius: 2 * u })} />
      <div style={abs(50 * u, 8 * u, 13 * u, 5 * u, { background: '#334155', borderRadius: 2 * u })} />
    </motion.div>
  );
}

/** celeb_pigeon — «کبوتر بریک» breakdance head-spin + fast wing flaps (RARE, 2-pose steps + floor shadow) */
function ChPigeon({ d, u }: CharProps) {
  return (
    <>
      <motion.div
        {...lp(d, { rotate: [0, 180, 360] }, 1.5)}
        style={abs(24 * u, 18 * u, 52 * u, 52 * u, { transformOrigin: '50% 62%' })}
      >
        {/* body */}
        <div style={abs(10 * u, 6 * u, 32 * u, 24 * u, { background: 'linear-gradient(180deg,#e5e7eb,#9ca3af)', borderRadius: '55% 45% 50% 50% / 60% 60% 40% 40%' })}>
          {/* head + beak + eye */}
          <div style={{ position: 'absolute', top: -9 * u, left: 6 * u, width: 13 * u, height: 13 * u, background: '#f3f4f6', borderRadius: '50%', border: `${0.8 * u}px solid #9ca3af` }}>
            <span style={{ position: 'absolute', top: 4 * u, left: 3 * u, width: 3 * u, height: 3 * u, background: '#111827', borderRadius: '50%' }} />
            <span style={{ position: 'absolute', top: 4.5 * u, right: -4.5 * u, width: 0, height: 0, borderTop: `${2.6 * u}px solid transparent`, borderBottom: `${2.6 * u}px solid transparent`, borderLeft: `${5 * u}px solid #f59e0b` }} />
          </div>
          {/* wing — flaps fast while spinning */}
          <motion.div {...lp(d, { rotate: [0, -46], scaleY: [1, 0.55] }, 0.24, 'linear')} style={{ position: 'absolute', top: 3 * u, left: 4 * u, width: 18 * u, height: 11 * u, background: 'linear-gradient(180deg,#d1d5db,#6b7280)', borderRadius: `${6 * u} ${2 * u} ${8 * u} ${2 * u}`, transformOrigin: 'bottom left' }} />
          {/* tail */}
          <div style={{ position: 'absolute', right: -7 * u, top: 8 * u, width: 10 * u, height: 6 * u, background: '#9ca3af', borderRadius: 2 * u, transform: 'rotate(28deg)' }} />
        </div>
        {/* legs (up during headspin) */}
        <div style={{ position: 'absolute', top: -2 * u, right: 12 * u, width: 2.4 * u, height: 10 * u, background: '#f59e0b', borderRadius: 1 * u, transform: 'rotate(24deg)' }} />
        <div style={{ position: 'absolute', top: -1 * u, right: 17 * u, width: 2.4 * u, height: 10 * u, background: '#f59e0b', borderRadius: 1 * u, transform: 'rotate(-8deg)' }} />
      </motion.div>
    </>
  );
}

/** celeb_camel — «شتر دیسکو» shimmying camel under a swinging disco ball (RARE) */
function ChCamel({ d, u }: CharProps) {
  const leg = (l: number, phase: number): React.ReactElement => (
    <motion.div {...lp(d, { x: [0, phase * 3 * u, 0, -phase * 3 * u, 0] }, 0.5, 'linear')} style={abs(l * u, 10 * u, 3.4 * u, 16 * u, { background: '#b45309', borderRadius: 1.5 * u })} />
  );
  return (
    <>
      {/* disco ball (rare accessory) */}
      <motion.div {...lp(d, { rotate: [-14, 14] }, 1.6)} style={{ position: 'absolute', top: 2 * u, left: '50%', marginLeft: -6 * u, width: 12 * u, height: 12 * u, transformOrigin: 'top center' }}>
        <span style={{ position: 'absolute', top: -6 * u, left: '46%', width: 1.4 * u, height: 7 * u, background: '#94a3b8' }} />
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'conic-gradient(#e2e8f0, #64748b, #f8fafc, #475569, #e2e8f0, #94a3b8, #e2e8f0)', boxShadow: `0 0 ${7 * u}px rgba(255,255,255,.7)` }} />
        {[0, 1, 2].map((i) => (
          <motion.span key={i} {...lp(d, { opacity: [0.1, 1, 0.1] }, 0.8 + i * 0.3, 'linear')} style={{ position: 'absolute', top: (2 + i * 3) * u, left: (1 + i * 3.6) * u, width: 1.8 * u, height: 1.8 * u, background: '#fff', borderRadius: '50%' }} />
        ))}
      </motion.div>
      {/* camel shimmy */}
      <motion.div {...lp(d, { x: [0, 3.5 * u, 0, -3.5 * u, 0], rotate: [0, 2, 0, -2, 0] }, 0.5, 'linear')} style={abs(0, 0, 100 * u, 100 * u)}>
        {/* legs */}
        {leg(34, 1)}{leg(42, -1)}{leg(58, -1)}{leg(66, 1)}
        {/* body + double humps */}
        <div style={abs(30 * u, 22 * u, 42 * u, 16 * u, { background: 'linear-gradient(180deg,#d9a05b,#b45309)', borderRadius: 8 * u })}>
          <div style={{ position: 'absolute', top: -6 * u, left: 6 * u, width: 12 * u, height: 10 * u, background: '#c98a3e', borderRadius: `${6 * u} ${6 * u} 0 0` }} />
          <div style={{ position: 'absolute', top: -6 * u, right: 6 * u, width: 12 * u, height: 10 * u, background: '#c98a3e', borderRadius: `${6 * u} ${6 * u} 0 0` }} />
          {/* tail */}
          <div style={{ position: 'absolute', right: -5 * u, top: 4 * u, width: 2 * u, height: 9 * u, background: '#8a4a12', borderRadius: 1 * u, transform: 'rotate(-18deg)' }} />
        </div>
        {/* neck + head */}
        <div style={abs(58 * u, 34 * u, 6 * u, 26 * u, { background: '#c98a3e', borderRadius: 3 * u, transform: 'rotate(14deg)' })}>
          <motion.div {...lp(d, { rotate: [-6, 6] }, 0.5, 'linear')} style={{ position: 'absolute', top: -7 * u, left: -4 * u, width: 14 * u, height: 8 * u, background: '#d9a05b', borderRadius: 4 * u }}>
            <span style={{ position: 'absolute', top: 2 * u, left: 2.4 * u, width: 2.2 * u, height: 2.2 * u, background: '#1c1917', borderRadius: '50%' }} />
            <span style={{ position: 'absolute', top: -3 * u, left: 1 * u, width: 3 * u, height: 3.4 * u, background: '#8a4a12', borderRadius: '2u' }} />
          </motion.div>
        </div>
      </motion.div>
    </>
  );
}

/** celeb_mummy — «مومیایی گام‌بلند» sideways moonwalk slide + leg sweeps (EPIC, multi-part + stage) */
function ChMummy({ d, u }: CharProps) {
  const bandage = (deg = 100): CSSProperties => ({ background: `repeating-linear-gradient(${deg}deg, #e7e5e4 0 ${3.4 * u}px, #c7c2bd ${3.4 * u}px ${5 * u}px)` });
  return (
    <motion.div {...lp(d, { x: [-14 * u, 16 * u], rotate: [0, -7] }, 1.1, 'linear')} style={abs(0, 0, 100 * u, 100 * u)}>
      {/* sweeping legs */}
      <motion.div {...lp(d, { rotate: [16, -18] }, 0.55, 'linear')} style={abs(44 * u, 8 * u, 5 * u, 18 * u, { background: '#d6d0c9', borderRadius: 2 * u, transformOrigin: 'top center', ...bandage(80) })} />
      <motion.div {...lp(d, { rotate: [-16, 18] }, 0.55, 'linear')} style={abs(53 * u, 8 * u, 5 * u, 18 * u, { background: '#d6d0c9', borderRadius: 2 * u, transformOrigin: 'top center', ...bandage(80) })} />
      {/* body */}
      <div style={abs(38 * u, 22 * u, 26 * u, 30 * u, { borderRadius: `${9 * u} ${9 * u} ${6 * u} ${6 * u}`, ...bandage(), boxShadow: `inset ${-2 * u}px 0 ${3 * u}px rgba(0,0,0,.18)` })}>
        {/* wrapped arms */}
        <motion.div {...lp(d, { rotate: [18, -30] }, 0.55, 'linear')} style={{ position: 'absolute', top: 4 * u, left: -7 * u, width: 5 * u, height: 17 * u, borderRadius: 2.4 * u, transformOrigin: 'top center', ...bandage(70) }} />
        <motion.div {...lp(d, { rotate: [-24, 26] }, 0.55, 'linear')} style={{ position: 'absolute', top: 4 * u, right: -7 * u, width: 5 * u, height: 17 * u, borderRadius: 2.4 * u, transformOrigin: 'top center', ...bandage(70) }} />
      </div>
      {/* head */}
      <motion.div {...lp(d, { rotate: [5, -5] }, 0.55)} style={abs(40 * u, 52 * u, 22 * u, 22 * u, { borderRadius: '50%', ...bandage(130), boxShadow: `inset ${-2 * u}px 0 ${3 * u}px rgba(0,0,0,.2)` })}>
        <span style={{ position: 'absolute', top: 8 * u, left: 5 * u, width: 4.4 * u, height: 3 * u, background: '#111827', borderRadius: 2 * u }} />
        <span style={{ position: 'absolute', top: 8 * u, right: 5 * u, width: 4.4 * u, height: 3 * u, background: '#111827', borderRadius: 2 * u }} />
        <span style={{ position: 'absolute', top: 14.5 * u, left: 8 * u, width: 6 * u, height: 1.8 * u, background: '#111827', borderRadius: 1 * u, opacity: 0.75 }} />
      </motion.div>
    </motion.div>
  );
}

/** celeb_cactus — «کاکتوس سالسا» cactus + pot partner spinning salsa (EPIC) */
function ChCactus({ d, u }: CharProps) {
  return (
    <motion.div {...lp(d, { rotate: [0, 360] }, 2.1)} style={abs(14 * u, 10 * u, 72 * u, 74 * u, { transformOrigin: '50% 55%' })}>
      {/* cactus partner */}
      <motion.div {...lp(d, { y: [0, -5 * u, 0] }, 0.52)} style={abs(28 * u, 26 * u, 20 * u, 46 * u)}>
        <div style={{ width: '100%', height: '100%', background: 'linear-gradient(180deg,#4ade80,#15803d)', borderRadius: `${10 * u} ${10 * u} ${4 * u} ${4 * u}`, boxShadow: `inset ${-2 * u}px 0 ${3 * u}px rgba(0,0,0,.25)` }}>
          {/* arms up in salsa pose */}
          <motion.div {...lp(d, { rotate: [-8, -46] }, 0.52)} style={{ position: 'absolute', top: 6 * u, left: -8 * u, width: 9 * u, height: 5 * u, background: '#22c55e', borderRadius: 3 * u, transformOrigin: 'right center' }} />
          <motion.div {...lp(d, { rotate: [40, 4] }, 0.52)} style={{ position: 'absolute', top: 2 * u, right: -8 * u, width: 9 * u, height: 5 * u, background: '#22c55e', borderRadius: 3 * u, transformOrigin: 'left center' }} />
          {/* flower + eyes + smile */}
          <span style={{ position: 'absolute', top: -4 * u, left: '50%', marginLeft: -3 * u, width: 6 * u, height: 6 * u, background: '#f472b6', borderRadius: '50%', boxShadow: `0 0 ${4 * u}px #f472b6` }} />
          <span style={{ position: 'absolute', top: 9 * u, left: 4.4 * u, width: 3 * u, height: 3.4 * u, background: '#052e16', borderRadius: '50%' }} />
          <span style={{ position: 'absolute', top: 9 * u, right: 4.4 * u, width: 3 * u, height: 3.4 * u, background: '#052e16', borderRadius: '50%' }} />
          <span style={{ position: 'absolute', top: 15 * u, left: '50%', marginLeft: -2.6 * u, width: 5.2 * u, height: 2 * u, background: '#052e16', borderRadius: 2 * u }} />
        </div>
      </motion.div>
      {/* terracotta pot partner with a face */}
      <motion.div {...lp(d, { y: [0, -3 * u, 0], rotate: [0, 10, 0] }, 0.52)} style={abs(52 * u, 26 * u, 18 * u, 16 * u)}>
        <div style={{ width: '100%', height: '100%', background: 'linear-gradient(180deg,#ea8a5a,#c2410c)', borderRadius: `${2 * u} ${2 * u} ${5 * u} ${5 * u}`, border: `${1 * u}px solid #7c2d12` }}>
          <span style={{ position: 'absolute', top: -3 * u, left: -1.6 * u, width: 21 * u, height: 4.4 * u, background: '#f97316', borderRadius: 2 * u, border: `${1 * u}px solid #7c2d12` }} />
          <span style={{ position: 'absolute', top: 6 * u, left: 4 * u, width: 2.6 * u, height: 3 * u, background: '#431407', borderRadius: '50%' }} />
          <span style={{ position: 'absolute', top: 6 * u, right: 4 * u, width: 2.6 * u, height: 3 * u, background: '#431407', borderRadius: '50%' }} />
          <span style={{ position: 'absolute', top: 10.6 * u, left: '50%', marginLeft: -2 * u, width: 4 * u, height: 1.6 * u, background: '#431407', borderRadius: 1 * u }} />
        </div>
      </motion.div>
    </motion.div>
  );
}

/** celeb_rocket — «موشک باله» pirouetting rocket with particle trail (LEGENDARY, spotlight + confetti) */
function ChRocket({ d, u }: CharProps) {
  return (
    <>
      <motion.div {...lp(d, { y: [0, -6 * u, 0] }, 1.2)} style={abs(0, 0, 100 * u, 100 * u)}>
        <motion.div {...lp(d, { rotate: [0, 360] }, 2.3)} style={abs(40 * u, 24 * u, 20 * u, 56 * u, { transformOrigin: '50% 50%' })}>
          {/* body */}
          <div style={{ position: 'absolute', top: 8 * u, left: 0, width: '100%', height: 34 * u, background: 'linear-gradient(90deg,#f8fafc,#cbd5e1)', borderRadius: 4 * u, border: `${1 * u}px solid #64748b` }}>
            <span style={{ position: 'absolute', top: 10 * u, left: '50%', marginLeft: -4 * u, width: 8 * u, height: 8 * u, background: '#22d3ee', borderRadius: '50%', border: `${1.6 * u}px solid #0e7490`, boxShadow: `0 0 ${5 * u}px #22d3ee` }} />
          </div>
          {/* nose cone */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 10 * u, background: 'linear-gradient(90deg,#f87171,#b91c1c)', borderRadius: `${10 * u} ${10 * u} 0 0` }} />
          {/* fins */}
          <div style={{ position: 'absolute', bottom: 10 * u, left: -7 * u, width: 8 * u, height: 12 * u, background: '#dc2626', clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }} />
          <div style={{ position: 'absolute', bottom: 10 * u, right: -7 * u, width: 8 * u, height: 12 * u, background: '#dc2626', clipPath: 'polygon(0 0, 0 100%, 100% 100%)' }} />
          {/* flame */}
          <motion.div {...lp(d, { scaleY: [1, 0.55, 1.15, 0.8] }, 0.3, 'linear')} style={{ position: 'absolute', bottom: -11 * u, left: '50%', marginLeft: -4 * u, width: 8 * u, height: 12 * u, background: 'linear-gradient(180deg,#fde047,#f97316,#ef4444)', borderRadius: '0 0 50% 50%' }} />
        </motion.div>
      </motion.div>
      {/* particle trail */}
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.span
          key={i}
          {...lp(d, { y: [0, 16 * u], opacity: [0.9, 0], scale: [1, 0.3] }, 0.9 + i * 0.14, 'linear')}
          style={abs((46 + (i % 2) * 8) * u, (8 + i * 2.5) * u, 2.6 * u, 2.6 * u, { background: i % 2 ? '#fde047' : '#fb923c', borderRadius: '50%' })}
        />
      ))}
    </>
  );
}

/** celeb_jelly — «عروس دریایی نئون» glowing jellyfish pulsing tentacle wave (LEGENDARY, spotlight) */
function ChJelly({ d, u }: CharProps) {
  return (
    <>
      <motion.div {...lp(d, { y: [0, -7 * u, 0], scaleY: [1, 1.08, 1] }, 1.15)} style={abs(0, 0, 100 * u, 100 * u)}>
        {/* dome */}
        <div style={abs(33 * u, 52 * u, 34 * u, 24 * u, { borderRadius: `${17 * u} ${17 * u} ${6 * u} ${6 * u}`, background: 'radial-gradient(120% 120% at 50% 20%, rgba(165,243,252,.95), rgba(34,211,238,.55) 60%, rgba(59,130,246,.35))', boxShadow: `0 0 ${10 * u}px #22d3ee, inset 0 ${-2 * u}px ${5 * u}px rgba(8,145,178,.6)` })}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ position: 'absolute', top: (5 + (i % 2) * 7) * u, left: (7 + i * 9) * u, width: 3 * u, height: 3 * u, background: '#cffafe', borderRadius: '50%', opacity: 0.85 }} />
          ))}
        </div>
        {/* tentacle wave */}
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            {...lp(d, { rotate: [-16, 16], skewX: [-8, 8] }, 1.15, 'easeInOut')}
            style={abs((36 + i * 6.4) * u, 30 * u, 2.6 * u, 24 * u, { background: 'linear-gradient(180deg, rgba(103,232,249,.95), rgba(59,130,246,.25))', borderRadius: 2 * u, transformOrigin: 'top center', transitionDelay: `${i * 60}ms` } as CSSProperties)}
          />
        ))}
      </motion.div>
      {/* neon sparkles */}
      {[0, 1, 2, 3].map((i) => (
        <motion.span key={i} {...lp(d, { opacity: [0.15, 1, 0.15], scale: [0.7, 1.2, 0.7] }, 1.3 + i * 0.35, 'linear')} style={abs((10 + i * 26) * u, (34 + (i % 2) * 22) * u, 3 * u, 3 * u, { background: '#a5f3fc', borderRadius: '50%', boxShadow: `0 0 ${6 * u}px #22d3ee` })} />
      ))}
    </>
  );
}

/** mini blob used as a backup dancer in ULTIMATE scenes */
function MiniDancer({ d, u, x, color, delay = 0 }: { d: boolean; u: number; x: number; color: string; delay?: number }) {
  return (
    <motion.div {...lp(d, { y: [0, -6 * u, 0], rotate: [-12, 12] }, 0.44 + delay)} style={abs(x * u, 12 * u, 13 * u, 13 * u)}>
      <div style={{ width: '100%', height: '100%', background: color, borderRadius: '48% 52% 46% 54% / 60% 60% 42% 42%', boxShadow: `inset ${-1.4 * u}px ${-1.4 * u}px 0 rgba(0,0,0,.28)` }}>
        <span style={{ position: 'absolute', top: 4 * u, left: 3 * u, width: 2.2 * u, height: 2.2 * u, background: '#fff', borderRadius: '50%' }} />
        <span style={{ position: 'absolute', top: 4 * u, right: 3 * u, width: 2.2 * u, height: 2.2 * u, background: '#fff', borderRadius: '50%' }} />
      </div>
    </motion.div>
  );
}

/** celeb_dragon — «اژدهای تیلت‌پرون» dragon dance crew + confetti cannons (ULTIMATE full scene) */
function ChDragon({ d, u }: CharProps) {
  return (
    <>
      {/* confetti cannons + bursts */}
      {[0, 1].map((i) => (
        <div key={`can-${i}`} style={abs(i === 0 ? 2 * u : 88 * u, 30 * u, 4 * u, 16 * u, { background: 'linear-gradient(180deg,#fbbf24,#b45309)', borderRadius: 2 * u, transform: `rotate(${i === 0 ? 34 : -34}deg)`, transformOrigin: 'bottom center' })} />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <motion.span
          key={`burst-${i}`}
          {...lp(d, { x: i < 3 ? [0, (8 + i * 7) * u] : [0, -(8 + (i - 3) * 7) * u], y: [0, -(14 + (i % 3) * 9) * u], opacity: [1, 1, 0], rotate: [0, 220] }, 1.05 + (i % 3) * 0.2, 'easeOut')}
          style={abs(i < 3 ? 6 * u : 88 * u, 42 * u, 3.2 * u, 2 * u, { background: ['#f472b6', '#34d399', '#60a5fa', '#fbbf24', '#c084fc', '#f87171'][i], borderRadius: 1 * u })}
        />
      ))}
      {/* the twerking dragon */}
      <motion.div {...lp(d, { y: [0, -4 * u, 0] }, 0.34, 'linear')} style={abs(0, 0, 100 * u, 100 * u)}>
        <motion.div {...lp(d, { rotate: [-5, 5] }, 0.68)} style={abs(0, 0, 100 * u, 100 * u)}>
          {/* wings */}
          <motion.div {...lp(d, { rotate: [8, -34], scaleY: [1, 0.6] }, 0.4, 'linear')} style={abs(14 * u, 40 * u, 20 * u, 15 * u, { background: 'linear-gradient(180deg,#a855f7,#6b21a8)', clipPath: 'polygon(0 100%, 20% 10%, 55% 45%, 100% 0, 90% 100%)', transformOrigin: 'bottom right' })} />
          <motion.div {...lp(d, { rotate: [-8, 34], scaleY: [1, 0.6] }, 0.4, 'linear')} style={abs(66 * u, 40 * u, 20 * u, 15 * u, { background: 'linear-gradient(180deg,#a855f7,#6b21a8)', clipPath: 'polygon(0 0, 45% 45%, 80% 10%, 100% 100%, 10% 100%)', transformOrigin: 'bottom left' })} />
          {/* tail */}
          <div style={abs(70 * u, 22 * u, 16 * u, 4 * u, { background: '#7c3aed', borderRadius: 2 * u, transform: 'rotate(-24deg)' })} />
          <div style={abs(82 * u, 25 * u, 8 * u, 3 * u, { background: '#a855f7', borderRadius: 2 * u, transform: 'rotate(-40deg)' })} />
          {/* body + belly */}
          <div style={abs(30 * u, 14 * u, 40 * u, 30 * u, { background: 'linear-gradient(180deg,#8b5cf6,#5b21b6)', borderRadius: 10 * u, boxShadow: `inset ${-3 * u}px 0 ${5 * u}px rgba(0,0,0,.3)` })}>
            <div style={{ position: 'absolute', bottom: 2 * u, left: '22%', width: '56%', height: 14 * u, background: '#fde68a', borderRadius: 6 * u }} />
          </div>
          {/* head */}
          <motion.div {...lp(d, { rotate: [4, -6] }, 0.68)} style={abs(22 * u, 40 * u, 26 * u, 20 * u, { background: 'linear-gradient(180deg,#a78bfa,#6d28d9)', borderRadius: `${10 * u} ${10 * u} ${6 * u} ${6 * u}` })}>
            {/* horns */}
            <span style={{ position: 'absolute', top: -5 * u, left: 4 * u, width: 0, height: 0, borderLeft: `${2.4 * u}px solid transparent`, borderRight: `${2.4 * u}px solid transparent`, borderBottom: `${6 * u}px solid #fde68a` }} />
            <span style={{ position: 'absolute', top: -5 * u, right: 4 * u, width: 0, height: 0, borderLeft: `${2.4 * u}px solid transparent`, borderRight: `${2.4 * u}px solid transparent`, borderBottom: `${6 * u}px solid #fde68a` }} />
            <span style={{ position: 'absolute', top: 7 * u, left: 5 * u, width: 4.4 * u, height: 4.4 * u, background: '#fef9c3', borderRadius: '50%' }} />
            <span style={{ position: 'absolute', top: 7 * u, right: 5 * u, width: 4.4 * u, height: 4.4 * u, background: '#fef9c3', borderRadius: '50%' }} />
            <span style={{ position: 'absolute', top: 8.4 * u, left: 6.4 * u, width: 2 * u, height: 2 * u, background: '#1c1917', borderRadius: '50%' }} />
            <span style={{ position: 'absolute', top: 8.4 * u, right: 6.4 * u, width: 2 * u, height: 2 * u, background: '#1c1917', borderRadius: '50%' }} />
            {/* snout + smile */}
            <div style={{ position: 'absolute', bottom: -2 * u, left: '50%', marginLeft: -6 * u, width: 12 * u, height: 6 * u, background: '#7c3aed', borderRadius: 3 * u }}>
              <span style={{ position: 'absolute', bottom: 1.4 * u, left: '50%', marginLeft: -3.4 * u, width: 6.8 * u, height: 1.6 * u, background: '#4c1d95', borderRadius: 1 * u }} />
            </div>
          </motion.div>
          {/* feet */}
          <div style={abs(34 * u, 10 * u, 9 * u, 6 * u, { background: '#5b21b6', borderRadius: 3 * u })} />
          <div style={abs(56 * u, 10 * u, 9 * u, 6 * u, { background: '#5b21b6', borderRadius: 3 * u })} />
        </motion.div>
      </motion.div>
      {/* backup dancers */}
      <MiniDancer d={d} u={u} x={6} color="linear-gradient(160deg,#5eead4,#0f766e)" />
      <MiniDancer d={d} u={u} x={81} color="linear-gradient(160deg,#fda4af,#9f1239)" delay={0.12} />
    </>
  );
}

/** celeb_phoenix — «ققنوس جشن» full festival stage: firebird + dancers + fireworks + lasers (ULTIMATE) */
function ChPhoenix({ d, u }: CharProps) {
  return (
    <>
      {/* fireworks rings */}
      {[0, 1, 2].map((i) => (
        <motion.span
          key={`fw-${i}`}
          {...lp(d, { scale: [0.2, 1.15], opacity: [0.95, 0] }, 1.4 + i * 0.35, 'easeOut')}
          style={{ position: 'absolute', top: (8 + i * 12) * u, left: (14 + i * 30) * u, width: 16 * u, height: 16 * u, border: `${1.6 * u}px solid ['#fde047', '#f472b6', '#5eead4'][i]`, borderRadius: '50%', boxShadow: `0 0 ${6 * u}px ${['#fde047', '#f472b6', '#5eead4'][i]}` }}
        />
      ))}
      {/* laser sweep from top corners */}
      {[0, 1].map((i) => (
        <motion.div
          key={`laser-${i}`}
          {...lp(d, { rotate: i === 0 ? [-46, -14] : [46, 14], opacity: [0.5, 0.9, 0.5] }, 2.2, 'easeInOut')}
          style={{ position: 'absolute', top: -6 * u, left: i === 0 ? 12 * u : undefined, right: i === 1 ? 12 * u : undefined, width: 2.2 * u, height: 64 * u, background: `linear-gradient(180deg, ${i === 0 ? '#f43f5e' : '#38bdf8'}, transparent)`, transformOrigin: 'top center', borderRadius: 2 * u, filter: `blur(${0.5 * u}px)` }}
        />
      ))}
      {/* the firebird */}
      <motion.div {...lp(d, { y: [0, -8 * u, 0] }, 0.9)} style={abs(0, 0, 100 * u, 100 * u)}>
        {/* tail fan */}
        {[0, 1, 2].map((i) => (
          <div key={`tl-${i}`} style={abs((58 + i * 5) * u, (20 + (i === 1 ? 4 : 0)) * u, 3.4 * u, 18 * u, { background: ['linear-gradient(180deg,#fde047,#f97316)', 'linear-gradient(180deg,#fbbf24,#ef4444)', 'linear-gradient(180deg,#fdba74,#dc2626)'][i], borderRadius: 2 * u, transform: `rotate(${14 - i * 14}deg)`, transformOrigin: 'bottom center' })} />
        ))}
        {/* wings — big flaring gradients */}
        <motion.div {...lp(d, { rotate: [16, -40], scaleY: [1, 0.62] }, 0.72)} style={abs(6 * u, 34 * u, 26 * u, 20 * u, { background: 'linear-gradient(200deg,#fef08a 5%,#f97316 55%,#dc2626)', clipPath: 'polygon(0 100%, 12% 28%, 34% 62%, 52% 6%, 74% 52%, 92% 18%, 100% 100%)', transformOrigin: 'bottom right', filter: `drop-shadow(0 0 ${4 * u}px rgba(249,115,22,.7))` })} />
        <motion.div {...lp(d, { rotate: [-16, 40], scaleY: [1, 0.62] }, 0.72)} style={abs(68 * u, 34 * u, 26 * u, 20 * u, { background: 'linear-gradient(160deg,#fef08a 5%,#f97316 55%,#dc2626)', clipPath: 'polygon(0 100%, 8% 18%, 26% 52%, 48% 6%, 66% 62%, 88% 28%, 100% 100%)', transformOrigin: 'bottom left', filter: `drop-shadow(0 0 ${4 * u}px rgba(249,115,22,.7))` })} />
        {/* body */}
        <div style={abs(40 * u, 16 * u, 20 * u, 34 * u, { background: 'linear-gradient(180deg,#fdba74,#ea580c)', borderRadius: `${10 * u} ${10 * u} ${6 * u} ${6 * u}`, boxShadow: `0 0 ${8 * u}px rgba(249,115,22,.55), inset ${-2 * u}px 0 ${4 * u}px rgba(124,45,18,.5)` })}>
          <span style={{ position: 'absolute', bottom: 4 * u, left: '28%', width: '44%', height: 12 * u, background: 'linear-gradient(180deg,#fef9c3,#fbbf24)', borderRadius: 5 * u }} />
        </div>
        {/* head + crest + beak */}
        <motion.div {...lp(d, { rotate: [6, -6] }, 0.9)} style={abs(38 * u, 50 * u, 24 * u, 20 * u, { background: 'linear-gradient(180deg,#fed7aa,#f97316)', borderRadius: `${12 * u} ${12 * u} ${5 * u} ${5 * u}` })}>
          {[0, 1].map((i) => (
            <span key={i} style={{ position: 'absolute', top: -4.4 * u, left: (6 + i * 5) * u, width: 0, height: 0, borderLeft: `${2 * u}px solid transparent`, borderRight: `${2 * u}px solid transparent`, borderBottom: `${5.4 * u}px solid #fbbf24`, transform: `rotate(${i === 0 ? -16 : 8}deg)` }} />
          ))}
          <span style={{ position: 'absolute', top: 7 * u, left: 5 * u, width: 3.6 * u, height: 3.6 * u, background: '#fef9c3', borderRadius: '50%' }} />
          <span style={{ position: 'absolute', top: 8.2 * u, left: 6.2 * u, width: 1.8 * u, height: 1.8 * u, background: '#1c1917', borderRadius: '50%' }} />
          <span style={{ position: 'absolute', top: 8.6 * u, right: -4.4 * u, width: 0, height: 0, borderTop: `${2.6 * u}px solid transparent`, borderBottom: `${2.6 * u}px solid transparent`, borderLeft: `${5.4 * u}px solid #fbbf24` }} />
        </motion.div>
      </motion.div>
      {/* backup dancers (flame blobs) */}
      <MiniDancer d={d} u={u} x={4} color="linear-gradient(160deg,#fde047,#ea580c)" />
      <MiniDancer d={d} u={u} x={83} color="linear-gradient(160deg,#fda4af,#b91c1c)" delay={0.14} />
    </>
  );
}

const CHARACTERS: Record<string, (p: CharProps) => React.ReactElement | null> = {
  blob: ChBlob,
  robot: ChRobot,
  pigeon: ChPigeon,
  camel: ChCamel,
  mummy: ChMummy,
  cactus: ChCactus,
  rocket: ChRocket,
  jelly: ChJelly,
  dragon: ChDragon,
  phoenix: ChPhoenix,
};

function characterOf(code: string): string {
  const item = STORE_ITEMS.find((i) => i.code === code && i.category === 'CELEBRATION');
  const c = (item?.data as { character?: string } | undefined)?.character;
  return c && CHARACTERS[c] ? c : 'blob';
}

/* ============================== stage & scene ============================== */

function stageBackground(tier: number): string {
  if (tier >= 4) return 'radial-gradient(130% 100% at 50% 0%, #2e1065 0%, #1e1b4b 45%, #0c0a1d 100%)';
  if (tier === 3) return 'radial-gradient(130% 100% at 50% 0%, #1e1b4b 0%, #172554 55%, #020617 100%)';
  if (tier === 2) return 'radial-gradient(130% 100% at 50% 0%, #312e81 0%, #1e1b4b 60%, #0f0524 100%)';
  if (tier === 1) return 'radial-gradient(130% 100% at 50% 0%, #1f2937 0%, #111827 60%, #030712 100%)';
  return 'radial-gradient(130% 100% at 50% 0%, #292524 0%, #1c1917 55%, #0c0a09 100%)';
}

function floorBackground(tier: number): string {
  if (tier >= 4) return 'linear-gradient(180deg, rgba(250,204,21,.28), rgba(126,34,206,.5))';
  if (tier === 3) return 'linear-gradient(180deg, rgba(96,165,250,.22), rgba(30,27,75,.55))';
  if (tier === 2) return 'linear-gradient(180deg, rgba(167,139,250,.2), rgba(30,27,75,.5))';
  return 'linear-gradient(180deg, rgba(255,255,255,.1), rgba(0,0,0,.35))';
}

/** deterministic star sprinkles (no Math.random → SSR-safe) */
function Stars({ u, d }: { u: number; d: boolean }) {
  return (
    <>
      {Array.from({ length: 9 }).map((_, i) => (
        <motion.span
          key={i}
          {...lp(d, { opacity: [0.25, 0.9, 0.25] }, 1.4 + (i % 4) * 0.4, 'linear')}
          style={{ position: 'absolute', top: (4 + ((i * 29) % 30)) * u, left: (4 + ((i * 43) % 92)) * u, width: 1.6 * u, height: 1.6 * u, background: '#fef9c3', borderRadius: '50%' }}
        />
      ))}
    </>
  );
}

/** floating music notes (EPIC+) */
function Notes({ u, d }: { u: number; d: boolean }) {
  return (
    <>
      {['♪', '♫', '♩'].map((n, i) => (
        <motion.span
          key={n}
          {...lp(d, { y: [0, -22 * u], opacity: [0, 0.95, 0], rotate: [i % 2 ? 10 : -10, i % 2 ? -6 : 6] }, 1.7 + i * 0.5, 'linear')}
          style={{ position: 'absolute', top: (58 - i * 6) * u, left: (i === 1 ? 8 : 86 - i * 4) * u, fontSize: 9 * u, color: ['#fbbf24', '#c084fc', '#5eead4'][i], textShadow: `0 0 ${4 * u}px currentColor`, lineHeight: 1 }}
        >
          {n}
        </motion.span>
      ))}
    </>
  );
}

/** rotating spotlight beams (LEGENDARY+) */
function Spotlights({ u, d }: { u: number; d: boolean }) {
  return (
    <>
      {[0, 1].map((i) => (
        <motion.div
          key={i}
          {...lp(d, { rotate: i === 0 ? [-38, 30] : [38, -30], opacity: [0.16, 0.3, 0.16] }, 3.4, 'easeInOut')}
          style={{ position: 'absolute', top: -4 * u, left: i === 0 ? '12%' : undefined, right: i === 1 ? '12%' : undefined, width: 16 * u, height: 96 * u, transformOrigin: 'top center', background: 'linear-gradient(180deg, rgba(255,255,255,.5), rgba(255,255,255,0) 78%)', clipPath: 'polygon(38% 0, 62% 0, 100% 100%, 0 100%)', pointerEvents: 'none' }}
        />
      ))}
    </>
  );
}

/** falling confetti particles (LEGENDARY+) — deterministic columns */
function ConfettiRain({ u, d }: { u: number; d: boolean }) {
  const colors = ['#fbbf24', '#f472b6', '#34d399', '#60a5fa', '#c084fc', '#f87171'];
  return (
    <>
      {Array.from({ length: 10 }).map((_, i) => (
        <motion.span
          key={i}
          {...lp(d, { y: [-8 * u, 96 * u], rotate: [0, 240 + i * 31], opacity: [0, 1, 1, 0] }, 2.1 + (i % 5) * 0.4, 'linear')}
          style={{ position: 'absolute', top: 0, left: (3 + i * 9.6) * u, width: 3 * u, height: 2 * u, background: colors[i % colors.length], borderRadius: 0.6 * u }}
        />
      ))}
    </>
  );
}

/* ============================== main component ============================== */

export function CelebrationSprite({
  code,
  size = 96,
  dancing = true,
  className,
}: {
  code?: string | null;
  size?: number;
  /** loop the dance; false = static rest pose (perf mode / cheap previews) */
  dancing?: boolean;
  className?: string;
}) {
  const cc = code ?? 'celeb_confetti';
  const rarity = rarityOf(cc);
  const tier = TIER[rarity];
  const meta = RARITY_META[rarity];
  const u = size / 100;
  const Char = CHARACTERS[characterOf(cc)] ?? ChBlob;

  return (
    <div
      className={className}
      role="img"
      aria-label={`celebration ${cc}`}
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: Math.max(10, size * 0.16),
        overflow: 'hidden',
        border: `2px solid ${meta.color}66`,
        boxShadow: `0 0 ${Math.round(size / 5)}px ${meta.glow}, inset 0 0 ${Math.round(size / 6)}px ${meta.glow}`,
        background: stageBackground(tier),
        flexShrink: 0,
      }}
    >
      {/* sky decor */}
      {tier >= 2 && <Stars u={u} d={dancing} />}
      {tier >= 3 && <Spotlights u={u} d={dancing} />}
      {tier >= 3 && <ConfettiRain u={u} d={dancing} />}

      {/* stage floor */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 15 * u, background: floorBackground(tier) }} />
      {tier >= 2 && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 15 * u, height: 1.4 * u, background: tier >= 4 ? 'rgba(253,224,71,.5)' : 'rgba(196,181,253,.4)' }} />
      )}

      {/* floor shadow (RARE+) */}
      {tier >= 1 && (
        <motion.div
          {...lp(dancing, { scaleX: [1, 0.68, 1], opacity: [0.4, 0.24, 0.4] }, 0.62)}
          style={{ position: 'absolute', bottom: 5 * u, left: '50%', marginLeft: -16 * u, width: 32 * u, height: 4.4 * u, background: 'rgba(0,0,0,.55)', borderRadius: '50%', filter: `blur(${1.2 * u}px)` }}
        />
      )}

      {/* the character */}
      <Char d={dancing} u={u} tier={tier} />

      {/* music notes float above the character (EPIC+) */}
      {tier >= 2 && <Notes u={u} d={dancing} />}
    </div>
  );
}
