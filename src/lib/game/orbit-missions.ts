/**
 * Orbit Odyssey (ادیسهٔ مداری) — campaign data, tuning constants and pure physics.
 *
 * REAL ASTRODYNAMICS, scaled: every trajectory in the game is produced by the same
 * Newtonian integrator the player sees — a = Σ GMᵢ·(rᵢ − r)/|rᵢ − r|³, integrated
 * with semi-implicit (symplectic) Euler at a fixed dt = 1/60 s. No scripted paths,
 * no fake curves: Hohmann arcs, slingshots and the Oberth effect all EMERGE from
 * the simulation, exactly as they do in real mission planning.
 *
 * TUNING CONSTANTS (units: world units [u], seconds [s]; board is 1600×1200 u)
 * --------------------------------------------------------------------------------------------
 *  WORLD               board size 1600×1200 u (4:3); rendered to fit, physics never scales.
 *  DT                  fixed physics step 1/60 s, consumed via an accumulator in the RAF loop.
 *  SIM_SOFT2           gravity softening² (8 u) — purely numerical stability on deep flybys;
 *                      at legal approach distances its effect is <0.5% (documented, not gameplay).
 *  THRUST_ACCEL        42 u/s² — mid-flight burn acceleration while the player holds a thrust
 *                      vector (comparable to local planetary gravity for intuitive steering).
 *  FUEL_BURN           12 fuel/s drained while thrusting. Fuel 0 ⇒ ballistic coast (not a loss).
 *  LAUNCH_SCALE        0.16 (u/s of Δv) per world-unit of drag length.
 *  MAX_DRAG            240 u drag cap ⇒ ~38.4 u/s max launch Δv (≈2× solar-orbital speed @400 u).
 *  LAUNCH_FUEL_PER_DV  0.4 fuel per (u/s) of launch Δv — a full-power launch costs ~15 fuel.
 *  TIME_LIMIT          150 s per run (lose condition; generous — transfers take 40–90 s).
 *  OOB_MARGIN          40% — lost when outside the board grown by 40% on every side.
 *  PREDICT_STEPS       900 steps (15 s) of live ballistic prediction while aiming.
 *  POD_PICKUP          26 u pickup radius (probe included) — deliberately generous.
 *  PROBE_R             7 u probe body radius; crash when dist < body.r + 4 (forgiving grazes).
 *
 *  Gravity model uses plausible relative GMs (not SI): Earth 9000, Moon 120, Mars 3800,
 *  Venus 7200, Jupiter 20000, Saturn 12000, Uranus 8000, Neptune 11000, Sun 45000 —
 *  ratios mirror the real solar system closely enough that trajectories LOOK right.
 *
 *  Score: 100 + round(fuelLeft × 2) + pods × 100 (server clamps/caps economy rewards).
 *  Progress: localStorage 'doi_orbit_mission' (highest unlocked index), 'doi_orbit_best' (per-mission bests).
 */

export const WORLD = { w: 1600, h: 1200 } as const;
export const DT = 1 / 60;
export const SIM_SOFT2 = 64;
export const THRUST_ACCEL = 42;
export const FUEL_BURN = 12;
export const LAUNCH_SCALE = 0.16;
export const MAX_DRAG = 240;
export const LAUNCH_FUEL_PER_DV = 0.4;
export const TIME_LIMIT = 150;
export const OOB_MARGIN = 0.4;
export const PREDICT_STEPS = 900;
export const POD_PICKUP = 26;
export const PROBE_R = 7;

/* ---------------------------------------------- types ---------------------------------------------- */

export interface Bi {
  fa: string;
  en: string;
}

export type BodyKind = 'sun' | 'planet' | 'moon';

export interface Body {
  id: string;
  name: Bi;
  kind: BodyKind;
  x: number;
  y: number;
  r: number;
  gm: number;
  color: string;
  ring?: boolean;
}

export interface PodSpot {
  x: number;
  y: number;
}

export interface Mission {
  id: string;
  act: 1 | 2 | 3;
  name: Bi;
  briefing: Bi;
  hint: Bi;
  bodies: Body[];
  start: { x: number; y: number };
  startFuel: number;
  target: { x: number; y: number; r: number };
  pods: PodSpot[];
}

