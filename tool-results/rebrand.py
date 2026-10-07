# -*- coding: utf-8 -*-
"""v0.1.0-alpha rebrand + i18n expansion for Duel of Thought"""
import io, re, sys

PATH = '/home/z/my-project/src/lib/i18n/index.ts'
src = io.open(PATH, encoding='utf-8').read()
orig = src

ZWNJ = '\u200c'

# ---------- 1. Global rebrand replacements ----------
repl = [
    # Persian: دوئل ایده‌ها -> دوئل اندیشه (with ZWNJ)
    ('دوئل ایده' + ZWNJ + 'ها', 'دوئل اندیشه'),
    # English
    ('Duel of Ideas', 'Duel of Thought'),
    # Arabic
    ('مبارزة الأفكار', 'مبارزة الفكر'),
    # Turkish
    ("Fikir D\u00fcellosu", "D\u00fc\u015f\u00fcnce D\u00fcellosu"),
    # made_with strings
    ('\u0637\u0631\u0627\u062d\u06cc\u200c\u0634\u062f\u0647 \u062a\u0648\u0633\u0637 \u0631\u06cc\u0627\u0636\u06cc\u200c\u062f\u0627\u0646\u0627\u0646 \u0648 \u067e\u0698\u0648\u0647\u0634\u06af\u0631\u0627\u0646 \u0622\u0645\u0648\u0632\u0634',
     '\u0633\u0627\u062e\u062a\u0647\u0654 \u0627\u0646\u062f\u06cc\u0634\u0647\u200c\u0646\u06af\u0627\u0631\u0627\u0646 \u0641\u0631\u062f\u0627\u06cc \u0634\u0631\u0642'),
    ('Designed by mathematicians & education researchers', 'Crafted by Thoughtkeepers of Tomorrow\u2019s East'),
    ('\u062a\u0635\u0645\u064a\u0645 \u0631\u064a\u0627\u0636\u064a\u064a\u0646 \u0648\u0628\u0627\u062d\u062b\u064a\u0646 \u0641\u064a \u062a\u0639\u0644\u064a\u0645 \u0627\u0644\u0631\u064a\u0627\u0636\u064a\u0627\u062a',
     '\u0645\u0646 \u0635\u0646\u0639 \u0631\u0639\u0627\u0629 \u0627\u0644\u0641\u0643\u0631 \u0644\u063a\u062f \u0627\u0644\u0634\u0631\u0642'),
    ('Matematik\u00e7iler ve e\u011fitim ara\u015ft\u0131rmac\u0131lar\u0131 taraf\u0131ndan tasarland\u0131',
     'Do\u011funun Yar\u0131n\u0131 D\u00fc\u015f\u00fcnce Muhaf\u0131zlar\u0131 eseridir'),
]
for a, b in repl:
    if a in src:
        src = src.replace(a, b)
    else:
        print('WARN not found:', a[:40])