export const ACTS: Record<1 | 2 | 3, { name: Bi; sub: Bi }> = {
  1: { name: { fa: 'دنیاهای درونی', en: 'Inner Worlds' }, sub: { fa: 'زمین، ماه و مریخ — سنگرهای خانه', en: 'Earth, Moon and Mars — the home trench' } },
  2: { name: { fa: 'نردبان غول‌ها', en: "The Giants' Ladder" }, sub: { fa: 'زهره تا مشتری — یاریِ گرانشی', en: 'Venus to Jupiter — riding gravity assists' } },
  3: { name: { fa: 'همسرِ خاموش', en: 'The Silent Choir' }, sub: { fa: 'کاوشگرانِ بی‌صدای لبهٔ تاریکی', en: 'The silent probes at the rim of the dark' } },
};

/** Pick narrative text: fa for Persian, en otherwise (ar/tr fall back to en by design). */
export function pick(b: Bi, locale: string): string {
  return locale === 'fa' ? b.fa : b.en;
}

/* ---------------------------------------------- bodies ---------------------------------------------- */

const SUN = (x: number, y: number): Body => ({ id: 'sun', name: { fa: 'خورشید', en: 'Sun' }, kind: 'sun', x, y, r: 110, gm: 45000, color: '#f59e0b' });
const EARTH = (x: number, y: number): Body => ({ id: 'earth', name: { fa: 'زمین', en: 'Earth' }, kind: 'planet', x, y, r: 70, gm: 9000, color: '#2dd4bf' });
const MOON = (x: number, y: number): Body => ({ id: 'moon', name: { fa: 'ماه', en: 'Moon' }, kind: 'moon', x, y, r: 26, gm: 120, color: '#d6d3d1' });
const MARS = (x: number, y: number): Body => ({ id: 'mars', name: { fa: 'مریخ', en: 'Mars' }, kind: 'planet', x, y, r: 52, gm: 3800, color: '#ea580c' });
const VENUS = (x: number, y: number): Body => ({ id: 'venus', name: { fa: 'زهره', en: 'Venus' }, kind: 'planet', x, y, r: 58, gm: 7200, color: '#fcd34d' });
const JUPITER = (x: number, y: number): Body => ({ id: 'jupiter', name: { fa: 'مشتری', en: 'Jupiter' }, kind: 'planet', x, y, r: 88, gm: 20000, color: '#d97706' });
const IO = (x: number, y: number): Body => ({ id: 'io', name: { fa: 'آیو', en: 'Io' }, kind: 'moon', x, y, r: 22, gm: 250, color: '#fde047' });
const EUROPA = (x: number, y: number): Body => ({ id: 'europa', name: { fa: 'اروپا', en: 'Europa' }, kind: 'moon', x, y, r: 20, gm: 180, color: '#a7f3d0' });
const CALLISTO = (x: number, y: number): Body => ({ id: 'callisto', name: { fa: 'کالیستو', en: 'Callisto' }, kind: 'moon', x, y, r: 24, gm: 160, color: '#a8a29e' });
const SATURN = (x: number, y: number): Body => ({ id: 'saturn', name: { fa: 'زحل', en: 'Saturn' }, kind: 'planet', x, y, r: 78, gm: 12000, color: '#eab308', ring: true });
const TITAN = (x: number, y: number): Body => ({ id: 'titan', name: { fa: 'تیتان', en: 'Titan' }, kind: 'moon', x, y, r: 20, gm: 90, color: '#f59e0b' });
const URANUS = (x: number, y: number): Body => ({ id: 'uranus', name: { fa: 'اورانوس', en: 'Uranus' }, kind: 'planet', x, y, r: 68, gm: 8000, color: '#5eead4' });
const MIRANDA = (x: number, y: number): Body => ({ id: 'miranda', name: { fa: 'میراندا', en: 'Miranda' }, kind: 'moon', x, y, r: 18, gm: 60, color: '#d4d4d8' });
const WANDERER = (x: number, y: number): Body => ({ id: 'wanderer', name: { fa: 'سیارِ سرگردان', en: 'The Wanderer' }, kind: 'planet', x, y, r: 58, gm: 26000, color: '#78716c' });
const NEPTUNE = (x: number, y: number): Body => ({ id: 'neptune', name: { fa: 'نپتون', en: 'Neptune' }, kind: 'planet', x, y, r: 70, gm: 11000, color: '#2dd4bf' });
const TRITON = (x: number, y: number): Body => ({ id: 'triton', name: { fa: 'تریتون', en: 'Triton' }, kind: 'moon', x, y, r: 22, gm: 100, color: '#e7e5e4' });