# ---------- 2. New key blocks per locale ----------
FA = """
  /* ===== v0.1.0-alpha: brand + company ===== */
  company: 'اندیشه‌نگاران فردای شرق',
  company_en: 'Thoughtkeepers of Tomorrow\u2019s East',
  about_mission: 'مأموریت ما',
  about_mission_text: 'ما یک هیئت علمی صلح‌دوست هستیم؛ بر پایهٔ پژوهش‌های دانشگاهی، علوم شناختی و عصب‌شناسی، بازی‌هایی می‌سازیم که ذهن را می‌پرورانند، تمرکز را عمیق می‌کنند و یادگیری را به تجربه‌ای شادی‌بخش بدل می‌سازند.',
  about_team: 'تیم دانشگاهی',
  about_science: 'علم پشت بازی‌ها',
  team1_name: 'دکتر محمدعلی دهقان',
  team1_role: 'رئیس هیئت‌مدیره — دکترای آنالیز ریاضی',
  team2_name: 'دکتر احمد صفاپور',
  team2_role: 'نایب‌رئیس هیئت‌مدیره و مدیر عملیات — ریاضی محض (شیراز)، آنالیز هارمونیک (شهید باهنر کرمان)، دکترای فریم‌های فوریه (فردوسی مشهد) — طراح ارشد بازی',
  team3_name: 'دکتر مهدی کرمی رویین',
  team3_role: 'مدیرعامل و طراح ارشد بازی — دکترای سیستم‌های دینامیکی — طراح «دوئل اندیشه»',
  team4_name: 'دکتر مهران نجمو',
  team4_role: 'عضو هیئت‌مدیره — دکترای آنالیز عددی — طراح نرم‌افزار و مدل‌ساز سیستم‌ها',
  team5_name: 'دکتر علی ابراهیمی میمند',
  team5_role: 'عضو هیئت‌مدیره — دکترای آنالیز ریاضی',
  team6_name: 'دکتر مرتضی ساحلی',
  team6_role: 'بازرس هیئت‌مدیره — دکترای آنالیز ریاضی',
  team7_name: 'کیانوش صفاپور',
  team7_role: 'توسعه‌دهندهٔ ارشد بازی و طراح گرافیک — علوم کامپیوتر (افزلی‌پور کرمان)، معماری سامانه‌های رایانشی (بنت کرمانشاه) — مسئول فنی عملیات',

  /* ===== arcade ===== */
  arcade_title: 'بازی‌کدهٔ علمی', arcade_sub: 'چهار تجربهٔ علمی؛ یک ذهن',
  game_duel_tag: 'استراتژی اعداد',
  game_orbit: 'ادیسهٔ مداری', game_orbit_tag: 'مکانیک مداری واقعی',
  game_orbit_desc: 'کاوشگرهای خاموش را با کمک گرانش سیاره‌ها به خانه برسانید — فیزیک واقعی سفرهای فضایی.',
  game_synapse: 'سیناپس', game_synapse_tag: 'علوم اعصاب شناختی',
  game_synapse_desc: 'تمرین حافظهٔ فعال «ان‌بک دوتایی» — علم اثبات‌شدهٔ تقویت مغز، با کمپین کلینیک ذهن.',
  game_stellar: 'کورهٔ ستارگان', game_stellar_tag: 'فیزیک ستاره‌ای',
  game_stellar_desc: 'با همجوشی هسته‌ای عناصر بسازید: از هیدروژن تا آهن — و زندگی یک ستاره را کامل کنید.',
  campaign: 'کمپین داستانی', missions: 'مأموریت‌ها', mission: 'مأموریت', mission_locked: 'نخست مأموریت قبلی را کامل کنید',
  codex: 'دانش‌نامه', score: 'امتیاز', best_score: 'بهترین امتیاز', arcade_board: 'برترین‌های این بازی',
  arcade_done: 'پایان بازی!', arcade_reward: 'پاداش شما', arcade_again: 'دوباره', back_park: 'بازگشت به بازی‌کده',
  arcade_fuel: 'سوخت', arcade_launch: 'پرتاب', orbit_target: 'هدف', orbit_pods: 'غرفه‌های علمی',
  orbit_win: 'به مقصد رسیدیم!', orbit_crash: 'برخورد با جرم آسمانی!', orbit_lost: 'کاوشگر در فضا گم شد!',
  orbit_mission_complete: 'مأموریت کامل شد', orbit_next: 'مأموریت بعدی',
  synapse_n_back: 'سطح ان‌بک', synapse_position: 'مکان', synapse_audio: 'صدا', synapse_start: 'شروع جلسه',
  synapse_match: 'تطبیق دارد', synapse_no_match: 'ندارد', synapse_trial: 'کوشش', synapse_acc: 'دقت',
  synapse_day: 'روز برنامه', synapse_session_done: 'جلسهٔ تمرین کامل شد',
  stellar_mass: 'جرم ساخته‌شده', stellar_supernova: 'ابَرنواختر!', stellar_supernova_desc: 'هستهٔ آهنی ساخته شد — ستاره فروپاشید و عناصر را به کیهان بخشید',
  stellar_star: 'ستاره', stellar_epoch: 'دوران',

  /* ===== loot boxes ===== */
  box_title: 'صندوق‌های شانس', box_sub: 'شانست را بیازما؛ از معمولی تا نهایی',
  box_open: 'باز کردن', box_buy: 'خرید صندوق', box_inventory: 'صندوق‌های من', box_empty: 'صندوقی ندارید — از بازار بخرید یا منتظر هدیه بمانید',
  box_won_coins: 'سکهٔ نقد!', box_won_xp: 'تجربهٔ نقد!', box_won_item: 'آیتم کمیاب!', box_dupe: 'تکراری بود — معادلش سکه به شما رسید',
  box_odds: 'شانس‌ها', box_opening_anim: 'در حال گشودن…', box_congrats: 'شما بردید!',
  rarity_ULTIMATE: 'نهایی',
  market_tab_boxes: 'صندوق‌ها',

  /* ===== admin: enterprise ===== */
  admin_market: 'بازار و هدایا', admin_monitor: 'پایش زنده', admin_games: 'مدیریت بازی‌ها',
  gift_title: 'مرکز هدایا', gift_user: 'گیرنده (نام کاربری)', gift_all: 'هدیه به همهٔ بازیکنان',
  gift_coins: 'سکه', gift_xp: 'تجربه', gift_item: 'آیتم', gift_box: 'صندوق', gift_note: 'یادداشت (اختیاری)', gift_send: 'ارسال هدیه', gift_sent: 'هدیه ارسال شد',
  cheat_title: 'موتور توسعه‌دهنده', cheat_hint: 'ابزار داخلی تیم؛ همهٔ اقدامات در گزارش حسابرسی ثبت می‌شود',
  cheat_target: 'نام کاربری هدف', cheat_apply: 'اعمال', cheat_applied: 'اعمال شد',
  box_odds_editor: 'ویرایش شانس صندوق‌ها', box_drop_add: 'افزودن شانس', box_weight: 'وزن', box_kind: 'نوع',
  monitor_events: 'رویدادهای زنده', monitor_no_events: 'هنوز رویدادی نیست',
  games_toggle_hint: 'بازی‌های غیرفعال از پارک پنهان می‌شوند',
  e_gift_notfound: 'کاربر پیدا نشد', e_market_locked: 'این صندوق در دسترس نیست',
"""