/* ---------------------------------------------- missions ---------------------------------------------- */

/**
 * STORY — Year 2091: the "Heliograph Array", humanity's network of science probes,
 * fell silent after a historic solar storm. The player navigates the restoration tug
 * "Khorshid" (خورشید — "Sun"), reawakening the relay stations one trajectory at a time.
 * A pacifist epic: every victory is a science probe brought home, never a shot fired.
 */
export const MISSIONS: Mission[] = [
  // ------------------------------------------------ ACT I — INNER WORLDS
  {
    id: 'm1',
    act: 1,
    name: { fa: 'نورِ نخست', en: 'First Light' },
    briefing: {
      fa: 'سال ۲۰۹۱. نُه ماه پس از توفان خورشیدی، شبکهٔ هلیوگراف — تارِ علمی بشر — هنوز در خواب است. تو خلبان یدک‌کشِ بازسازی «خورشید» هستی. نخستین کاوشگر را رها کن تا به ایستگاه رلهٔ ۱ سُر بخورد؛ ببین گرانش زمین بی‌صدا مسیر را خم می‌کند.',
      en: 'Year 2091. Nine months after the solar storm, the Heliograph Array — humanity\'s web of science probes — still sleeps. You pilot the restoration tug Khorshid. Release the first probe and let it glide to Relay Station 1; notice how Earth\'s gravity quietly bends every path.',
    },
    hint: { fa: 'به راست و کمی بالا بکش؛ زمین مسیر را به پایین می‌کشد.', en: 'Drag right and a touch up; Earth pulls the path downward.' },
    bodies: [EARTH(800, 1010)],
    start: { x: 280, y: 620 },
    startFuel: 100,
    target: { x: 1210, y: 560, r: 100 },
    pods: [{ x: 640, y: 590 }, { x: 940, y: 555 }],
  },
  {
    id: 'm2',
    act: 1,
    name: { fa: 'مدارِ پارکینگ', en: 'Parking Orbit' },
    briefing: {
      fa: 'رلهٔ ۲ در آن‌سوی زمین پنهان است. یک پرتابِ مستقیم به سنگ می‌انجامد — از بالای سیاره بگذر و بگذار گرانش تو را بچرخاند. این همان «درج در مدار» است: مسیری که برای همیشه سقوط می‌کند و همیشه از دستِ زمین درمی‌رود.',
      en: 'Relay 2 hides on the far side of Earth. A straight burn ends in rock — instead, pass above the planet and let gravity swing you around. This is orbit insertion: a path that falls forever and keeps missing.',
    },
    hint: { fa: 'بالای سیاره با توانِ متوسط نشانه برو — گرانش دورت دورت می‌چرخاند.', en: 'Aim above the planet with medium power — gravity bends you around the far side.' },
    bodies: [EARTH(780, 600)],
    start: { x: 240, y: 600 },
    startFuel: 100,
    target: { x: 1270, y: 600, r: 95 },
    pods: [{ x: 620, y: 350 }, { x: 900, y: 830 }],
  },
  {
    id: 'm3',
    act: 1,
    name: { fa: 'نجوای ماه', en: 'Lunar Whisper' },
    briefing: {
      fa: 'کشش ماه در فاصلهٔ برابر تنها یک‌هشتادم گرانش زمین است، اما نزدیک سطحش بر همه چیز فرمان می‌راند. از کنار ماه بگذر و ببین کششِ ظریفش کمانِ پرواز را به سوی رلهٔ ۳ خم می‌کند.',
      en: 'The Moon\'s pull is only 1/80th of Earth\'s at equal distance, yet near its surface it rules everything. Thread close past the Moon and watch its delicate tug bend your arc toward Relay 3.',
    },
    hint: { fa: 'نزدیکِ بالای ماه بگذر؛ کششِ ضعیفش فقط در نزدیکی معنا دارد.', en: 'Pass close above the Moon; its weak pull only matters near.' },
    bodies: [EARTH(520, 640), MOON(1020, 360)],
    start: { x: 220, y: 850 },
    startFuel: 100,
    target: { x: 1330, y: 250, r: 95 },
    pods: [{ x: 700, y: 620 }, { x: 1120, y: 330 }],
  },
  {
    id: 'm4',
    act: 1,
    name: { fa: 'والس هومان', en: 'The Hohmann Waltz' },
    briefing: {
      fa: 'مریخ در آن‌سوی گرانش خورشید منتظر است. والتر هومان در ۱۹۲۵ نشان داد ارزان‌ترین راه میان دو مدار، نیمی از یک بیضی است — اوج بگیر، سُر بخور، و فرمان‌دهی را به کشش خورشید بسپار.',
      en: 'Mars waits on the far shore of the Sun\'s gravity. Walter Hohmann showed in 1925 that the cheapest road between two orbits is half an ellipse — rise, coast, and let the Sun\'s pull do the steering.',
    },
    hint: { fa: 'به راست با اوجِ ملایم پرتاب کن؛ خورشید کمانِ مریخ را می‌تراشد.', en: 'Launch right with a gentle rise; the Sun carves the arc to Mars.' },
    bodies: [SUN(800, 640), EARTH(430, 620), MARS(1240, 470)],
    start: { x: 320, y: 640 },
    startFuel: 110,
    target: { x: 1330, y: 430, r: 90 },
    pods: [{ x: 700, y: 520 }, { x: 1080, y: 470 }],
  },

  // ------------------------------------------------ ACT II — THE GIANTS' LADDER
  {
    id: 'm5',
    act: 2,
    name: { fa: 'آینهٔ زهره', en: 'Venus Mirror' },
    briefing: {
      fa: 'خطِ مستقیم به رلهٔ ۵ از دل خورشید می‌گذرد. به‌جایش از پایینِ زهره سُر بخور — یک «یاری گرانشی» ذره‌ای از تکانهٔ مداری سیاره را می‌دزدد و مسیرت را بی‌هزینه می‌پیچاند.',
      en: 'The direct line to Relay 5 runs straight through the Sun. Swing low past Venus instead — a gravity assist steals a sliver of the planet\'s orbital momentum and bends your course for free.',
    },
    hint: { fa: 'به سوی خورشید سقوط کن، زیر زهره سُر بخور و از پیچش بیرون بیا.', en: 'Fall toward the Sun, skim below Venus, and fly out along the bend.' },
    bodies: [SUN(790, 560), VENUS(1060, 830)],
    start: { x: 300, y: 980 },
    startFuel: 110,
    target: { x: 1390, y: 260, r: 90 },
    pods: [{ x: 620, y: 880 }, { x: 1230, y: 700 }, { x: 1350, y: 420 }],
  },
  {
    id: 'm6',
    act: 2,
    name: { fa: 'از نردبان بالا', en: 'Climbing the Ladder' },
    briefing: {
      fa: 'مشتری پادشاه تاریکی بیرونی است. به سوی خورشید سقوط کن تا سرعت بگیری، آن‌گاه بگذار گرانش غول تو را به حیاطش فراخوانَد — هر پلهٔ نردبان غول‌ها با کشش است، نه با رانش.',
      en: 'Jupiter is king of the outer dark. Fall sunward to gather speed, then let the giant\'s gravity catch you into its courtyard — every rung of the giants\' ladder is pulled, not pushed.',
    },
    hint: { fa: 'به سوی خورشید بیفت تا تند شوی؛ طوری از مشتری بگذر که کششش تو را به درون بچرخاند.', en: 'Drop sunward for speed; pass Jupiter so its pull turns you in.' },
    bodies: [SUN(760, 900), JUPITER(1150, 380)],
    start: { x: 240, y: 480 },
    startFuel: 115,
    target: { x: 1330, y: 560, r: 100 },
    pods: [{ x: 560, y: 640 }, { x: 900, y: 480 }, { x: 1260, y: 700 }],
  },
  {
    id: 'm7',
    act: 2,
    name: { fa: 'سنگپرانی میان قمرها', en: 'Moon-Hop' },
    briefing: {
      fa: 'آیو و اروپا با سرعت‌هایی متفاوت گرد مشتری می‌تازند. یک نزدیک‌شدنِ خمیده می‌تواند مدار هر دو را ببوسد — برنامه‌ریزانِ مأموریت نامش را «گشتِ قمری» گذاشته‌اند و شاعران، پرتابِ سنگ بر آسمان.',
      en: 'Io and Europa race around Jupiter at different speeds. A single curved approach can kiss both orbits — mission planners call it a moon tour, poets call it stone-skipping across the sky.',
    },
    hint: { fa: 'از بالای آیو سُر بخور؛ بگذار مشتری مسیرت را به سوی اروپا و بیرون خم کند.', en: 'Skim past Io high; let Jupiter bend you down toward Europa and out.' },
    bodies: [JUPITER(790, 620), IO(790, 400), EUROPA(1040, 660)],
    start: { x: 230, y: 900 },
    startFuel: 115,
    target: { x: 1300, y: 330, r: 95 },
    pods: [{ x: 560, y: 700 }, { x: 860, y: 480 }, { x: 1120, y: 520 }],
  },
  {
    id: 'm8',
    act: 2,
    name: { fa: 'پژواک دور', en: 'The Long Echo' },
    briefing: {
      fa: 'کالیستو، قمرِ خاموش، برای کاوشگرهای بی‌صدای پردهٔ آخر پژواک می‌سازد. از بالای مشتری بپیچ و بگذار کشش عظیم سیاره نشانه‌ات کند — هر گرَزش، آینه‌ای است ساخته از گرانش.',
      en: 'Callisto, the quiet moon, relays for the silent probes of the final act. Curve around Jupiter\'s north and let the planet\'s immense pull aim you — a flyby is a mirror made of gravity.',
    },
    hint: { fa: 'از بالای مشتری بپیچ؛ همان چرخش تو را به پایین‌راست نشانه می‌رود.', en: 'Curve over Jupiter\'s top; the swing aims you at the bottom-right.' },
    bodies: [JUPITER(720, 740), CALLISTO(1060, 430)],
    start: { x: 220, y: 300 },
    startFuel: 110,
    target: { x: 1380, y: 880, r: 95 },
    pods: [{ x: 520, y: 520 }, { x: 940, y: 560 }, { x: 1220, y: 700 }],
  },
  {
    id: 'm9',
    act: 2,
    name: { fa: 'تاجِ حلقه‌ها', en: 'Crown of Rings' },
    briefing: {
      fa: 'حلقه‌های زحل آزمایشگاهِ گرانش‌اند: میلیاردها خرده‌یخ، هر یک بر مداری خویش. از کنار تیتان سُر بخور و به تاج نزدیک شو — رلهٔ ۹ در آن‌سویش پنهان است.',
      en: 'Saturn\'s rings are a laboratory of gravity: billions of ice shards, each on its own orbit. Slip past Titan and graze the crown — Relay 9 hides on its far side.',
    },
    hint: { fa: 'از زیر زحل بگذر و با فرصتِ کشش تیتان بیرون بزن.', en: 'Pass under Saturn and use Titan\'s pull to flick out.' },
    bodies: [SUN(330, 940), SATURN(980, 520), TITAN(1240, 330)],
    start: { x: 230, y: 230 },
    startFuel: 110,
    target: { x: 1360, y: 680, r: 95 },
    pods: [{ x: 560, y: 380 }, { x: 850, y: 620 }, { x: 1180, y: 500 }],
  },

  // ------------------------------------------------ ACT III — THE SILENT CHOIR
  {
    id: 'm10',
    act: 3,
    name: { fa: 'همسرِ خاموشان', en: 'Choir of the Silent' },
    briefing: {
      fa: 'اینجا خوابیده‌اند — کاوشگرانی که در توفان خاموش شدند و هنوز بیضی‌های بی‌نقصی را می‌پیمایند، بی‌هیچ شنونده‌ای. مدارشان گرد اورانوس را درِ کن بگیر و نخستین صدای همسر را بیدار کن.',
      en: 'Here they lie — probes that fell silent in the storm, still tracing perfect ellipses no one hears. Match their path around Uranus and wake the first voice of the choir.',
    },
    hint: { fa: 'از بالای اورانوس بپیچ؛ غرفه‌ها نشان‌گرِ راهِ همسرند.', en: 'Bend above Uranus; the pods mark the choir\'s path.' },
    bodies: [URANUS(1080, 420), MIRANDA(830, 570)],
    start: { x: 240, y: 880 },
    startFuel: 100,
    target: { x: 1330, y: 620, r: 90 },
    pods: [{ x: 540, y: 760 }, { x: 960, y: 500 }, { x: 1240, y: 790 }],
  },
  {
    id: 'm11',
    act: 3,
    name: { fa: 'شیرجهٔ اُبرت', en: 'The Oberth Dive' },
    briefing: {
      fa: 'سوخت کم است. هرمان اُبرت در ۱۹۲۹ ثابت کرد روشن‌کردن موتور در ژرفای چاهِ گرانش — آن‌جا که تندروترین لحظه است — از همان رانش، بیشترین انرژی می‌سازد. شیرجه بزن، در کف چاه بسوزان، و بر موجِ بازگشت سُر بخور.',
      en: 'Fuel is short. Hermann Oberth proved in 1929 that a burn made deep in a gravity well — where you are fastest — buys the most energy from the same push. Dive close, burn at the bottom, and surf the swing back out.',
    },
    hint: { fa: 'تقریباً مستقیم به سوی سیاره بینداز؛ در پایین‌ترین نقطه به سوی هدف سوخت بسوزان.', en: 'Fall nearly straight at the planet; at the lowest point burn toward the target.' },
    bodies: [WANDERER(820, 620)],
    start: { x: 240, y: 640 },
    startFuel: 45,
    target: { x: 1300, y: 250, r: 110 },
    pods: [{ x: 560, y: 620 }, { x: 700, y: 540 }, { x: 1180, y: 390 }],
  },
  {
    id: 'm12',
    act: 3,
    name: { fa: 'بیداریِ مناره', en: 'The Beacon Awakens' },
    briefing: {
      fa: 'در لبهٔ تاریکی، منارهٔ اصلیِ شبکهٔ هلیوگراف کنار نپتون منتظر است. از کشش تریتون بباف، آخرین غرفه‌ها را جمع کن و شبکه را دوباره روشن کن — چهار سال سکوت، با مسیرِ تو پایان می‌یابد.',
      en: 'At the edge of the dark, the Heliograph Array\'s master beacon waits by Neptune. Weave Triton\'s pull, gather the last pods, and light the network again — four years of silence end with your trajectory.',
    },
    hint: { fa: 'از تریتون برای نرم‌کردن گوشه استفاده کن؛ برای واپسین پیچ کمی سوخت نگه دار.', en: 'Use Triton to soften the corner; keep some fuel for the last turn.' },
    bodies: [NEPTUNE(980, 560), TRITON(740, 380)],
    start: { x: 210, y: 940 },
    startFuel: 120,
    target: { x: 1330, y: 240, r: 105 },
    pods: [{ x: 500, y: 800 }, { x: 860, y: 470 }, { x: 1150, y: 380 }],
  },
];