EN = """
  /* ===== v0.1.0-alpha: brand + company ===== */
  company: 'Andisheh Negaran-e Fardaye Shargh',
  company_en: 'Thoughtkeepers of Tomorrow\u2019s East',
  about_mission: 'Our mission',
  about_mission_text: 'We are a pacifist academic team. Grounded in scholarly research, cognitive science and neuroscience, we build games that train the mind, deepen focus and turn learning into joy.',
  about_team: 'The academic team',
  about_science: 'The science behind the games',
  team1_name: 'Dr. MohammadAli Dehghan',
  team1_role: 'Chairman of the Board \u2014 PhD in Mathematical Analysis',
  team2_name: 'Dr. Ahmad Safapour',
  team2_role: 'Vice Chairman & Operations Manager \u2014 BSc Pure Math (Shiraz), MSc Harmonic Analysis (Shahid Bahonar, Kerman), PhD Fourier Frames (Ferdowsi, Mashhad) \u2014 Senior Game Designer',
  team3_name: 'Dr. Mehdi Karami Raviz',
  team3_role: 'CEO & Head Game Designer \u2014 PhD in Dynamical Systems \u2014 designer of \u201cDuel of Thought\u201d',
  team4_name: 'Dr. Mehran Namjoo',
  team4_role: 'Board Member \u2014 PhD in Numerical Analysis \u2014 software designer & mathematical systems modeling',
  team5_name: 'Dr. Ali Ebrahimi Meymand',
  team5_role: 'Board Member \u2014 PhD in Mathematical Analysis',
  team6_name: 'Dr. Morteza S\u0101heli',
  team6_role: 'Board Inspector \u2014 PhD in Mathematical Analysis',
  team7_name: 'Kianoosh Safapour',
  team7_role: 'Lead Video Game Developer & Graphic Designer \u2014 CS (Afzalipour, Kerman), Computer Systems Architecture (KUT, Kermanshah) \u2014 tech operations',

  /* ===== arcade ===== */
  arcade_title: 'Science Arcade', arcade_sub: 'Four experiences, one mind',
  game_duel_tag: 'Numbers strategy',
  game_orbit: 'Orbit Odyssey', game_orbit_tag: 'Real orbital mechanics',
  game_orbit_desc: 'Guide silent probes home using planetary gravity \u2014 the real physics of interplanetary travel.',
  game_synapse: 'Synapse', game_synapse_tag: 'Cognitive neuroscience',
  game_synapse_desc: 'Dual n-back working-memory training \u2014 proven brain science wrapped in the Mind Clinic campaign.',
  game_stellar: 'Stellar Forge', game_stellar_tag: 'Stellar astrophysics',
  game_stellar_desc: 'Forge elements through nuclear fusion: from hydrogen to iron \u2014 and complete the life of a star.',
  campaign: 'Campaign', missions: 'Missions', mission: 'Mission', mission_locked: 'Finish the previous mission first',
  codex: 'Codex', score: 'Score', best_score: 'Best score', arcade_board: 'Top players \u2014 this game',
  arcade_done: 'Run complete!', arcade_reward: 'Your rewards', arcade_again: 'Play again', back_park: 'Back to the Arcade',
  arcade_fuel: 'Fuel', arcade_launch: 'Launch', orbit_target: 'Target', orbit_pods: 'Science pods',
  orbit_win: 'Destination reached!', orbit_crash: 'Crashed into a celestial body!', orbit_lost: 'The probe drifted into deep space!',
  orbit_mission_complete: 'Mission complete', orbit_next: 'Next mission',
  synapse_n_back: 'N-back level', synapse_position: 'Position', synapse_audio: 'Sound', synapse_start: 'Start session',
  synapse_match: 'Match', synapse_no_match: 'No match', synapse_trial: 'Trial', synapse_acc: 'Accuracy',
  synapse_day: 'Program day', synapse_session_done: 'Training session complete',
  stellar_mass: 'Mass forged', stellar_supernova: 'Supernova!', stellar_supernova_desc: 'An iron core was forged \u2014 the star collapsed and seeded the cosmos with elements',
  stellar_star: 'Star', stellar_epoch: 'Epoch',

  /* ===== loot boxes ===== */
  box_title: 'Fortune Chests', box_sub: 'Try your luck \u2014 from Common to Ultimate',
  box_open: 'Open', box_buy: 'Buy chest', box_inventory: 'My chests', box_empty: 'No chests yet \u2014 buy some at the Bazaar or wait for a gift',
  box_won_coins: 'Coin jackpot!', box_won_xp: 'XP boost!', box_won_item: 'Rare item!', box_dupe: 'Duplicate \u2014 refunded as coins',
  box_odds: 'Odds', box_opening_anim: 'Opening\u2026', box_congrats: 'You won!',
  rarity_ULTIMATE: 'Ultimate',
  market_tab_boxes: 'Chests',

  /* ===== admin: enterprise ===== */
  admin_market: 'Market & Gifting', admin_monitor: 'Live monitor', admin_games: 'Game management',
  gift_title: 'Gifting center', gift_user: 'Recipient (username)', gift_all: 'Gift to ALL players',
  gift_coins: 'Coins', gift_xp: 'XP', gift_item: 'Item', gift_box: 'Chest', gift_note: 'Note (optional)', gift_send: 'Send gift', gift_sent: 'Gift sent',
  cheat_title: 'Developer Cheat Engine', cheat_hint: 'Internal team tool; every action is written to the audit log',
  cheat_target: 'Target username', cheat_apply: 'Apply', cheat_applied: 'Applied',
  box_odds_editor: 'Chest odds editor', box_drop_add: 'Add drop entry', box_weight: 'Weight', box_kind: 'Kind',
  monitor_events: 'Live events', monitor_no_events: 'No events yet',
  games_toggle_hint: 'Disabled games are hidden from the park',
  e_gift_notfound: 'User not found', e_market_locked: 'This chest is unavailable',
"""