/* ---------------------------------------------- codex (real science) ---------------------------------------------- */

export interface CodexCard {
  id: string;
  icon: string;
  title: Bi;
  text: Bi;
}

export const CODEX: CodexCard[] = [
  {
    id: 'gravity',
    icon: '🌍',
    title: { fa: 'گرانش', en: 'Gravity' },
    text: {
      fa: 'هر جرم، هر جرمِ دیگر را با نیرویی می‌کشد که با جرم زیاد و با مربعِ فاصله کم می‌شود: F = GMm/r². مدار در حقیقت یک سقوطِ ابدی است که همیشه هدف را از دست می‌دهد.',
      en: 'Every mass pulls every other with a force that grows with mass and fades with the square of distance: F = GMm/r². An orbit is simply a fall that keeps missing its target.',
    },
  },
  {
    id: 'insertion',
    icon: '🛰️',
    title: { fa: 'درج در مدار', en: 'Orbit insertion' },
    text: {
      fa: 'برای ماندن در مدار باید سرعت افقی درست داشته باشد؛ کم باشد سقوط می‌کنی، زیاد باشد می‌گریزی. «درج در مدار» یعنی تنظیم همین تعادل میان سقوط و گریز.',
      en: 'Staying in orbit takes exactly the right horizontal speed: too slow and you fall, too fast and you escape. Orbit insertion is tuning that balance between falling and escaping.',
    },
  },
  {
    id: 'hohmann',
    icon: 'ellipse',
    title: { fa: 'انتقال هومان', en: 'Hohmann transfer' },
    text: {
      fa: 'ارزان‌ترین مسیر میان دو مدارِ دایره‌ای، نیمی از یک بیضیِ ممکن‌ترین است: یک بار شتاب، یک سُرِ بی‌موتور، و یک بار ترمز در مقصد. هومان این «والس» را در ۱۹۲۵ ریاضی‌ورز کرد.',
      en: 'The cheapest path between two circular orbits is half of a touching ellipse: one burn, one engine-off coast, one brake at arrival. Hohmann formalised this waltz in 1925.',
    },
  },
  {
    id: 'assist',
    icon: '🪐',
    title: { fa: 'یاریِ گرانشی', en: 'Gravity assist' },
    text: {
      fa: 'گذر از پشت سیاره‌ای که در مدارش می‌تازد، ذره‌ای از تکانهٔ مداری آن سیاره را به کاوشگر می‌دهد — وایجر ۲ با همین ترفند چهار غولِ بیرونی را در یک سفر دید. سیاره بی‌نهایت کوتاه می‌آید؛ کاوشگر هزاران کیلومتر برنده می‌شود.',
      en: 'Flying behind a moving planet hands the probe a sliver of that planet\'s orbital momentum — Voyager 2 toured all four giant planets this way. The planet slows imperceptibly; the probe gains thousands of m/s.',
    },
  },
  {
    id: 'oberth',
    icon: '🔥',
    title: { fa: 'اثر اُبرت', en: 'Oberth effect' },
    text: {
      fa: 'انرژی جنبشی با مربع سرعت است، پس یک روشن‌شدنِ کوتاه در تندروترین نقطهٔ مسیر — کف چاهِ گرانش — بیشترین انرژی را می‌سازد. اُبرت در ۱۹۲۹ آن را پیش از هر ماهواره‌ای حساب کرد.',
      en: 'Kinetic energy grows with the square of speed, so a short burn at the fastest point of your path — the bottom of the gravity well — yields the most energy. Oberth worked this out in 1929, before any satellite flew.',
    },
  },
];

/* ---------------------------------------------- pure physics ---------------------------------------------- */

export interface ProbeState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Σ GMᵢ·(rᵢ − r)/|rᵢ − r|³ with tiny Plummer softening for numerical safety. */
export function accelAt(x: number, y: number, bodies: Body[]): { ax: number; ay: number } {
  let ax = 0;
  let ay = 0;
  for (const b of bodies) {
    const dx = b.x - x;
    const dy = b.y - y;
    const d2 = dx * dx + dy * dy + SIM_SOFT2;
    const inv = b.gm / (d2 * Math.sqrt(d2));
    ax += dx * inv;
    ay += dy * inv;
  }
  return { ax, ay };
}

/** One semi-implicit (symplectic) Euler step: v ← v + a·dt, then x ← x + v·dt. */
export function stepProbe(p: ProbeState, bodies: Body[], dt: number, thrustX = 0, thrustY = 0): void {
  const a = accelAt(p.x, p.y, bodies);
  p.vx += (a.ax + thrustX) * dt;
  p.vy += (a.ay + thrustY) * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

export type PredictStatus = 'ok' | 'crash' | 'capture' | 'oob';

export interface PredictResult {
  pts: { x: number; y: number }[];
  status: PredictStatus;
  steps: number;
}

/** Is this world point inside a body (crash)? */
export function hitsBody(x: number, y: number, bodies: Body[], pad = 4): boolean {
  for (const b of bodies) {
    const dx = x - b.x;
    const dy = y - b.y;
    const rr = b.r + pad;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

/** Is this world point outside the board + OOB margin? */
export function outOfBounds(x: number, y: number): boolean {
  const mx = WORLD.w * OOB_MARGIN;
  const my = WORLD.h * OOB_MARGIN;
  return x < -mx || x > WORLD.w + mx || y < -my || y > WORLD.h + my;
}

/**
 * Live ballistic prediction while aiming — uses the exact same integrator as flight.
 * Records every 2nd step (≈30 Hz polyline), stops early on crash / capture / out-of-bounds.
 */
export function predictPath(x: number, y: number, vx: number, vy: number, bodies: Body[], target: Mission['target'], steps = PREDICT_STEPS): PredictResult {
  const p: ProbeState = { x, y, vx, vy };
  const pts: { x: number; y: number }[] = [{ x, y }];
  for (let i = 1; i <= steps; i++) {
    stepProbe(p, bodies, DT, 0, 0);
    if (i % 2 === 0) pts.push({ x: p.x, y: p.y });
    if (hitsBody(p.x, p.y, bodies)) return { pts, status: 'crash', steps: i };
    const tdx = p.x - target.x;
    const tdy = p.y - target.y;
    if (tdx * tdx + tdy * tdy < target.r * target.r) return { pts, status: 'capture', steps: i };
    if (outOfBounds(p.x, p.y)) return { pts, status: 'oob', steps: i };
  }
  return { pts, status: 'ok', steps };
}