AR = """
  /* ===== v0.1.0-alpha ===== */
  company: '\u0631\u0639\u0627\u0629 \u0627\u0644\u0641\u0643\u0631 \u0644\u063a\u062f \u0627\u0644\u0634\u0631\u0642',
  company_en: 'Thoughtkeepers of Tomorrow\u2019s East',
  about_mission: '\u0645\u0647\u0645\u062a\u0646\u0627',
  about_mission_text: '\u0646\u062d\u0646 \u0641\u0631\u064a\u0642 \u0623\u0643\u0627\u062f\u064a\u0645\u064a \u0633\u0644\u0645\u064a\u061b \u0628\u0627\u0644\u0627\u0633\u062a\u0646\u0627\u062f \u0625\u0644\u0649 \u0627\u0644\u0623\u0628\u062d\u0627\u062b \u0627\u0644\u0623\u0643\u0627\u062f\u064a\u0645\u064a\u0629 \u0648\u0639\u0644\u0648\u0645 \u0627\u0644\u0625\u062f\u0631\u0627\u0643 \u0648\u0627\u0644\u0639\u0644\u0648\u0645 \u0627\u0644\u0639\u0635\u0628\u064a\u0629\u060c \u0646\u0628\u0646\u064a \u0623\u0644\u0639\u0627\u0628\u064b\u0627 \u062a\u0646\u0645\u064a \u0627\u0644\u0639\u0642\u0644 \u0648\u062a\u0639\u0645\u0651\u0642 \u0627\u0644\u062a\u0631\u0643\u064a\u0632 \u0648\u062a\u062c\u0639\u0644 \u0627\u0644\u062a\u0639\u0644\u0645 \u0645\u062a\u0639\u0629.',
  about_team: '\u0627\u0644\u0641\u0631\u064a\u0642 \u0627\u0644\u0623\u0643\u0627\u062f\u064a\u0645\u064a',
  about_science: '\u0627\u0644\u0639\u0644\u0645 \u062e\u0644\u0641 \u0627\u0644\u0623\u0644\u0639\u0627\u0628',
  team1_name: '\u062f. \u0645\u062d\u0645\u062f\u0639\u0644\u064a \u062f\u0647\u0642\u0627\u0646',
  team1_role: '\u0631\u0626\u064a\u0633 \u0645\u062c\u0644\u0633 \u0627\u0644\u0625\u062f\u0627\u0631\u0629 \u2014 \u062f\u0643\u062a\u0648\u0631\u0627\u0647 \u0641\u064a \u0627\u0644\u062a\u062d\u0644\u064a\u0644 \u0627\u0644\u0631\u064a\u0627\u0636\u064a',
  team2_name: '\u062f. \u0623\u062d\u0645\u062f \u0635\u0641\u0627\u0628\u0648\u0631',
  team2_role: '\u0646\u0626\u064a\u0633 \u0645\u062c\u0644\u0633 \u0627\u0644\u0625\u062f\u0627\u0631\u0629 \u0648\u0645\u062f\u064a\u0631 \u0627\u0644\u0639\u0645\u0644\u064a\u0627\u062a \u2014 \u0631\u064a\u0627\u0636\u064a\u0627\u062a \u0635\u0627\u0631\u064a\u0629 (\u0634\u064a\u0631\u0627\u0632)\u060c \u062a\u062d\u0644\u064a\u0644 \u0647\u0627\u0631\u0645\u0648\u0646\u064a\u0643 (\u0634\u0647\u064a\u062f \u0628\u0627\u0647\u0646\u0631 \u0643\u0631\u0645\u0627\u0646)\u060c \u062f\u0643\u062a\u0648\u0631\u0627\u0647 \u0625\u0637\u0627\u0631 \u0641\u0648\u0631\u064a\u064a\u0647 (\u0641\u0631\u062f\u0648\u0633\u064a \u0645\u0634\u0647\u062f) \u2014 \u0645\u0635\u0645\u0645 \u0623\u0644\u0639\u0627\u0628 \u0623\u0639\u0644\u0649',
  team3_name: '\u062f. \u0645\u0647\u062f\u064a \u0643\u0631\u0645\u064a \u0631\u0648\u064a\u064a\u0646',
  team3_role: '\u0627\u0644\u0631\u0626\u064a\u0633 \u0627\u0644\u062a\u0646\u0641\u064a\u0630\u064a \u0648\u0627\u0644\u0645\u0635\u0645\u0645 \u0627\u0644\u0631\u0626\u064a\u0633\u064a \u2014 \u062f\u0643\u062a\u0648\u0631\u0627\u0647 \u0641\u064a \u0627\u0644\u0646\u0638\u0645 \u0627\u0644\u062f\u064a\u0646\u0627\u0645\u064a\u0643\u064a\u0629 \u2014 \u0645\u0635\u0645\u0645 \u00ab\u0645\u0628\u0627\u0631\u0632\u0629 \u0627\u0644\u0641\u0643\u0631\u00bb',
  team4_name: '\u062f. \u0645\u0647\u0631\u0627\u0646 \u0646\u062c\u0645\u0648',
  team4_role: '\u0639\u0636\u0648 \u0645\u062c\u0644\u0633 \u0627\u0644\u0625\u062f\u0627\u0631\u0629 \u2014 \u062f\u0643\u062a\u0648\u0631\u0627\u0647 \u0641\u064a \u0627\u0644\u062a\u062d\u0644\u064a\u0644 \u0627\u0644\u0639\u062f\u062f\u064a \u2014 \u0645\u0635\u0645\u0645 \u0628\u0631\u0645\u062c\u064a\u0627\u062a \u0648\u0645\u0646\u0645\u0630\u062c\u0629 \u0627\u0644\u0623\u0646\u0638\u0645\u0629',
  team5_name: '\u062f. \u0639\u0644\u064a \u0625\u0628\u0631\u0627\u0647\u064a\u0645\u064a \u0645\u064a\u0645\u0646\u062f',
  team5_role: '\u0639\u0636\u0648 \u0645\u062c\u0644\u0633 \u0627\u0644\u0625\u062f\u0627\u0631\u0629 \u2014 \u062f\u0643\u062a\u0648\u0631\u0627\u0647 \u0641\u064a \u0627\u0644\u062a\u062d\u0644\u064a\u0644 \u0627\u0644\u0631\u064a\u0627\u0636\u064a',
  team6_name: '\u062f. \u0645\u0631\u062a\u0636\u0649 \u0633\u0627\u062d\u0644\u064a',
  team6_role: '\u0645\u0641\u062a\u0634 \u0645\u062c\u0644\u0633 \u0627\u0644\u0625\u062f\u0627\u0631\u0629 \u2014 \u062f\u0643\u062a\u0648\u0631\u0627\u0647 \u0641\u064a \u0627\u0644\u062a\u062d\u0644\u064a\u0644 \u0627\u0644\u0631\u064a\u0627\u0636\u064a',
  team7_name: '\u0643\u064a\u0627\u0646\u0648\u0634 \u0635\u0641\u0627\u0628\u0648\u0631',
  team7_role: '\u0627\u0644\u0645\u0637\u0648\u0631 \u0627\u0644\u0631\u0626\u064a\u0633\u064a \u0644\u0644\u0623\u0644\u0639\u0627\u0628 \u0648\u0645\u0635\u0645\u0645 \u0627\u0644\u062c\u0631\u0627\u0641\u064a\u0643 \u2014 \u0639\u0644\u0648\u0645 \u0627\u0644\u062d\u0627\u0633\u0648\u0628 (\u0623\u0641\u0632\u0644\u064a\u0628\u0648\u0631 \u0643\u0631\u0645\u0627\u0646)\u060c \u0645\u0639\u0645\u0627\u0631\u064a \u0627\u0644\u0623\u0646\u0638\u0645\u0629 (\u0643\u0631\u0645\u0627\u0646\u0634\u0627\u0647) \u2014 \u0627\u0644\u0639\u0645\u0644\u064a\u0627\u062a \u0627\u0644\u062a\u0642\u0646\u064a\u0629',

  /* ===== arcade ===== */
  arcade_title: '\u0623\u0631\u0643\u0627\u062f \u0627\u0644\u0639\u0644\u0648\u0645', arcade_sub: '\u0623\u0631\u0628\u0639 \u062a\u062c\u0627\u0631\u0628 \u0639\u0644\u0645\u064a\u0629\u061b \u0639\u0642\u0644 \u0648\u0627\u062d\u062f',
  game_duel_tag: '\u0627\u0633\u062a\u0631\u0627\u062a\u064a\u062c\u064a\u0627 \u0627\u0644\u0623\u0631\u0642\u0627\u0645',
  game_orbit: '\u0623\u0648\u062f\u064a\u0633\u0629 \u0627\u0644\u0645\u062f\u0627\u0631', game_orbit_tag: '\u0645\u064a\u0643\u0627\u0646\u064a\u0643\u0627 \u0645\u062f\u0627\u0631\u064a\u0629 \u062d\u0642\u064a\u0642\u064a\u0629',
  game_orbit_desc: '\u0623\u0639\u062f \u0627\u0644\u0645\u0633\u062a\u0643\u0634\u0641\u0627\u062a \u0627\u0644\u0635\u0627\u0645\u062a\u0629 \u0625\u0644\u0649 \u0627\u0644\u0645\u0646\u0632\u0644 \u0628\u0645\u0633\u0627\u0639\u062f\u0629 \u062c\u0630\u0628 \u0627\u0644\u0643\u0648\u0627\u0643\u0628 \u2014 \u0641\u064a\u0632\u064a\u0627\u0621 \u0627\u0644\u0633\u0641\u0631 \u0627\u0644\u0641\u0636\u0627\u0626\u064a \u0627\u0644\u062d\u0642\u064a\u0642\u064a\u0629.',
  game_synapse: '\u0633\u064a\u0646\u0627\u0628\u0633', game_synapse_tag: '\u0639\u0644\u0648\u0645 \u0627\u0644\u0623\u0639\u0635\u0627\u0628 \u0627\u0644\u0645\u0639\u0631\u0641\u064a\u0629',
  game_synapse_desc: '\u062a\u062f\u0631\u064a\u0628 \u0627\u0644\u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u0639\u0627\u0645\u0644\u0629 \u00ab\u0625\u0646-\u0628\u0627\u0643 \u0627\u0644\u0645\u0632\u062f\u0648\u062c\u00bb \u2014 \u0639\u0644\u0645 \u0645\u062b\u0628\u062a \u0644\u062a\u0642\u0648\u064a\u0629 \u0627\u0644\u062f\u0645\u0627\u063a \u0628\u062d\u0645\u0644\u0629 \u0639\u064a\u0627\u062f\u0629 \u0627\u0644\u0639\u0642\u0644.',
  game_stellar: '\u0641\u0631\u0646 \u0627\u0644\u0646\u062c\u0648\u0645', game_stellar_tag: '\u0641\u064a\u0632\u064a\u0627\u0621 \u0627\u0644\u0646\u062c\u0648\u0645',
  game_stellar_desc: '\u0627\u0635\u0646\u0639 \u0627\u0644\u0639\u0646\u0627\u0635\u0631 \u0628\u0627\u0644\u0627\u0646\u062f\u0645\u0627\u062c \u0627\u0644\u0646\u0648\u0648\u064a: \u0645\u0646 \u0627\u0644\u0647\u064a\u062f\u0631\u0648\u062c\u064a\u0646 \u0625\u0644\u0649 \u0627\u0644\u062d\u062f\u064a\u062f \u2014 \u0648\u0623\u0643\u0645\u0644 \u062d\u064a\u0627\u0629 \u0646\u062c\u0645.',
  campaign: '\u0627\u0644\u062d\u0645\u0644\u0629', missions: '\u0627\u0644\u0645\u0647\u0627\u0645', mission: '\u0645\u0647\u0645\u0629', mission_locked: '\u0623\u0643\u0645\u0644 \u0627\u0644\u0645\u0647\u0645\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629 \u0623\u0648\u0644\u064b\u0627',
  codex: '\u0645\u0648\u0633\u0648\u0639\u0629', score: '\u0627\u0644\u0646\u0642\u0627\u0637', best_score: '\u0623\u0641\u0636\u0644 \u0646\u062a\u064a\u062c\u0629', arcade_board: '\u0623\u0641\u0636\u0644 \u0627\u0644\u0644\u0627\u0639\u0628\u064a\u0646 \u2014 \u0647\u0630\u0647 \u0627\u0644\u0644\u0639\u0628\u0629',
  arcade_done: '\u0627\u0646\u062a\u0647\u062a \u0627\u0644\u062c\u0648\u0644\u0629!', arcade_reward: '\u062c\u0648\u0627\u0626\u0632\u0643', arcade_again: '\u0645\u0631\u0629 \u0623\u062e\u0631\u0649', back_park: '\u0639\u0648\u062f\u0629 \u0625\u0644\u0649 \u0627\u0644\u0623\u0631\u0643\u0627\u062f',
  arcade_fuel: '\u0627\u0644\u0648\u0642\u0648\u062f', arcade_launch: '\u0625\u0637\u0644\u0627\u0642', orbit_target: '\u0627\u0644\u0647\u062f\u0641', orbit_pods: '\u0645\u062c\u0633\u0627\u062a \u0639\u0644\u0645\u064a\u0629',
  orbit_win: '\u0648\u0635\u0644\u0646\u0627 \u0625\u0644\u0649 \u0627\u0644\u0647\u062f\u0641!', orbit_crash: '\u0627\u0635\u0637\u062f\u0645 \u0628\u062c\u0633\u0645 \u0633\u0645\u0627\u0648\u064a!', orbit_lost: '\u0627\u0644\u0645\u0633\u062a\u0643\u0634\u0641 \u062a\u0627\u0626\u0647 \u0641\u064a \u0627\u0644\u0641\u0636\u0627\u0621!',
  orbit_mission_complete: '\u062a\u0645\u062a \u0627\u0644\u0645\u0647\u0645\u0629', orbit_next: '\u0627\u0644\u0645\u0647\u0645\u0629 \u0627\u0644\u062a\u0627\u0644\u064a\u0629',
  synapse_n_back: '\u0645\u0633\u062a\u0648\u0649 \u0625\u0646-\u0628\u0627\u0643', synapse_position: '\u0627\u0644\u0645\u0643\u0627\u0646', synapse_audio: '\u0627\u0644\u0635\u0648\u062a', synapse_start: '\u0627\u0628\u062f\u0623 \u0627\u0644\u062c\u0644\u0633\u0629',
  synapse_match: '\u0645\u0637\u0627\u0628\u0642\u0629', synapse_no_match: '\u0644\u0627', synapse_trial: '\u0645\u062d\u0627\u0648\u0644\u0629', synapse_acc: '\u0627\u0644\u062f\u0642\u0629',
  synapse_day: '\u064a\u0648\u0645 \u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062c', synapse_session_done: '\u0627\u0643\u062a\u0645\u0644\u062a \u062c\u0644\u0633\u0629 \u0627\u0644\u062a\u062f\u0631\u064a\u0628',
  stellar_mass: '\u0627\u0644\u0643\u062a\u0644\u0629 \u0627\u0644\u0645\u0635\u0646\u0648\u0639\u0629', stellar_supernova: '\u0645\u0633\u062a\u0639\u0631 \u0639\u0638\u0645!', stellar_supernova_desc: '\u062a\u0643\u0648\u0646 \u0646\u0648\u0627\u0629 \u062d\u062f\u064a\u062f\u064a\u0629 \u2014 \u0627\u0646\u0647\u0627\u0631 \u0627\u0644\u0646\u062c\u0645 \u0648\u0623\u0647\u062f\u0649 \u0627\u0644\u0639\u0646\u0627\u0635\u0631 \u0625\u0644\u0649 \u0627\u0644\u0643\u0648\u0646',
  stellar_star: '\u0627\u0644\u0646\u062c\u0645', stellar_epoch: '\u0627\u0644\u0639\u0635\u0631',

  /* ===== loot boxes ===== */
  box_title: '\u0635\u0646\u0627\u062f\u064a\u0642 \u0627\u0644\u062d\u0638', box_sub: '\u062c\u0631\u0651\u0628 \u062d\u0638\u0643 \u2014 \u0645\u0646 \u0627\u0644\u0639\u0627\u062f\u064a \u0625\u0644\u0649 \u0627\u0644\u0623\u0633\u0645\u0649',
  box_open: '\u0627\u0641\u062a\u062d', box_buy: '\u0627\u0634\u062a\u0631 \u0635\u0646\u062f\u0648\u0642', box_inventory: '\u0635\u0646\u0627\u062f\u064a\u0642\u064a', box_empty: '\u0644\u0627 \u0635\u0646\u0627\u062f\u064a\u0642 \u0628\u0639\u062f \u2014 \u0627\u0634\u062a\u0631 \u0645\u0646 \u0627\u0644\u0633\u0648\u0642 \u0623\u0648 \u0627\u0646\u062a\u0638\u0631 \u0647\u062f\u064a\u0629',
  box_won_coins: '\u062c\u0627\u0626\u0632\u0629 \u0639\u0645\u0644\u0627\u062a!', box_won_xp: '\u062e\u0628\u0631\u0629!', box_won_item: '\u0639\u0646\u0635\u0631 \u0646\u0627\u062f\u0631!', box_dupe: '\u0645\u0643\u0631\u0631 \u2014 \u0623\u064f\u0639\u064a\u062f \u0643\u0639\u0645\u0644\u0627\u062a',
  box_odds: '\u0627\u0644\u0641\u0631\u0635', box_opening_anim: '\u062c\u0627\u0631\u064d \u0627\u0644\u0641\u062a\u062d\u2026', box_congrats: '\u0644\u062f\u064a\u0643 \u0641\u0648\u0632!',
  rarity_ULTIMATE: '\u0623\u0633\u0645\u0649',
  market_tab_boxes: '\u0627\u0644\u0635\u0646\u0627\u062f\u064a\u0642',

  /* ===== admin ===== */
  admin_market: '\u0627\u0644\u0633\u0648\u0642 \u0648\u0627\u0644\u0647\u062f\u0627\u064a\u0627', admin_monitor: '\u0627\u0644\u0645\u0631\u0627\u0642\u0628\u0629 \u0627\u0644\u062d\u064a\u0629', admin_games: '\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0623\u0644\u0639\u0627\u0628',
  gift_title: '\u0645\u0631\u0643\u0632 \u0627\u0644\u0647\u062f\u0627\u064a\u0627', gift_user: '\u0627\u0644\u0645\u0633\u062a\u0644\u0645 (\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645)', gift_all: '\u0647\u062f\u064a\u0629 \u0644\u062c\u0645\u064a\u0639 \u0627\u0644\u0644\u0627\u0639\u0628\u064a\u0646',
  gift_coins: '\u0639\u0645\u0644\u0627\u062a', gift_xp: '\u062e\u0628\u0631\u0629', gift_item: '\u0639\u0646\u0635\u0631', gift_box: '\u0635\u0646\u062f\u0648\u0642', gift_note: '\u0645\u0644\u0627\u062d\u0638\u0629 (\u0627\u062e\u062a\u064a\u0627\u0631\u064a)', gift_send: '\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0647\u062f\u064a\u0629', gift_sent: '\u0623\u064f\u0631\u0633\u0644\u062a \u0627\u0644\u0647\u062f\u064a\u0629',
  cheat_title: '\u0645\u062d\u0631\u0643 \u0627\u0644\u0645\u0637\u0648\u0631\u064a\u0646', cheat_hint: '\u0623\u062f\u0627\u0629 \u062f\u0627\u062e\u0644\u064a\u0629\u061b \u0643\u0644 \u0625\u062c\u0631\u0627\u0621 \u064a\u0633\u062c\u0644 \u0641\u064a \u0633\u062c\u0644 \u0627\u0644\u062a\u062f\u0642\u064a\u0642',
  cheat_target: '\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0627\u0644\u0647\u062f\u0641', cheat_apply: '\u062a\u0637\u0628\u064a\u0642', cheat_applied: '\u062a\u0645 \u0627\u0644\u062a\u0637\u0628\u064a\u0642',
  box_odds_editor: '\u0645\u062d\u0631\u0631 \u0641\u0631\u0635 \u0627\u0644\u0635\u0646\u0627\u062f\u064a\u0642', box_drop_add: '\u0625\u0636\u0627\u0641\u0629 \u0641\u0631\u0635\u0629', box_weight: '\u0627\u0644\u0648\u0632\u0646', box_kind: '\u0627\u0644\u0646\u0648\u0639',
  monitor_events: '\u0623\u062d\u062f\u0627\u062b \u062d\u064a\u0629', monitor_no_events: '\u0644\u0627 \u0623\u062d\u062f\u0627\u062b \u0628\u0639\u062f',
  games_toggle_hint: '\u0627\u0644\u0623\u0644\u0639\u0627\u0628 \u0627\u0644\u0645\u0639\u0637\u0651\u0644\u0629 \u062a\u062e\u062a\u0641\u064a \u0645\u0646 \u0627\u0644\u0623\u0631\u0643\u0627\u062f',
  e_gift_notfound: '\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f', e_market_locked: '\u0647\u0630\u0627 \u0627\u0644\u0635\u0646\u062f\u0648\u0642 \u063a\u064a\u0631 \u0645\u062a\u0627\u062d',
"""

TR = """
  /* ===== v0.1.0-alpha ===== */
  company: 'Andişe Negaran-ı Fedayi Şark',
  company_en: 'Thoughtkeepers of Tomorrow\u2019s East',
  about_mission: 'Misyonumuz',
  about_mission_text: 'Bar\u0131\u015f\u00e7\u0131 bir akademik ekibiz. Akademik ara\u015ft\u0131rmalara, bili\u015fsel ve sinir bilimine dayanarak zihni e\u011fiten, oda\u011f\u0131 derinle\u015ftiren ve \u00f6\u011frenmeyi keyfe d\u00f6n\u00fc\u015ft\u00fcren oyunlar tasarlıyoruz.',
  about_team: 'Akademik ekip',
  about_science: 'Oyunların ardındaki bilim',
  team1_name: 'Dr. MohammadAli Dehghan',
  team1_role: 'Yönetim Kurulu Başkanı \u2014 Matematiksel Analiz Doktorası',
  team2_name: 'Dr. Ahmad Safapour',
  team2_role: 'Yönetim Kurulu Başkan Yardımcısı ve Operasyon Müdürü \u2014 Saf Matematik (Şiraz), Harmonik Analiz (Şehid Bahonar, Kerman), Fourier Çerçeveleri Doktorası (Ferdousi, Mashhad) \u2014 Kıdemli Oyun Tasarımcısı',
  team3_name: 'Dr. Mehdi Karami Raviz',
  team3_role: 'CEO ve Baş Oyun Tasarımcısı \u2014 Dinamik Sistemler Doktorası \u2014 \u201cDüşünce Düellosu\u201d tasarımcısı',
  team4_name: 'Dr. Mehran Namjoo',
  team4_role: 'Yönetim Kurulu Üyesi \u2014 Sayısal Analiz Doktorası \u2014 Yazılım tasarımcısı ve matematiksel sistem modelleme',
  team5_name: 'Dr. Ali Ebrahimi Meymand',
  team5_role: 'Yönetim Kurulu Üyesi \u2014 Matematiksel Analiz Doktorası',
  team6_name: 'Dr. Morteza S\u0101heli',
  team6_role: 'Yönetim Kurulu Denetçisi \u2014 Matematiksel Analiz Doktorası',
  team7_name: 'Kianoosh Safapour',
  team7_role: 'Baş Video Oyunu Geliştiricisi ve Grafik Tasarımcı \u2014 Bilgisayar Bilimleri (Afzalipour, Kerman), Bilgisayar Sistemleri Mimarisi (KUT, Kermanşah) \u2014 teknik operasyonlar',

  /* ===== arcade ===== */
  arcade_title: 'Bilim Arena\u2019sı', arcade_sub: 'Dört deneyim, tek zihin',
  game_duel_tag: 'Sayı stratejisi',
  game_orbit: 'Yörünge Odise\u2019si', game_orbit_tag: 'Gerçek yörünge mekaniği',
  game_orbit_desc: 'Gezegen yerçekimini kullanarak sessiz sondaları eve götür \u2014 gezegenler arası yolculuğun gerçek fiziği.',
  game_synapse: 'Sinaps', game_synapse_tag: 'Bilişsel sinir bilimi',
  game_synapse_desc: '\u201c\u0130kili n-back\u201d çalışma belleği antrenmanı \u2014 Zihin Kliniği kampanyasıyla kanıtlanmış beyin bilimi.',
  game_stellar: 'Yıldız Ocağı', game_stellar_tag: 'Yıldız astrofiziği',
  game_stellar_desc: 'Nükleer füzyonla element döv: hidrojenden demire \u2014 ve bir yıldızın yaşamını tamamla.',
  campaign: 'Kampanya', missions: 'Görevler', mission: 'Görev', mission_locked: 'Önce önceki görevi tamamla',
  codex: 'Kodeks', score: 'Puan', best_score: 'En iyi puan', arcade_board: 'Bu oyunun en iyileri',
  arcade_done: 'Tur tamamlandı!', arcade_reward: 'Ödüllerin', arcade_again: 'Tekrar oyna', back_park: 'Arena\u2019ya dön',
  arcade_fuel: 'Yakıt', arcade_launch: 'Fırlat', orbit_target: 'Hedef', orbit_pods: 'Bilim kapsülleri',
  orbit_win: 'Varış noktasına ulaşıldı!', orbit_crash: 'Gök cismine çarıldı!', orbit_lost: 'Sonda derin uzayda kayboldu!',
  orbit_mission_complete: 'Görev tamamlandı', orbit_next: 'Sonraki görev',
  synapse_n_back: 'N-back seviyesi', synapse_position: 'Konum', synapse_audio: 'Ses', synapse_start: 'Seansı başlat',
  synapse_match: 'Eşleşme', synapse_no_match: 'Yok', synapse_trial: 'Deneme', synapse_acc: 'Doğruluk',
  synapse_day: 'Program günü', synapse_session_done: 'Antrenman seansı tamamlandı',
  stellar_mass: 'Dövülen kütle', stellar_supernova: 'Süpernova!', stellar_supernova_desc: 'Demir çekirdek dövüldü \u2014 yıldız çöktü ve evrene elementler armağan etti',
  stellar_star: 'Yıldız', stellar_epoch: 'Çağ',

  /* ===== loot boxes ===== */
  box_title: 'Talih Sandıkları', box_sub: 'Şansını dene \u2014 sıradandan nihaiye',
  box_open: 'Aç', box_buy: 'Sandık satın al', box_inventory: 'Sandıklarım', box_empty: 'Henüz sandık yok \u2014 Çarşı\u2019dan al ya da hediyeyi bekle',
  box_won_coins: 'Altın vurgunu!', box_won_xp: 'XP bonusu!', box_won_item: 'Nadir öğe!', box_dupe: 'Tekrarlandı \u2014 altınla iade edildi',
  box_odds: 'Şanslar', box_opening_anim: 'Açılıyor\u2026', box_congrats: 'Kazandın!',
  rarity_ULTIMATE: 'Nihai',
  market_tab_boxes: 'Sandıklar',

  /* ===== admin ===== */
  admin_market: 'Pazar ve Hediyeler', admin_monitor: 'Canlı izleme', admin_games: 'Oyun yönetimi',
  gift_title: 'Hediye merkezi', gift_user: 'Alıcı (kullanıcı adı)', gift_all: 'TÜM oyunculara hediye',
  gift_coins: 'Altın', gift_xp: 'XP', gift_item: 'Öğe', gift_box: 'Sandık', gift_note: 'Not (isteğe bağlı)', gift_send: 'Hediyeyi gönder', gift_sent: 'Hediye gönderildi',
  cheat_title: 'Geliştirici Hile Motoru', cheat_hint: 'Dahili ekip aracı; her işlem denetim kaydına yazılır',
  cheat_target: 'Hedef kullanıcı adı', cheat_apply: 'Uygula', cheat_applied: 'Uygulandı',
  box_odds_editor: 'Sandık şans düzenleyici', box_drop_add: 'Şans ekle', box_weight: 'Ağırlık', box_kind: 'Tür',
  monitor_events: 'Canlı olaylar', monitor_no_events: 'Henüz olay yok',
  games_toggle_hint: 'Devre dışı oyunlar arenadan gizlenir',
  e_gift_notfound: 'Kullanıcı bulunamadı', e_market_locked: 'Bu sandık kullanılamıyor',
"""

# fa: insert before closing '} as const;'
anchor = '} as const;'
i = src.index(anchor)
src = src[:i] + FA + '\n' + src[i:]

# en: insert before 'const ar: Dict = {'
anchor = 'const ar: Dict = {'
i = src.index(anchor)
src = src[:i] + EN + '\n' + src[i:]

# ar: insert before 'const tr: Dict = {'
anchor = 'const tr: Dict = {'
i = src.index(anchor)
src = src[:i] + AR + '\n' + src[i:]

# tr: insert before 'export const DICTIONARIES'
anchor = 'export const DICTIONARIES'
i = src.index(anchor)
src = src[:i] + TR + '\n' + src[i:]

io.open(PATH, 'w', encoding='utf-8').write(src)
print('OK — i18n updated, size', len(src))

# ---------- 3. layout.tsx metadata ----------
LP = '/home/z/my-project/src/app/layout.tsx'
l = io.open(LP, encoding='utf-8').read()
l = l.replace('Duel of Ideas', 'Duel of Thought')
l = l.replace('\u062f\u0648\u0626\u0644 \u0627\u06cc\u062f\u0647' + ZWNJ + '\u0647\u0627', '\u062f\u0648\u0626\u0644 \u0627\u0646\u062f\u06cc\u0634\u0647')
l = l.replace('\u0646\u0628\u0631\u062f \u0627\u0633\u062a\u0631\u0627\u062a\u0698\u06cc\u06a9 \u0627\u0639\u062f\u0627\u062f \u2014 \u0637\u0631\u0627\u062d\u06cc \u0631\u06cc\u0627\u0636\u06cc\u200c\u062f\u0627\u0646\u0627\u0646 \u0627\u06cc\u0631\u0627\u0646\u06cc | A strategic numbers duel designed by Iranian mathematicians',
              '\u062f\u0648\u0626\u0644 \u0627\u0646\u062f\u06cc\u0634\u0647 \u2014 \u0633\u0627\u062e\u062a\u0647\u0654 \u0627\u0646\u062f\u06cc\u0634\u0647\u200c\u0646\u06af\u0627\u0631\u0627\u0646 \u0641\u0631\u062f\u0627\u06cc \u0634\u0631\u0642 | Duel of Thought by Thoughtkeepers of Tomorrow\u2019s East \u2014 a science-backed mind games park')
io.open(LP, 'w', encoding='utf-8').write(l)
print('OK — layout.tsx updated')
