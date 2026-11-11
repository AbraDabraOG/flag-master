/* Flag Master — game logic */
(() => {
'use strict';

// ---------- utilities ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const h = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = n => Math.floor(Math.random() * n);
const pick = arr => arr[rand(arr.length)];
const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const fmtTime = ms => { const s = Math.round(ms / 1000); if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return `${m}m ${s % 60}s`; return `${Math.floor(m / 60)}h ${m % 60}m`; };
const fmtDate = ts => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^the /, '');
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}

// ---------- data ----------
const D = FLAG_DATA;
const FLAG_BY_ID = Object.fromEntries(D.all.map(f => [f.id, f]));
const GAME_FLAGS = D.all.filter(f => f.group !== 'hate');   // hate symbols stay out of collection goals
const CATS = D.CATEGORIES;
const catById = id => CATS.find(c => c.id === id);

// Four kinds of quiz share one engine. Each keeps its own mastery per place:
// flags use the plain id, capitals, map and shapes use 'cap:<id>' / 'map:<id>' / 'shp:<id>'.
const MAP_OK = !!(window.FMMap && FMMap.ready);
const SHAPES = window.FM_SHAPES || {};
const MAP_SKIP_CATS = new Set(['everything', 'us-all', 'us-terr', 'uk', 'hist', 'hist-europe', 'hist-world']);
const KINDS = {
  flags: { view: 'play', title: 'Flags', has: () => true, intro: 'Pick a category. Flags you miss come back more often until you know them cold.', unit: 'flag' },
  capitals: { view: 'capitals', title: 'Capitals', has: f => !!f.capital, intro: 'Capitals of countries, states and territories. The ones you miss come back more often.', unit: 'capital' },
  shapes: { view: 'shapes', title: 'Shapes', has: f => !!SHAPES[f.id], intro: 'Just the outline: no neighbours, no labels. Name the place it belongs to. Historical ones use their old borders.', unit: 'shape' },
  map: { view: 'map', title: 'Globe', has: f => MAP_OK && FMMap.has(f.id) && FMMap.mapFor(f.id) != null && f.group !== 'uk', intro: 'Get a name or a flag, then find it on the globe. Drag to spin, scroll to zoom.', unit: 'place' },
};
const K_PREFIX = { capitals: 'cap:', map: 'map:', shapes: 'shp:' };
const K = (kind, f) => kind === 'flags' ? f.id : K_PREFIX[kind] + f.id;
const universeCache = {};
const universe = kind => universeCache[kind] || (universeCache[kind] = D.all.filter(KINDS[kind].has));
function catsFor(kind) {
  if (kind === 'flags') return CATS;
  if (kind === 'capitals') return CATS.filter(c => c.section !== 'History' && c.flags().some(f => f.capital));
  if (kind === 'shapes') return CATS.filter(c => c.flags().filter(KINDS.shapes.has).length >= 4);
  return CATS.filter(c => !MAP_SKIP_CATS.has(c.id) && c.flags().filter(KINDS.map.has).length >= 4);
}

// ---------- persistent state ----------
const KEY = 'flagmaster.v1';
const defaultState = () => ({
  v: 1, xp: 0, flags: {},
  totals: { answered: 0, correct: 0, sessions: 0, timeMs: 0, studyRatings: 0, typeCorrect: 0, pickCorrect: 0, lightningBest: 0, fastCorrect: 0, capCorrect: 0, mapCorrect: 0, shapeCorrect: 0, histCorrect: 0, triviaPlays: 0, hopPlays: 0, mystPlays: 0 },
  bestStreak: 0, days: {}, dayStreak: 0, lastDay: null,
  ach: {}, cats: {}, modes: {}, typedIds: {}, comebacks: 0, trivia: {},
  hop: { plays: 0, wins: 0, pars: 0, inline: 0, daily: {} }, myst: { plays: 0, wins: 0, dist: {} },
  settings: { sound: true, autoAdvance: true, theme: 'dark', facts: true },
});
let S = defaultState();
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const parsed = JSON.parse(raw); S = Object.assign(defaultState(), parsed); S.settings = Object.assign(defaultState().settings, parsed.settings || {}); S.totals = Object.assign(defaultState().totals, parsed.totals || {}); } } catch (e) { S = defaultState(); }
}
let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }, 150); }

// ---------- per-flag stats & scheduling ----------
const INTERVALS = [0, 5 * MIN, 30 * MIN, DAY, 3 * DAY, 7 * DAY];
const stat = id => S.flags[id];
function ensureStat(id) { return S.flags[id] || (S.flags[id] = { s: 0, c: 0, w: 0, st: 0, bs: 0, box: 0, last: 0, due: 0, conf: {}, ms: 0, n: 0 }); }
function masteryOf(st) {
  if (!st || !st.s) return 'unseen';
  if (st.box >= 5) return 'mastered';
  if (st.box >= 4) return 'known';
  if (st.box >= 2) return 'familiar';
  return 'learning';
}
const MASTERY_LABEL = { unseen: 'New', learning: 'Learning', familiar: 'Familiar', known: 'Known', mastered: 'Mastered' };
const MASTERY_CLASS = { unseen: 'mu', learning: 'm0', familiar: 'm2', known: 'm4', mastered: 'm5' };
const isMastered = id => { const st = stat(id); return !!st && st.box >= 4; };
const countMasteredK = (list, kind) => list.filter(f => isMastered(K(kind, f))).length;
function needsWork(st, now) {
  if (!st || !st.s) return false;
  if (st.box <= 2) return true;
  if (st.w > 0 && st.w / (st.c + st.w) >= 0.3) return true;
  return st.box < 5 && now >= st.due;
}
function weightOf(id, now) {
  const st = stat(id);
  if (!st || !st.s) return 2.5;
  let w = [5, 3.5, 2.2, 1.2, 0.6, 0.35][st.box];
  if (now >= st.due) w *= 1.6;
  w += 2 * (st.w / (st.c + st.w));
  if (now - st.last < 90 * 1000 && st.st > 0) w *= 0.1;
  return w;
}
function weightedPick(pool, now, recent, kind = 'flags') {
  const weights = pool.map(f => recent.has(f.id) ? 0 : weightOf(K(kind, f), now));
  let total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) { return pick(pool); }
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}
function buildQueue(pool, n, kind) {
  const now = Date.now();
  const out = [];
  let recent = new Set();
  while (out.length < n) {
    if (recent.size >= pool.length) recent = new Set(out.slice(-Math.min(5, pool.length - 1)).map(f => f.id));
    const f = weightedPick(pool, now, recent, kind);
    out.push(f); recent.add(f.id);
  }
  return out;
}
function recordAnswer(flag, correct, pickedId, ms, kind = 'flags') {
  const st = ensureStat(K(kind, flag));
  const wasStruggling = st.w >= 3 && st.box <= 1;
  st.s++; st.last = Date.now();
  if (correct) { st.c++; st.st++; st.bs = Math.max(st.bs, st.st); st.box = Math.min(5, st.box + 1); }
  else { st.w++; st.st = 0; st.box = st.box >= 3 ? 1 : 0; if (pickedId && pickedId !== flag.id) st.conf[pickedId] = (st.conf[pickedId] || 0) + 1; }
  st.due = st.last + INTERVALS[st.box];
  if (ms != null && ms < 30000) { st.n++; st.ms = st.ms + (ms - st.ms) / st.n; }
  if (correct && wasStruggling) S.comebacks++;
  return { comeback: correct && wasStruggling };
}
function reviewPool(kind = 'flags') {
  const now = Date.now();
  return universe(kind).filter(f => needsWork(stat(K(kind, f)), now));
}
function poolFor(catId, kind = 'flags') {
  if (catId === 'review') return reviewPool(kind);
  return catById(catId).flags().filter(KINDS[kind].has);
}
function catName(catId) { return catId === 'review' ? 'Smart Review' : catById(catId).name; }
const catKey = (kind, catId) => kind === 'flags' ? catId : kind + ':' + catId;

// ---------- XP & levels ----------
const TITLES = ['Recruit', 'Cadet', 'Scout', 'Navigator', 'Surveyor', 'Cartographer', 'Envoy', 'Attaché', 'Consul', 'Ambassador', 'Diplomat', 'Vexillologist', 'Grand Vexillologist', 'Flag Sage', 'World Master'];
const xpForLevel = L => Math.round(120 * Math.pow(L - 1, 1.5));
function levelInfo(xp) {
  let L = 1; while (xpForLevel(L + 1) <= xp) L++;
  const start = xpForLevel(L), next = xpForLevel(L + 1);
  return { level: L, title: TITLES[Math.min(TITLES.length - 1, Math.floor((L - 1) / 2))], into: xp - start, need: next - start, next };
}
function addXp(n) {
  const before = levelInfo(S.xp).level;
  S.xp += n;
  const after = levelInfo(S.xp);
  if (after.level > before) { toast('level', '▲', 'Level up', `Level ${after.level} · ${after.title}`); sound('level'); }
  renderLevelCard();
}

// ---------- achievements ----------
const regionMastered = region => D.countries.filter(f => f.region === region).every(f => isMastered(f.id));
const subMastered = sub => D.countries.filter(f => f.sub === sub).every(f => isMastered(f.id));
const countMastered = list => list.filter(f => isMastered(f.id)).length;
const ACH = [
  { id: 'first', icon: '🚩', name: 'First Steps', desc: 'Answer your first question.', check: () => S.totals.answered >= 1 },
  { id: 'c10', icon: '✅', name: 'Warming Up', desc: '10 correct answers.', prog: () => [S.totals.correct, 10] },
  { id: 'c100', icon: '💯', name: 'Century', desc: '100 correct answers.', prog: () => [S.totals.correct, 100] },
  { id: 'c1000', icon: '🏆', name: 'Thousand Club', desc: '1,000 correct answers.', prog: () => [S.totals.correct, 1000] },
  { id: 'c5000', icon: '👑', name: 'Five Thousand', desc: '5,000 correct answers.', prog: () => [S.totals.correct, 5000] },
  { id: 's10', icon: '🔥', name: 'On a Roll', desc: 'Streak of 10 correct in a row.', prog: () => [S.bestStreak, 10] },
  { id: 's25', icon: '🔥', name: 'Unstoppable', desc: 'Streak of 25.', prog: () => [S.bestStreak, 25] },
  { id: 's50', icon: '☄️', name: 'Inferno', desc: 'Streak of 50.', prog: () => [S.bestStreak, 50] },
  { id: 's100', icon: '🌋', name: 'Flawless Hundred', desc: 'Streak of 100.', prog: () => [S.bestStreak, 100] },
  { id: 'p10', icon: '🎯', name: 'Clean Sheet', desc: 'Perfect round of 10 or more.', check: (c) => c.sessionEnd && c.session.perfect && c.session.answered >= 10 },
  { id: 'p20', icon: '🎯', name: 'Sharpshooter', desc: 'Perfect round of 20 or more.', check: (c) => c.sessionEnd && c.session.perfect && c.session.answered >= 20 },
  { id: 'p50', icon: '🎯', name: 'Dead Eye', desc: 'Perfect round of 50 or more.', check: (c) => c.sessionEnd && c.session.perfect && c.session.answered >= 50 },
  { id: 'fast', icon: '⚡', name: 'Speed Demon', desc: '100 correct answers in under 2 seconds each.', prog: () => [S.totals.fastCorrect, 100] },
  { id: 'l20', icon: '⏱️', name: 'Lightning Rod', desc: '20 correct in one Lightning round.', prog: () => [S.totals.lightningBest, 20] },
  { id: 'l35', icon: '🌩️', name: 'Storm Chaser', desc: '35 correct in one Lightning round.', prog: () => [S.totals.lightningBest, 35] },
  { id: 'type50', icon: '⌨️', name: 'Typist', desc: '50 correct answers in Type It mode.', prog: () => [S.totals.typeCorrect, 50] },
  { id: 'typed100', icon: '📝', name: 'Spelling Bee', desc: 'Type the names of 100 different flags correctly.', prog: () => [Object.keys(S.typedIds).length, 100] },
  { id: 'pick50', icon: '👁️', name: 'Eagle Eye', desc: '50 correct answers in Pick the Flag mode.', prog: () => [S.totals.pickCorrect, 50] },
  { id: 'comeback', icon: '💪', name: 'Comeback', desc: 'Get a flag right after missing it 3+ times.', prog: () => [S.comebacks, 1] },
  { id: 'comeback10', icon: '🦾', name: 'Redemption Arc', desc: '10 comebacks on flags that were giving you trouble.', prog: () => [S.comebacks, 10] },
  { id: 'seen-all', icon: '🧭', name: 'Collector', desc: 'See every flag in the game at least once.', prog: () => [GAME_FLAGS.filter(f => stat(f.id)?.s).length, GAME_FLAGS.length] },
  { id: 'explorer', icon: '🗺️', name: 'Explorer', desc: 'Play every continent category.', prog: () => [['africa', 'asia', 'europe', 'namerica', 'samerica', 'oceania'].filter(c => S.cats[c]?.plays).length, 6] },
  { id: 'm-eu', icon: '🏰', name: 'Europe Expert', desc: 'Master every European flag.', prog: () => [countMastered(D.countries.filter(f => f.region === 'Europe')), 46] },
  { id: 'm-af', icon: '🦁', name: 'Africa Expert', desc: 'Master every African flag.', prog: () => [countMastered(D.countries.filter(f => f.region === 'Africa')), 54] },
  { id: 'm-as', icon: '🏯', name: 'Asia Expert', desc: 'Master every Asian flag.', prog: () => [countMastered(D.countries.filter(f => f.region === 'Asia')), 48] },
  { id: 'm-na', icon: '🌴', name: 'North America Expert', desc: 'Master every North American flag.', prog: () => [countMastered(D.countries.filter(f => f.region === 'North America')), 23] },
  { id: 'm-sa', icon: '🦜', name: 'South America Expert', desc: 'Master every South American flag.', prog: () => [countMastered(D.countries.filter(f => f.region === 'South America')), 12] },
  { id: 'm-oc', icon: '🏝️', name: 'Oceania Expert', desc: 'Master every Oceanian flag.', prog: () => [countMastered(D.countries.filter(f => f.region === 'Oceania')), 14] },
  { id: 'm-nordic', icon: '❄️', name: 'Nordic Cross', desc: 'Master all Nordic & Baltic flags.', prog: () => [countMastered(D.countries.filter(f => f.sub === 'Nordic & Baltic')), 8] },
  { id: 'm-carib', icon: '🚢', name: 'Caribbean Cruise', desc: 'Master all Caribbean flags.', prog: () => [countMastered(D.countries.filter(f => f.sub === 'Caribbean')), 13] },
  { id: 'm-us', icon: '🇺🇸', name: 'Fifty Nifty', desc: 'Master all 50 state flags.', prog: () => [countMastered(D.states), 50] },
  { id: 'm-us-all', icon: '🦅', name: 'Sea to Shining Sea', desc: 'Master all states, D.C. and territories.', prog: () => [countMastered([...D.states, ...D.usTerr]), 56] },
  { id: 'm-world', icon: '🌍', name: 'Citizen of the World', desc: 'Master all 197 sovereign flags.', prog: () => [countMastered(D.countries), 197] },
  { id: 'm-all', icon: '🪐', name: 'Vexillological Legend', desc: 'Master every flag in the game.', prog: () => [countMastered(GAME_FLAGS), GAME_FLAGS.length] },
  { id: 'd3', icon: '📅', name: 'Habit Forming', desc: 'Play 3 days in a row.', prog: () => [S.dayStreak, 3] },
  { id: 'd7', icon: '🗓️', name: 'Weekly Ritual', desc: 'Play 7 days in a row.', prog: () => [S.dayStreak, 7] },
  { id: 'd30', icon: '🏅', name: 'Iron Discipline', desc: 'Play 30 days in a row.', prog: () => [S.dayStreak, 30] },
  { id: 'marathon', icon: '🏃', name: 'Marathon', desc: '100 questions in a single session.', check: (c) => c.session && c.session.answered >= 100 },
  { id: 'study50', icon: '📚', name: 'Bookworm', desc: 'Rate 50 flashcards in Study mode.', prog: () => [S.totals.studyRatings, 50] },
  { id: 'night', icon: '🦉', name: 'Night Owl', desc: 'Answer a question between midnight and 4 a.m.', check: () => { const hr = new Date().getHours(); return hr >= 0 && hr < 4; } },
  { id: 'early', icon: '🐦', name: 'Early Bird', desc: 'Answer a question between 5 and 7 a.m.', check: () => { const hr = new Date().getHours(); return hr >= 5 && hr < 7; } },
  { id: 'lv10', icon: '🎓', name: 'Scholar', desc: 'Reach level 10.', prog: () => [levelInfo(S.xp).level, 10] },
  { id: 'lv25', icon: '🧙', name: 'Grandmaster', desc: 'Reach level 25.', prog: () => [levelInfo(S.xp).level, 25] },
  // History
  { id: 'hist25', icon: '📜', name: 'Time Traveler', desc: '25 correct answers on historical flags.', prog: () => [S.totals.histCorrect, 25] },
  { id: 'm-hist-eu', icon: '🏛️', name: 'Old World Order', desc: 'Master every historical European flag.', prog: () => [countMastered(catById('hist-europe').flags()), catById('hist-europe').flags().length] },
  { id: 'm-hist', icon: '⏳', name: 'History Buff', desc: 'Master every historical flag.', prog: () => [countMastered(D.historical), D.historical.length] },
  // Capitals
  { id: 'cap25', icon: '🏙️', name: 'Capital Gains', desc: '25 correct capitals.', prog: () => [S.totals.capCorrect, 25] },
  { id: 'cap250', icon: '🏛', name: 'Seat of Power', desc: '250 correct capitals.', prog: () => [S.totals.capCorrect, 250] },
  { id: 'cap-eu', icon: '🗼', name: 'Grand Tour', desc: 'Master every European capital.', prog: () => [countMasteredK(D.countries.filter(f => f.region === 'Europe'), 'capitals'), 46] },
  { id: 'cap-us', icon: '🏢', name: 'State House', desc: 'Master all 50 state capitals.', prog: () => [countMasteredK(D.states, 'capitals'), 50] },
  { id: 'cap-world', icon: '🌐', name: 'World Capitals', desc: 'Master the capital of all 197 countries.', prog: () => [countMasteredK(D.countries, 'capitals'), 197] },
  // Globe
  { id: 'map25', icon: '📍', name: 'Pin Drop', desc: 'Find 25 places on the map.', prog: () => [S.totals.mapCorrect, 25] },
  { id: 'map250', icon: '🧳', name: 'Globetrotter', desc: 'Find 250 places on the map.', prog: () => [S.totals.mapCorrect, 250] },
  { id: 'map-us', icon: '🗽', name: 'Coast to Coast', desc: 'Master all 50 states on the map.', prog: () => [countMasteredK(D.states, 'map'), 50] },
  { id: 'map-af', icon: '🐘', name: 'Africa Mapped', desc: 'Master every African country on the globe.', prog: () => [countMasteredK(D.countries.filter(f => f.region === 'Africa'), 'map'), 54] },
  // Shapes
  { id: 'shp25', icon: '🧩', name: 'Silhouette Spotter', desc: 'Name 25 places from their outline.', prog: () => [S.totals.shapeCorrect, 25] },
  { id: 'shp250', icon: '🔍', name: 'Outline Oracle', desc: 'Name 250 places from their outline.', prog: () => [S.totals.shapeCorrect, 250] },
  { id: 'shp-eu', icon: '🧭', name: 'Shape of Europe', desc: 'Master the outline of every European country.', prog: () => [countMasteredK(D.countries.filter(f => f.region === 'Europe' && SHAPES[f.id]), 'shapes'), D.countries.filter(f => f.region === 'Europe' && SHAPES[f.id]).length] },
  { id: 'shp-us', icon: '🦬', name: 'State Lines', desc: 'Master the outline of all 50 states.', prog: () => [countMasteredK(D.states, 'shapes'), 50] },
  { id: 'shp-hist', icon: '🏺', name: 'Lost Borders', desc: 'Master every historical outline.', prog: () => [countMasteredK(D.historical.filter(f => SHAPES[f.id]), 'shapes'), D.historical.filter(f => SHAPES[f.id]).length] },
  // Trivia
  { id: 'triv1', icon: '🧠', name: 'Quiz Night', desc: 'Finish your first trivia quiz.', prog: () => [S.totals.triviaPlays, 1] },
  { id: 'triv25', icon: '🍻', name: 'Pub Quiz Regular', desc: 'Finish 25 trivia quizzes.', prog: () => [S.totals.triviaPlays, 25] },
  { id: 'trivp5', icon: '🤓', name: 'Know-It-All', desc: 'Get a perfect score on 5 different trivia quizzes.', prog: () => [TRIVIA.filter(q => S.trivia[q.id]?.perfect).length, 5] },
  { id: 'trivpall', icon: '📚', name: 'Walking Encyclopedia', desc: 'Get a perfect score on every trivia quiz.', prog: () => [TRIVIA.filter(q => S.trivia[q.id]?.perfect).length, TRIVIA.length] },
  { id: 'triv-us', icon: '🗽', name: 'Fifty for Fifty', desc: 'Name all 50 states in one go.', prog: () => [S.trivia['all-us']?.best || 0, 50] },
  { id: 'triv-world', icon: '🌏', name: 'Name the World', desc: 'Name all 197 countries in one go.', prog: () => [S.trivia['all-world']?.best || 0, 197] },
  // Border Hop & Mystery Country
  { id: 'hop1', icon: '🧳', name: 'Passport Stamped', desc: 'Finish your first Border Hop route.', prog: () => [S.hop.wins, 1] },
  { id: 'hop-par10', icon: '⛳', name: 'Under Control', desc: 'Make par on 10 Border Hop routes.', prog: () => [S.hop.pars, 10] },
  { id: 'hop-line10', icon: '📏', name: 'Straight Shooter', desc: 'Finish 10 routes going in line the whole way.', prog: () => [S.hop.inline, 10] },
  { id: 'hop-daily7', icon: '🗓️', name: 'Daily Traveller', desc: 'Complete 7 daily routes.', prog: () => [Object.values(S.hop.daily).filter(d => d.won).length, 7] },
  { id: 'myst1', icon: '🕵️', name: 'Detective', desc: 'Solve your first Mystery Country.', prog: () => [S.myst.wins, 1] },
  { id: 'myst-first', icon: '🎯', name: 'One Clue Wonder', desc: 'Solve a Mystery Country on the very first clue.', prog: () => [S.myst.dist[1] || 0, 1] },
  { id: 'myst50', icon: '🔎', name: 'Super Sleuth', desc: 'Solve 50 Mystery Countries.', prog: () => [S.myst.wins, 50] },
  { id: 'map-world', icon: '🛰️', name: 'Cartographer\'s Eye', desc: 'Master all 197 countries on the globe.', prog: () => [countMasteredK(D.countries, 'map'), 197] },
];
function checkAchievements(ctx = {}) {
  const unlocked = [];
  for (const a of ACH) {
    if (S.ach[a.id]) continue;
    let ok = false;
    if (a.prog) { const [cur, max] = a.prog(); ok = cur >= max; }
    if (!ok && a.check) ok = !!a.check(ctx);
    if (ok) { S.ach[a.id] = Date.now(); unlocked.push(a); }
  }
  if (unlocked.length) {
    unlocked.forEach((a, i) => setTimeout(() => toast('ach', a.icon, 'Achievement unlocked', a.name), i * 400));
    sound('ach');
    addXp(25 * unlocked.length);
    save();
  }
  return unlocked;
}

// ---------- sound ----------
let audio = null;
function sound(kind) {
  if (!S.settings.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const note = (f, start, dur, type = 'sine', vol = 0.08) => { const o = audio.createOscillator(), g = audio.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t + start); g.gain.linearRampToValueAtTime(vol, t + start + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur); o.connect(g); g.connect(audio.destination); o.start(t + start); o.stop(t + start + dur + 0.05); };
    if (kind === 'good') { note(660, 0, 0.12); note(880, 0.1, 0.18); }
    else if (kind === 'bad') { note(220, 0, 0.25, 'square', 0.04); note(180, 0.12, 0.3, 'square', 0.04); }
    else if (kind === 'ach') { [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.09, 0.3, 'triangle', 0.07)); }
    else if (kind === 'level') { [392, 523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.08, 0.35, 'triangle', 0.07)); }
    else if (kind === 'tick') { note(1200, 0, 0.04, 'square', 0.02); }
    else if (kind === 'end') { note(523, 0, 0.2, 'triangle'); note(392, 0.18, 0.35, 'triangle'); }
  } catch (e) {}
}

// ---------- toasts ----------
function toast(kind, icon, title, text) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind === 'level' ? 'level' : kind === 'plain' ? 'plain' : '');
  el.innerHTML = `<div class="ico">${h(icon)}</div><div><div class="t">${h(title)}</div><div class="n">${h(text)}</div></div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, 3800);
}

// ---------- daily streak ----------
function touchDay() {
  const today = todayKey();
  if (S.lastDay !== today) {
    const yesterday = todayKey(new Date(Date.now() - DAY));
    S.dayStreak = S.lastDay === yesterday ? S.dayStreak + 1 : 1;
    S.lastDay = today;
  }
  S.days[today] = (S.days[today] || 0) + 1;
}

// ---------- modes ----------
// ask: what the question shows · ans: how you answer
const MODES = {
  mc: { kind: 'flags', key: '1', name: 'Multiple Choice', desc: 'See a flag, pick its name from four options.', mult: 1, ask: 'flag', ans: 'name' },
  pick: { kind: 'flags', key: '2', name: 'Pick the Flag', desc: 'See a name, pick the right flag from four.', mult: 1.2, ask: 'name', ans: 'flag' },
  type: { kind: 'flags', key: '3', name: 'Type It', desc: 'See a flag, type the name. Spelling is forgiving.', mult: 1.6, ask: 'flag', ans: 'type' },
  lightning: { kind: 'flags', key: '4', name: 'Lightning', desc: '60 seconds. As many flags as you can.', mult: 1.1, ask: 'flag', ans: 'name', timed: true },
  capmc: { kind: 'capitals', key: '1', name: 'Name the Capital', desc: 'See a place, pick its capital from four.', mult: 1, ask: 'place', ans: 'capital' },
  caprev: { kind: 'capitals', key: '2', name: 'Whose Capital?', desc: 'See a capital, pick the place it belongs to.', mult: 1.1, ask: 'capital', ans: 'name' },
  captype: { kind: 'capitals', key: '3', name: 'Type the Capital', desc: 'See a place, type its capital. Spelling is forgiving.', mult: 1.6, ask: 'place', ans: 'type' },
  caplight: { kind: 'capitals', key: '4', name: 'Capital Lightning', desc: '60 seconds. As many capitals as you can.', mult: 1.1, ask: 'place', ans: 'capital', timed: true },
  mapname: { kind: 'map', key: '1', name: 'Find It', desc: 'See a name, click that place on the map.', mult: 1.3, ask: 'name', ans: 'map' },
  mapflag: { kind: 'map', key: '2', name: 'Flag Drop', desc: 'See a flag, click its country on the map.', mult: 1.5, ask: 'flag', ans: 'map' },
  shptype: { kind: 'shapes', key: '1', name: 'Type It', desc: 'See an outline, type the place. Spelling is forgiving.', mult: 1.6, ask: 'shape', ans: 'type' },
  shpmc: { kind: 'shapes', key: '2', name: 'Multiple Choice', desc: 'See an outline, pick its name from four.', mult: 1.1, ask: 'shape', ans: 'name' },
  shppick: { kind: 'shapes', key: '3', name: 'Pick the Shape', desc: 'See a name, pick its outline from four.', mult: 1.3, ask: 'name', ans: 'shape' },
  shplight: { kind: 'shapes', key: '4', name: 'Shape Lightning', desc: '60 seconds. As many outlines as you can.', mult: 1.2, ask: 'shape', ans: 'name', timed: true },
  maplight: { kind: 'map', key: '3', name: 'Map Lightning', desc: '60 seconds. Find as many as you can.', mult: 1.2, ask: 'name', ans: 'map', timed: true },
};
const BASE_MODE = { flags: 'mc', capitals: 'capmc', map: 'mapname', shapes: 'shptype' };
const modesOf = kind => Object.entries(MODES).filter(([, m]) => m.kind === kind);

// ---------- app shell ----------
let view = 'play';
let session = null;
window.__fmSession = () => session; // read-only peek for build/smoke2.js
let setup = { catId: null, mode: { ...BASE_MODE }, length: 20 };
const main = $('#main');

function applyTheme() { document.documentElement.setAttribute('data-theme', S.settings.theme); }

// Backups: the desktop app uses native file dialogs (preload); the Android app
// writes a file and opens the share sheet; a browser / iPhone home-screen app
// shares or downloads the file. Import uses a file picker everywhere but desktop.
const BACKUP_NAME = 'flag-master-progress.json';
async function exportBackup(json) {
  if (window.flagMaster) return window.flagMaster.exportProgress(json);
  const P = window.Capacitor?.Plugins;
  if (P?.Filesystem && P?.Share) {
    try {
      const w = await P.Filesystem.writeFile({ path: BACKUP_NAME, data: json, directory: 'CACHE', encoding: 'utf8' });
      await P.Share.share({ title: 'Flag Master progress', files: [w.uri] });
      return { ok: true, path: 'Saved or sent from the share menu' };
    } catch (e) { if (/cancel/i.test(String(e?.message || e))) return { ok: false }; }
  }
  const file = new File([json], BACKUP_NAME, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Flag Master progress' }); return { ok: true, path: 'Saved or sent from the share menu' }; }
    catch (e) { if (e?.name === 'AbortError') return { ok: false }; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = BACKUP_NAME;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return { ok: true, path: BACKUP_NAME + ' downloaded' };
}
function importBackup() {
  if (window.flagMaster) return window.flagMaster.importProgress();
  return new Promise(resolve => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json,text/plain';
    inp.addEventListener('change', async () => { const f = inp.files?.[0]; if (!f) return resolve({ ok: false }); try { resolve({ ok: true, json: await f.text() }); } catch (e) { resolve({ ok: false }); } });
    inp.addEventListener('cancel', () => resolve({ ok: false }));
    inp.click();
  });
}

function renderLevelCard() {
  const li = levelInfo(S.xp);
  $('#levelCard').innerHTML = `
    <div class="lvl"><div><span class="eyebrow">Level</span> <b>${li.level}</b></div><div class="title">${h(li.title)}</div></div>
    <div class="bar"><i style="width:${pct(li.into, li.need)}%"></i></div>
    <div class="xp"><span>${S.xp.toLocaleString()} XP</span><span>${(li.need - li.into).toLocaleString()} to next</span></div>
    <div class="day-streak">🔥 <b>${S.dayStreak}</b> day streak</div>`;
}

function go(v) {
  if (session && !session.done && v !== 'quiz') { endSession(true); }
  if (trivia && !trivia.done && v !== 'trivia-play') stopTrivia();
  if (hop && hop.map && v !== 'hop-play') { hop.map.destroy(); hop.map = null; }
  view = v;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v || (b.dataset.view === 'trivia' && v.startsWith('trivia')) || v === b.dataset.view + '-play'));
  main.scrollTop = 0;
  ({ play: () => renderHub('flags'), capitals: () => renderHub('capitals'), map: () => renderHub('map'), shapes: () => renderHub('shapes'), quiz: renderQuiz, results: renderResults, study: renderStudy, stats: renderStats, achievements: renderAchievements, settings: renderSettings, trivia: renderTrivia, 'trivia-play': renderTriviaPlay, 'trivia-results': renderTriviaResults, hop: renderHop, 'hop-play': renderHopPlay, mystery: renderMystery, 'mystery-play': renderMystPlay })[v]();
}
$$('.nav-btn').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));

// ---------- mastery summaries ----------
function summarize(pool, kind = 'flags') {
  const c = { unseen: 0, learning: 0, familiar: 0, known: 0, mastered: 0 };
  pool.forEach(f => c[masteryOf(stat(K(kind, f)))]++);
  return c;
}
function masteryBar(pool, kind = 'flags') {
  const c = summarize(pool, kind), n = pool.length || 1;
  return `<div class="mbar"><i class="m5" style="width:${100 * c.mastered / n}%"></i><i class="m4" style="width:${100 * c.known / n}%"></i><i class="m2" style="width:${100 * c.familiar / n}%"></i><i class="m0" style="width:${100 * c.learning / n}%"></i></div>`;
}

// ---------- PLAY view ----------
function renderHub(kind) {
  const KD = KINDS[kind];
  if (kind === 'map' && !MAP_OK) { main.innerHTML = `<div class="view"><div class="view-head"><div><h1>Globe</h1></div></div><p class="map-unavailable">The map data did not load. Reinstalling Flag Master should fix this.</p></div>`; return; }
  const review = reviewPool(kind);
  const cats = catsFor(kind);
  const sections = [...new Set(cats.map(c => c.section))];
  const sample = shuffle(review).slice(0, 8);
  const unit = n => `${KD.unit}${n === 1 ? '' : 's'}`;
  main.innerHTML = `<div class="view">
    <div class="view-head"><div><h1>${h(KD.title)}</h1><p>${h(KD.intro)}</p></div></div>
    <div class="hero">
      <div>
        <div class="eyebrow">Smart Review</div>
        <h2>${review.length ? `${review.length} ${unit(review.length)} need${review.length === 1 ? 's' : ''} work` : 'Nothing is due for review'}</h2>
        <p class="muted">${review.length ? 'The ones you keep missing, plus anything due for a refresher.' : 'Play a few rounds and your weak spots will show up here.'}</p>
        <div class="hero-flags">${sample.map(f => thumbOf(f, kind, true)).join('')}</div>
      </div>
      <div style="display:grid;gap:10px;justify-items:end">
        <div class="big">${review.length}</div>
        <button class="btn primary lg" id="reviewBtn" ${review.length ? '' : 'disabled'}>Review now</button>
      </div>
    </div>
    ${sections.map(sec => `<div class="section"><div class="eyebrow">${h(sec)}</div><div class="cat-grid">${cats.filter(c => c.section === sec).map(c => catCard(c, kind)).join('')}</div></div>`).join('')}
  </div>`;
  $('#reviewBtn').addEventListener('click', () => openSetup('review', kind));
  $$('.cat').forEach(el => el.addEventListener('click', () => openSetup(el.dataset.cat, kind)));
}
function catCard(c, kind) {
  const pool = poolFor(c.id, kind); const sm = summarize(pool, kind);
  const strip = shuffle(pool).slice(0, 4);
  const info = S.cats[catKey(kind, c.id)];
  const desc = kind === 'flags' || pool.length === c.flags().length ? c.desc : `${pool.length} places`;
  return `<button class="cat" data-cat="${c.id}">
    <div class="strip">${strip.map(f => thumbOf(f, kind)).join('')}</div>
    <div><div class="name">${h(c.name)}</div><div class="desc">${h(desc)}</div></div>
    ${masteryBar(pool, kind)}
    <div class="meta"><span><b>${sm.mastered + sm.known}</b>/${pool.length} mastered</span><span>${info && info.best ? `best ${info.best}%` : info ? 'played' : 'not played'}</span></div>
  </button>`;
}

function openSetup(catId, kind = 'flags') {
  setup.catId = catId;
  const pool = poolFor(catId, kind);
  const name = catName(catId);
  const modes = modesOf(kind);
  const lengths = [10, 20, 50, pool.length].filter((v, i, a) => v <= pool.length && a.indexOf(v) === i).sort((a, b) => a - b);
  if (!lengths.includes(setup.length)) setup.length = lengths.includes(20) ? 20 : lengths[lengths.length - 1];
  const cur = () => setup.mode[kind];
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  const draw = () => {
    bg.innerHTML = `<div class="modal" role="dialog" aria-label="Round setup">
      <div><div class="eyebrow">${h(KINDS[kind].title)} · ${h(name)} · ${pool.length} ${KINDS[kind].unit}s</div><h2>Choose a mode</h2></div>
      <div class="mode-list">${modes.map(([id, m]) => `<button class="mode ${cur() === id ? 'on' : ''}" data-mode="${id}"><span class="k">${m.key}</span><span><div class="t">${h(m.name)}</div><div class="d">${h(m.desc)}</div></span><span class="xp">×${m.mult} XP</span></button>`).join('')}</div>
      <div class="row between">
        <div class="row"><span class="muted">Questions</span><div class="chips">${MODES[cur()].timed ? '<span class="chip on">60 seconds</span>' : lengths.map(n => `<button class="chip ${setup.length === n ? 'on' : ''}" data-len="${n}">${n === pool.length ? 'All ' + n : n}</button>`).join('')}</div></div>
      </div>
      <div class="row end"><button class="btn ghost" id="cancel">Cancel</button><button class="btn primary lg" id="start">Start round</button></div>
    </div>`;
    $$('.mode', bg).forEach(b => b.addEventListener('click', () => { setup.mode[kind] = b.dataset.mode; draw(); }));
    $$('[data-len]', bg).forEach(b => b.addEventListener('click', () => { setup.length = +b.dataset.len; draw(); }));
    $('#cancel', bg).addEventListener('click', close);
    $('#start', bg).addEventListener('click', () => { close(); startSession(catId, cur(), setup.length); });
  };
  const onKey = e => { if (e.key === 'Escape') close(); if (e.key === 'Enter') { close(); startSession(catId, cur(), setup.length); } const hitMode = modes.find(([, m]) => m.key === e.key); if (hitMode) { setup.mode[kind] = hitMode[0]; draw(); } };
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey);
  draw(); document.body.appendChild(bg);
}

// ---------- QUIZ engine ----------
function startSession(catId, mode, length, fixedQueue) {
  const M = MODES[mode]; const kind = M.kind;
  const pool = fixedQueue || poolFor(catId, kind);
  if (!pool.length) { session = null; toast('plain', '✓', 'All caught up', 'Nothing needs review right now'); go(KINDS[kind].view); return; }
  const n = M.timed ? Infinity : (fixedQueue ? fixedQueue.length : Math.min(length, pool.length));
  session = {
    catId, mode, kind, pool: poolFor(catId, kind), queue: fixedQueue ? shuffle(fixedQueue) : (M.timed ? [] : buildQueue(pool, n, kind)),
    total: n, idx: 0, answered: 0, correct: 0, streak: 0, bestStreak: 0, xp: 0, missed: [], seenIds: [],
    start: Date.now(), qStart: 0, done: false, perfect: true, remaining: 60, timer: null, current: null, options: [], hinted: false, answeredCurrent: false, unlocked: [],
    map: null,
  };
  if (session.pool.length === 0) session.pool = pool;
  S.modes[mode] = (S.modes[mode] || 0) + 1;
  if (catId !== 'review') { const key = catKey(kind, catId); const c = S.cats[key] || (S.cats[key] = { plays: 0, best: 0, perfect: 0 }); c.plays++; }
  S.totals.sessions++;
  save();
  view = 'quiz'; $$('.nav-btn').forEach(b => b.classList.remove('active'));
  if (M.timed) {
    session.timer = setInterval(() => {
      session.remaining--;
      const t = $('#timer'); if (t) { t.textContent = session.remaining; t.classList.toggle('low', session.remaining <= 10); }
      if (session.remaining <= 10 && session.remaining > 0) sound('tick');
      if (session.remaining <= 0) endSession();
    }, 1000);
  }
  nextQuestion();
}
// Keys that must not repeat among the four options. Capitals also must not share a capital
// (Kingston is both Jamaica's and Norfolk Island's).
const optionKeys = (f, kind) => kind === 'capitals' ? [f.name, 'c:' + normalize(f.capital)] : [f.name];
function distractorsFor(flag, pool, kind = 'flags', k = 3) {
  const st = stat(K(kind, flag));
  const chosen = [], used = new Set([flag.id]), keys = new Set(optionKeys(flag, kind));
  const add = f => {
    if (!f || used.has(f.id) || !KINDS[kind].has(f) || (f.group === 'hate') !== (flag.group === 'hate')) return;
    const fk = optionKeys(f, kind); if (fk.some(x => keys.has(x))) return;
    used.add(f.id); fk.forEach(x => keys.add(x)); chosen.push(f);
  };
  // Places the player has confused with this one come first.
  if (st && st.conf) Object.entries(st.conf).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([id]) => { const f = FLAG_BY_ID[id]; if (f && pool.includes(f) && Math.random() < 0.8) add(f); });
  const U = universe(kind);
  const same = shuffle(pool.filter(f => f.sub === flag.sub && f.group === flag.group));
  const any = shuffle(pool.length >= 4 ? pool : U.filter(f => f.group === flag.group || flag.group === 'uk' || flag.group === 'terr'));
  while (chosen.length < k && (same.length || any.length)) {
    const fromSame = same.length && Math.random() < 0.65;
    add(fromSame ? same.shift() : (any.shift() || same.shift()));
  }
  for (let tries = 0; chosen.length < k && tries < 500; tries++) add(pick(U));
  return chosen.slice(0, k);
}
function nextQuestion() {
  const s = session; const M = MODES[s.mode];
  if (M.timed) {
    const recent = new Set(s.seenIds.slice(-6));
    s.current = weightedPick(s.pool, Date.now(), recent.size >= s.pool.length ? new Set() : recent, s.kind);
  } else {
    if (s.idx >= s.queue.length) return endSession();
    s.current = s.queue[s.idx];
  }
  s.seenIds.push(s.current.id);
  s.answeredCurrent = false; s.hinted = false;
  if (M.ans !== 'map' && M.ans !== 'type') {
    const distractPool = s.catId === 'review' || s.catId === 'everything' ? universe(s.kind).filter(f => f.group === s.current.group) : s.pool;
    s.options = shuffle([s.current, ...distractorsFor(s.current, distractPool, s.kind)]);
  } else s.options = [];
  s.qStart = Date.now();
  renderQuiz();
}
const targetText = (f, kind) => kind === 'capitals' ? f.capital : f.name;
function renderQuiz() {
  const s = session; if (!s) return go('play');
  const f = s.current; const M = MODES[s.mode];
  const progress = M.timed ? '' : `<div class="progress"><i style="width:${100 * s.idx / s.total}%"></i></div>`;
  let body;
  if (M.ans === 'map') {
    body = `<div class="map-prompt">${M.ask === 'flag' ? `<img src="${f.src}" alt="Flag to find"><div><div class="eyebrow">Click this flag's ${f.group === 'us' ? 'state' : 'country'}</div></div>` : `<div style="text-align:center"><div class="eyebrow">Find</div><h2>${h(f.name)}</h2></div>`}</div>
      <div id="mapSlot"><div class="map-fb" id="fb"></div></div>`;
  } else if (s.kind === 'shapes') {
    const cap = SHAPES[f.id]?.cap;
    if (M.ans === 'shape') {
      body = `<div class="prompt"><div class="eyebrow">Which outline is</div><h2>${h(f.name)}</h2></div>
      <div class="options shape-opts">${s.options.map((o, i) => `<button class="opt shape-opt" data-id="${o.id}"><span class="key">${i + 1}</span>${shapeSvg(o)}</button>`).join('')}</div>`;
    } else {
      body = `<div class="shape-stage"><div class="shape-frame">${shapeSvg(f, 'big')}</div><div class="shape-reveal" id="reveal"></div></div>
      <div class="shape-cap">${cap ? h(cap) : '&nbsp;'}</div>` + (M.ans === 'type'
        ? `<div class="hint-line" id="hintLine"></div>
      <div class="type-row"><input id="typeIn" type="text" autocomplete="off" spellcheck="false" placeholder="Type the place and press Enter"><button class="btn" id="hintBtn" title="Reveal the first letter (half XP)">Hint</button><button class="btn ghost" id="giveUp">Give up</button></div>`
        : `<div class="options">${s.options.map((o, i) => `<button class="opt" data-id="${o.id}"><span class="key">${i + 1}</span><span>${h(o.name)}</span></button>`).join('')}</div>`);
    }
  } else if (M.ans === 'flag') {
    body = `<div class="prompt"><div class="eyebrow">Which flag is</div><h2>${h(f.name)}</h2></div>
      <div class="options">${s.options.map((o, i) => `<button class="opt flag-opt" data-id="${o.id}"><span class="key">${i + 1}</span><img src="${o.src}" alt="Option ${i + 1}"></button>`).join('')}</div>`;
  } else if (s.kind === 'capitals') {
    const prompt = M.ask === 'capital'
      ? `<div class="cap-prompt solo"><div><div class="eyebrow">Which place has the capital</div><h2>${h(f.capital)}</h2></div></div>`
      : `<div class="cap-prompt"><img src="${f.src}" alt=""><div><div class="eyebrow">What is the capital of</div><h2>${h(f.name)}</h2><div class="sub">${h(placeLabel(f))}</div></div></div>`;
    if (M.ans === 'type') body = prompt + `<div class="hint-line" id="hintLine"></div>
      <div class="type-row"><input id="typeIn" type="text" autocomplete="off" spellcheck="false" placeholder="Type the capital and press Enter"><button class="btn" id="hintBtn" title="Reveal the first letter (half XP)">Hint</button><button class="btn ghost" id="giveUp">Give up</button></div>`;
    else body = prompt + `<div class="options">${s.options.map((o, i) => `<button class="opt" data-id="${o.id}"><span class="key">${i + 1}</span>${M.ans === 'name' ? `<img class="thumb" src="${o.src}" alt="">` : ''}<span>${h(M.ans === 'capital' ? o.capital : o.name)}</span></button>`).join('')}</div>`;
  } else if (M.ans === 'type') {
    body = `<div class="flag-frame"><img src="${f.src}" alt="Flag to identify"></div>
      <div class="hint-line" id="hintLine"></div>
      <div class="type-row"><input id="typeIn" type="text" autocomplete="off" spellcheck="false" placeholder="Type the name and press Enter"><button class="btn" id="hintBtn" title="Reveal the first letter (half XP)">Hint</button><button class="btn ghost" id="giveUp">Give up</button></div>`;
  } else {
    body = `<div class="flag-frame"><img src="${f.src}" alt="Flag to identify"></div>
      <div class="options">${s.options.map((o, i) => `<button class="opt" data-id="${o.id}"><span class="key">${i + 1}</span><span>${h(o.name)}</span></button>`).join('')}</div>`;
  }
  const hint = M.ans === 'map' ? 'Click to answer · drag to spin · scroll to zoom' : M.ans === 'type' ? '<kbd>Enter</kbd> to answer' : '<kbd>1</kbd>–<kbd>4</kbd> to answer';
  main.innerHTML = `<div class="quiz ${M.ans === 'map' ? 'map-quiz' : ''}">
    <div class="quiz-top">
      <div><div class="eyebrow">${h(KINDS[s.kind].title)} · ${h(catName(s.catId))} · ${h(M.name)}</div>
        <div class="meta"><span>${M.timed ? `Answered <b>${s.answered}</b>` : `Question <b>${s.idx + 1}</b>/${s.total}`}</span><span>Correct <b>${s.correct}</b></span><span>Round XP <b>${s.xp}</b></span></div></div>
      <div class="row">${M.timed ? `<div class="timer ${s.remaining <= 10 ? 'low' : ''}" id="timer">${s.remaining}</div>` : ''}<span class="streak-pill ${s.streak >= 5 ? 'hot' : ''}">🔥 ${s.streak}</span><button class="btn ghost sm" id="quit">Quit</button></div>
    </div>
    ${progress}
    ${body}
    ${M.ans === 'map' ? '' : '<div id="fb"></div>'}
    <div class="hint">${hint} · <kbd>Esc</kbd> to quit</div>
  </div>`;
  $('#quit').addEventListener('click', () => endSession());
  $$('.opt').forEach(b => b.addEventListener('click', () => answer(b.dataset.id)));
  if (M.ans === 'map') mountMap();
  if (M.ans === 'type') {
    const input = $('#typeIn'); input.focus();
    const tgt = targetText(f, s.kind);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submitTyped(); } });
    $('#hintBtn').addEventListener('click', () => { s.hinted = true; $('#hintLine').textContent = tgt[0].toUpperCase() + tgt.slice(1).replace(/[^\s\-]/g, '•'); input.focus(); });
    $('#giveUp').addEventListener('click', () => answer(null, 'gave up'));
  }
}
// A place's silhouette as inline SVG (paths from vendor/shape-data.js, fitted to their own box).
function shapeSvg(f, cls = '') {
  const sh = SHAPES[f.id]; if (!sh) return '';
  return `<svg class="shape ${cls}" viewBox="0 0 ${sh.w} ${sh.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="${sh.d}" fill-rule="evenodd"/></svg>`;
}
const thumbOf = (f, kind, title) => kind === 'shapes' ? `<span class="shape-thumb"${title ? ` title="${h(f.name)}"` : ''}>${shapeSvg(f)}</span>` : `<img src="${f.src}" alt=""${title ? ` title="${h(f.name)}"` : ''}>`;
function placeLabel(f) {
  if (f.group === 'us') return f.region === 'US States' ? 'U.S. state' : 'U.S. territory';
  if (f.group === 'uk') return 'UK nation';
  if (f.group === 'terr') return 'Territory';
  return f.region === f.sub ? f.region : f.region + ' · ' + f.sub;
}
// The map widget survives between questions so the globe keeps its orientation.
function mountMap() {
  const s = session; const f = s.current;
  const kind = FMMap.mapFor(f.id);
  if (!s.map || s.map.kind !== kind) {
    if (s.map) s.map.destroy();
    s.map = FMMap.create({ kind, pool: s.pool.filter(p => FMMap.mapFor(p.id) === kind).map(p => p.id), onPick: pickOnMap });
  } else {
    s.map.clearResult();
    if (s.map.zoomedIn()) s.map.goHome(450);
  }
  $('#mapSlot').prepend(s.map.el);
  s.map.resize();
}
function pickOnMap(hitInfo) {
  const s = session; if (!s || s.answeredCurrent || s.done) return;
  const f = s.current;
  const correct = hitInfo.ids.includes(f.id);
  const pickedId = correct ? f.id : (hitInfo.ids.find(id => FLAG_BY_ID[id]) || null);
  const pickedName = pickedId ? FLAG_BY_ID[pickedId].name : (hitInfo.name || 'somewhere else');
  s.map.showResult(f.id, correct ? null : hitInfo.index);
  s.map.flyTo(f.id, { zoom: !correct });
  answer(pickedId, null, correct ? null : pickedName);
}
// Returns null, or { exact, proper } where proper is the correctly spelled name the
// typed text matched (accents and punctuation intact). exact is false for typos.
function typedMatch(text, flag, kind = 'flags') {
  const t = normalize(text); if (!t) return null;
  const raw = kind === 'capitals' ? [flag.capital, ...flag.capAliases] : [flag.name, ...flag.aliases];
  const targets = raw.map(normalize);
  const i = targets.indexOf(t);
  if (i >= 0) return { exact: true, proper: raw[i] };
  let best = -1, bestD = Infinity;
  targets.forEach((n, j) => { const tol = n.length >= 10 ? 2 : n.length >= 5 ? 1 : 0; const d = lev(t, n); if (d <= tol && d < bestD) { best = j; bestD = d; } });
  return best >= 0 ? { exact: false, proper: raw[best] } : null;
}
const matchesTyped = (text, flag, kind) => !!typedMatch(text, flag, kind);
function submitTyped() {
  const s = session; if (s.answeredCurrent) return;
  const text = $('#typeIn').value;
  if (!text.trim()) return;
  const m = typedMatch(text, s.current, s.kind);
  if (m) answer(s.current.id, null, null, m.exact ? null : { typed: text.trim(), proper: m.proper });
  else {
    // Did they type a different place's name or capital? Record the confusion.
    const other = universe(s.kind).find(f => f.id !== s.current.id && matchesTyped(text, f, s.kind));
    answer(other ? other.id : null, text.trim());
  }
}
// After a shape question: show the flag and a small globe with the place ringed.
function revealShape(f, correct) {
  const el = $('#reveal'); if (!el) return;
  el.innerHTML = `<img class="rv-flag" src="${f.src}" alt=""><canvas class="rv-globe" width="150" height="150"></canvas><div class="rv-name ${correct ? 'good' : 'bad'}">${h(f.name)}</div>`;
  el.classList.add('on');
  const sh = SHAPES[f.id];
  if (MAP_OK && sh) FMMap.locator($('.rv-globe', el), sh.c, sh.r, f.id);
}
function answer(pickedId, typedText, clickedName, spell) {
  const s = session; if (!s || s.answeredCurrent || s.done) return;
  s.answeredCurrent = true;
  const M = MODES[s.mode];
  const f = s.current; const ms = Date.now() - s.qStart;
  const correct = pickedId === f.id;
  const { comeback } = recordAnswer(f, correct, pickedId, ms, s.kind);
  s.answered++; S.totals.answered++; touchDay();
  let gain = 0;
  if (correct) {
    s.correct++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak); S.totals.correct++; S.bestStreak = Math.max(S.bestStreak, s.streak);
    const fastMs = M.ans === 'map' ? 5000 : 3000;
    gain = 10 + Math.min(s.streak, 10) * 2 + (ms < fastMs ? 5 : 0);
    gain = Math.round(gain * M.mult * (s.hinted ? 0.5 : 1));
    if (ms < 2000) S.totals.fastCorrect++;
    if (s.mode === 'type') { S.totals.typeCorrect++; S.typedIds[f.id] = 1; }
    if (s.mode === 'pick') S.totals.pickCorrect++;
    if (s.kind === 'capitals') S.totals.capCorrect++;
    if (s.kind === 'map') S.totals.mapCorrect++;
    if (s.kind === 'shapes') S.totals.shapeCorrect++;
    if (s.kind === 'flags' && f.group === 'hist') S.totals.histCorrect++;
    s.xp += gain; addXp(gain); sound('good');
  } else {
    s.streak = 0; s.perfect = false;
    sound('bad');
  }
  save();
  // feedback UI
  const st = stat(K(s.kind, f));
  const picked = pickedId ? FLAG_BY_ID[pickedId] : null;
  $$('.opt').forEach(b => { b.disabled = true; if (b.dataset.id === f.id) b.classList.add('correct'); else if (b.dataset.id === pickedId) b.classList.add('wrong'); else b.classList.add('dim'); });
  if (M.ans === 'type') { const i = $('#typeIn'); i.disabled = true; $('#hintBtn').disabled = true; $('#giveUp').disabled = true; }
  let sub, note = null;
  if (correct) {
    const what = s.kind === 'capitals' ? 'capital' : s.kind === 'map' ? 'place' : s.kind === 'shapes' ? 'shape' : 'flag';
    sub = comeback ? 'Comeback! You used to miss this one.' : st.st >= 3 ? `${st.st} in a row on this ${what}` : st.box >= 4 ? 'Mastered.' : 'Keep it up.';
    if (s.kind === 'capitals' && M.ask === 'capital') sub = `${f.capital} is the capital of ${f.name}. ` + sub;
    if (gain && ms < (M.ans === 'map' ? 5000 : 3000)) sub += ' Fast answer bonus.';
  } else {
    if (s.kind === 'capitals') {
      sub = `The capital of ${f.name} is ${f.capital}.`;
      if (picked) note = M.ask === 'capital' ? `You picked ${picked.name} (capital: ${picked.capital})` : `You picked ${picked.capital}, the capital of ${picked.name}`;
    } else if (s.kind === 'map') {
      sub = `${f.name} is highlighted in green.`;
      if (clickedName) note = `You clicked ${clickedName}`;
    } else {
      sub = `It's ${f.name}.`;
      if (picked) note = `You picked ${picked.name}`;
    }
    if (!note && typedText && typedText !== 'gave up') note = `You typed “${typedText}”`;
    if (note) sub += ' ' + note + '.';
    if (st.w > 1) sub += ` Missed ${st.w} times so far; it will come back soon.`;
    s.missed.push({ flag: f, picked, note: note || 'No answer' });
  }
  if (f.note && s.kind === 'flags') sub += ' ' + f.note;
  if (s.kind === 'shapes') revealShape(f, correct);
  const auto = S.settings.autoAdvance;
  const fact = S.settings.facts && !M.timed ? factFor(f) : null;
  s.held = false;
  $('#fb').innerHTML = `<div class="feedback ${correct ? 'good' : 'bad'}">
    <div><div class="fb-title">${correct ? 'Correct' : 'Not quite'}</div>${correct && spell ? `<div class="fb-spell">Spelled <b>${h(spell.proper)}</b> <span>(you typed “${h(spell.typed)}”)</span></div>` : ''}<div class="fb-sub">${h(sub)}</div></div>
    <div class="row">${correct ? `<span class="gain">+${gain} XP</span>` : ''}${auto ? '' : '<button class="btn primary" id="next">Next <kbd>Enter</kbd></button>'}</div>
  </div>${fact ? factCard(fact, auto ? '<button class="btn sm" id="factHold" title="Keep this on screen (H)">Hold <kbd>H</kbd></button>' : '') : ''}`;
  if (fact && auto) { $('#factHold').addEventListener('click', holdAdvance); const card = $('#factCard'); let dwell; card.addEventListener('mouseenter', () => { dwell = setTimeout(holdAdvance, 350); }); card.addEventListener('mouseleave', () => clearTimeout(dwell)); }
  if (!auto) $('#next').addEventListener('click', nextOrEnd);
  const unlocked = checkAchievements({ session: s });
  s.unlocked.push(...unlocked);
  let delay = (f.note && s.kind === 'flags' && !M.timed) ? (correct ? 3200 : 4500) : M.ans === 'map' ? (M.timed ? (correct ? 700 : 1600) : (correct ? 1300 : 2800)) : M.timed ? (correct ? 500 : 1100) : (correct ? 900 : 2200);
  if (correct && spell) delay = Math.max(delay, M.timed ? 1200 : 2200); // time to read the correct spelling
  if (s.kind === 'shapes' && !M.timed) delay = Math.max(delay, correct ? 1700 : 3200);  // time to look at where it is
  if (auto) s.advanceTimer = setTimeout(nextOrEnd, delay);
}
// Stop auto-advance so a fact can be read; Enter (or Next) moves on.
function holdAdvance() {
  const s = session; if (!s || s.done || !s.answeredCurrent || s.held) return;
  s.held = true; clearTimeout(s.advanceTimer);
  const b = $('#factHold'); if (b) { b.outerHTML = '<button class="btn primary sm" id="factNext">Next <kbd>Enter</kbd></button>'; $('#factNext').addEventListener('click', nextOrEnd); }
  $('#factCard')?.classList.add('held');
}
function nextOrEnd() {
  const s = session; if (!s || s.done) return;
  clearTimeout(s.advanceTimer);
  s.idx++;
  if (!MODES[s.mode].timed && s.idx >= s.total) return endSession();
  nextQuestion();
}
function endSession(abandon = false) {
  const s = session; if (!s || s.done) return;
  s.done = true; clearInterval(s.timer); clearTimeout(s.advanceTimer);
  if (s.map) { s.map.destroy(); s.map = null; }
  const dur = Date.now() - s.start; S.totals.timeMs += dur;
  if (MODES[s.mode].timed) S.totals.lightningBest = Math.max(S.totals.lightningBest, s.correct);
  if (s.catId !== 'review' && s.answered > 0) {
    const c = S.cats[catKey(s.kind, s.catId)];
    const score = pct(s.correct, s.answered);
    if (c && !MODES[s.mode].timed && s.answered >= 10) { c.best = Math.max(c.best, score); if (s.perfect) c.perfect++; }
  }
  if (s.answered > 0) {
    const bonus = s.perfect && s.answered >= 10 ? 50 : 0;
    if (bonus) { s.xp += bonus; addXp(bonus); }
    s.unlocked.push(...checkAchievements({ session: s, sessionEnd: true }));
  }
  save();
  if (abandon) { session = null; return; }
  sound('end');
  renderResults();
}

// ---------- RESULTS view ----------
function renderResults() {
  const s = session; if (!s) return go('play');
  view = 'results';
  const acc = pct(s.correct, s.answered);
  const dur = Date.now() - s.start;
  const title = s.answered === 0 ? 'Round ended' : s.perfect && s.answered >= 10 ? 'Perfect round!' : acc >= 90 ? 'Excellent' : acc >= 70 ? 'Solid work' : acc >= 50 ? 'Getting there' : 'Tough round';
  const missName = f => s.kind === 'capitals' ? `${f.name} — ${f.capital}` : f.name;
  main.innerHTML = `<div class="results">
    <div class="view-head"><div><div class="eyebrow">${h(KINDS[s.kind].title)} · ${h(catName(s.catId))} · ${h(MODES[s.mode].name)}</div><h1>${title}</h1></div></div>
    <div class="score-card">
      <div class="ring" style="--p:${acc}"><div>${acc}%</div></div>
      <div class="tiles">
        <div class="tile"><div class="v num">${s.correct}<span class="muted" style="font-size:16px">/${s.answered}</span></div><div class="l">Correct</div></div>
        <div class="tile gold"><div class="v num">+${s.xp}</div><div class="l">XP earned</div></div>
        <div class="tile"><div class="v num">${s.bestStreak}</div><div class="l">Best streak</div></div>
        <div class="tile"><div class="v num">${fmtTime(dur)}</div><div class="l">Time</div></div>
      </div>
    </div>
    ${s.unlocked.length ? `<div class="section"><div class="eyebrow">Unlocked this round</div><div class="unlocks">${s.unlocked.map(a => `<div class="unlock"><span class="ico">${a.icon}</span><div><b>${h(a.name)}</b><div class="muted" style="font-size:13px">${h(a.desc)}</div></div></div>`).join('')}</div></div>` : ''}
    <div class="row">
      <button class="btn primary lg" id="again">Play again</button>
      ${s.missed.length ? `<button class="btn lg" id="replayMissed">Retry the ${s.missed.length} missed</button>` : ''}
      <button class="btn ghost lg" id="back">Back to categories</button>
    </div>
    ${s.missed.length ? `<div class="section"><div class="eyebrow">Missed this round</div><div class="miss-list">${s.missed.map(m => { const ms = masteryOf(stat(K(s.kind, m.flag))); return `<div class="miss">${s.kind === 'shapes' ? `<span class="shape-thumb">${shapeSvg(m.flag)}</span>` : `<img src="${m.flag.src}" alt="">`}<div><div class="n">${h(missName(m.flag))}</div><div class="s">${h(m.note)}</div></div><span class="pill ${MASTERY_CLASS[ms]}">${MASTERY_LABEL[ms]}</span></div>`; }).join('')}</div></div>` : '<p class="muted">No misses. Nothing to retry.</p>'}
  </div>`;
  const { catId, mode, total, kind } = s;
  const missed = [...new Map(s.missed.map(m => [m.flag.id, m.flag])).values()];
  $('#again').addEventListener('click', () => { session = null; startSession(catId, mode, total === Infinity ? 20 : total); });
  $('#back').addEventListener('click', () => { session = null; go(KINDS[kind].view); });
  if ($('#replayMissed')) $('#replayMissed').addEventListener('click', () => { session = null; startSession(catId, MODES[mode].timed ? BASE_MODE[kind] : mode, missed.length, missed); });
}

// ---------- STUDY view ----------
let study = { catId: 'world', filter: 'all' };
function renderStudy() {
  const pool = poolFor(study.catId);
  const now = Date.now();
  const filtered = pool.filter(f => {
    const st = stat(f.id), m = masteryOf(st);
    if (study.filter === 'work') return needsWork(st, now);
    if (study.filter === 'new') return m === 'unseen';
    if (study.filter === 'mastered') return m === 'mastered' || m === 'known';
    return true;
  });
  const sm = summarize(pool);
  main.innerHTML = `<div class="view">
    <div class="view-head"><div><h1>Study</h1><p>Browse a set with names showing, or run flashcards and rate yourself.</p></div>
      <button class="btn primary" id="flash" ${filtered.length ? '' : 'disabled'}>Flashcards (${filtered.length})</button></div>
    <div class="toolbar">
      <select id="studyCat">${[{ id: 'review', name: 'Smart Review' }, ...CATS].map(c => `<option value="${c.id}" ${c.id === study.catId ? 'selected' : ''}>${h(c.name)}</option>`).join('')}</select>
      <div class="chips">${[['all', `All ${pool.length}`], ['work', `Needs work ${pool.filter(f => needsWork(stat(f.id), now)).length}`], ['new', `New ${sm.unseen}`], ['mastered', `Mastered ${sm.mastered + sm.known}`]].map(([k, l]) => `<button class="chip ${study.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    </div>
    ${filtered.length ? `<div class="flag-grid">${filtered.map(f => { const st = stat(f.id), m = masteryOf(st); return `<div class="fcard"><div class="img"><img src="${f.src}" alt="" loading="lazy"></div><div class="n">${h(f.name)}</div>${f.capital ? `<div class="cap">${h(f.capital)}</div>` : (f.group === 'hist' || f.group === 'hate') ? `<div class="cap" ${f.note ? `title="${h(f.note)}"` : ''}>${h(f.sub)}</div>` : ''}<div class="m"><span class="pill ${MASTERY_CLASS[m]}">${MASTERY_LABEL[m]}</span><span>${st && st.s ? `${st.c}/${st.s}` : ''}</span></div></div>`; }).join('')}</div>` : '<p class="empty">Nothing matches this filter.</p>'}
  </div>`;
  $('#studyCat').addEventListener('change', e => { study.catId = e.target.value; renderStudy(); });
  $$('[data-f]').forEach(b => b.addEventListener('click', () => { study.filter = b.dataset.f; renderStudy(); }));
  $('#flash').addEventListener('click', () => startFlashcards(filtered));
}
let flash = null;
function startFlashcards(list) {
  // weakest first, then shuffle within tiers
  const now = Date.now();
  const order = shuffle(list).sort((a, b) => weightOf(b.id, now) - weightOf(a.id, now));
  flash = { list: order, i: 0, revealed: false, got: 0, missed: 0 };
  view = 'flash'; renderFlash();
}
function renderFlash() {
  const fl = flash; if (!fl) return go('study');
  if (fl.i >= fl.list.length) {
    main.innerHTML = `<div class="results"><div class="view-head"><div><div class="eyebrow">Flashcards</div><h1>Deck finished</h1></div></div>
      <div class="tiles"><div class="tile"><div class="v num">${fl.got}</div><div class="l">Knew it</div></div><div class="tile"><div class="v num">${fl.missed}</div><div class="l">Didn't know</div></div></div>
      <div class="row"><button class="btn primary lg" id="again">Run the deck again</button><button class="btn ghost lg" id="back">Back to Study</button></div></div>`;
    $('#again').addEventListener('click', () => startFlashcards(fl.list));
    $('#back').addEventListener('click', () => go('study'));
    return;
  }
  const f = fl.list[fl.i]; const st = stat(f.id); const m = masteryOf(st);
  main.innerHTML = `<div class="flashcard">
    <div class="quiz-top"><div><div class="eyebrow">Flashcards</div><div class="meta"><span>Card <b>${fl.i + 1}</b>/${fl.list.length}</span><span>Knew <b>${fl.got}</b></span><span>Missed <b>${fl.missed}</b></span></div></div><button class="btn ghost sm" id="quit">Done</button></div>
    <div class="progress"><i style="width:${100 * fl.i / fl.list.length}%"></i></div>
    <div class="flag-frame"><img src="${f.src}" alt="Flashcard flag"></div>
    <div class="answer">${fl.revealed ? `<div><h2>${h(f.name)}</h2><div class="muted">${h(f.group === 'hist' ? 'Historical · ' + f.sub : f.group === 'hate' ? 'Hate symbol · ' + f.sub : placeLabel(f))}${f.capital ? ' · Capital: ' + h(f.capital) : ''} · <span class="pill ${MASTERY_CLASS[m]}">${MASTERY_LABEL[m]}</span></div>${f.note ? `<p class="muted flash-note">${h(f.note)}</p>` : ''}</div>` : '<button class="btn lg" id="reveal">Reveal <kbd>Space</kbd></button>'}</div>
    ${fl.revealed && S.settings.facts && factsOf(f).length ? factCard(factFor(f)) : ''}
    ${fl.revealed ? `<div class="rate"><button class="btn lg" id="no" style="border-color:var(--bad);color:var(--bad)">Didn't know <kbd>1</kbd></button><button class="btn lg" id="yes" style="border-color:var(--good);color:var(--good)">Knew it <kbd>2</kbd></button></div>` : ''}
  </div>`;
  $('#quit').addEventListener('click', () => go('study'));
  if (!fl.revealed) $('#reveal').addEventListener('click', () => { fl.revealed = true; renderFlash(); });
  else { $('#yes').addEventListener('click', () => rateFlash(true)); $('#no').addEventListener('click', () => rateFlash(false)); }
}
function rateFlash(knew) {
  const fl = flash; const f = fl.list[fl.i];
  recordAnswer(f, knew, null, null);
  S.totals.studyRatings++; touchDay();
  if (knew) { fl.got++; addXp(3); } else fl.missed++;
  checkAchievements({});
  save();
  fl.i++; fl.revealed = false; renderFlash();
}

// ---------- STATS view ----------
function renderStats() {
  const now = Date.now();
  const all = GAME_FLAGS; const sm = summarize(all);
  const seen = all.filter(f => stat(f.id)?.s);
  const trouble = seen.map(f => { const st = stat(f.id); const rate = st.w / (st.c + st.w); const score = rate * 3 + (5 - st.box) * 0.6 + Math.min(st.w, 6) * 0.3; return { f, st, rate, score }; })
    .filter(t => t.st.w > 0).sort((a, b) => b.score - a.score).slice(0, 14);
  const catRows = CATS.filter(c => c.id !== 'everything').map(c => { const pool = c.flags(); const s = summarize(pool); return { c, pool, s, p: pct(s.mastered + s.known, pool.length) }; }).sort((a, b) => b.p - a.p);
  const acc = pct(S.totals.correct, S.totals.answered);
  const days = Object.keys(S.days).length;
  main.innerHTML = `<div class="view">
    <div class="view-head"><div><h1>Progress</h1><p>Where you stand, and which flags keep slipping.</p></div></div>
    <div class="stat-tiles">
      <div class="tile"><div class="v num">${S.totals.answered.toLocaleString()}</div><div class="l">Questions answered</div></div>
      <div class="tile"><div class="v num">${acc}%</div><div class="l">Lifetime accuracy</div></div>
      <div class="tile gold"><div class="v num">${sm.mastered + sm.known}<span class="muted" style="font-size:14px">/${all.length}</span></div><div class="l">Flags mastered</div></div>
      <div class="tile"><div class="v num">${S.bestStreak}</div><div class="l">Best streak</div></div>
      <div class="tile"><div class="v num">${S.dayStreak}</div><div class="l">Day streak</div></div>
      <div class="tile gold"><div class="v num">${countMasteredK(universe('capitals'), 'capitals')}<span class="muted" style="font-size:14px">/${universe('capitals').length}</span></div><div class="l">Capitals mastered</div></div>
      <div class="tile gold"><div class="v num">${MAP_OK ? countMasteredK(universe('map'), 'map') : 0}<span class="muted" style="font-size:14px">/${MAP_OK ? universe('map').length : 0}</span></div><div class="l">Places found on the globe</div></div>
      <div class="tile gold"><div class="v num">${countMasteredK(universe('shapes'), 'shapes')}<span class="muted" style="font-size:14px">/${universe('shapes').length}</span></div><div class="l">Shapes mastered</div></div>
      <div class="tile gold"><div class="v num">${TRIVIA.filter(q => S.trivia[q.id]?.perfect).length}<span class="muted" style="font-size:14px">/${TRIVIA.length}</span></div><div class="l">Trivia quizzes perfected</div></div>
      <div class="tile"><div class="v num">${fmtTime(S.totals.timeMs)}</div><div class="l">Time played · ${days} day${days === 1 ? '' : 's'}</div></div>
    </div>
    <div class="two-col">
      <div class="panel">
        <h3>Mastery by category <small>sorted by progress</small></h3>
        <div class="legend"><span><i style="background:var(--accent)"></i>Mastered</span><span><i style="background:var(--good)"></i>Known</span><span><i style="background:var(--info)"></i>Familiar</span><span><i style="background:var(--bad)"></i>Learning</span><span><i style="background:var(--line)"></i>New</span></div>
        ${catRows.map(r => `<div class="crow"><span>${h(r.c.name)}</span>${masteryBar(r.pool)}<span class="pct">${r.p}%</span></div>`).join('')}
      </div>
      <div style="display:grid;gap:20px">
        <div class="panel">
          <h3>Trouble flags <small>most missed</small></h3>
          ${trouble.length ? trouble.map(t => { const confId = Object.entries(t.st.conf).sort((a, b) => b[1] - a[1])[0]; const conf = confId && FLAG_BY_ID[confId[0]]; return `<div class="trouble"><img src="${t.f.src}" alt=""><div><div class="n">${h(t.f.name)}</div><div class="c">${conf ? 'Often confused with ' + h(conf.name) + ' · ' : ''}${t.st.c} right, ${t.st.w} wrong</div></div><div class="r">${Math.round(100 * t.rate)}% miss</div></div>`; }).join('') : '<p class="empty">No misses yet. Play a round and your weak spots will appear here.</p>'}
        </div>
        <div class="panel">
          <h3>Capitals, Globe & Shapes <small>mastery by area</small></h3>
          ${[['Country capitals', D.countries, 'capitals'], ['State capitals', D.states, 'capitals'], ['Countries on the globe', D.countries, 'map'], ['States on the map', D.states, 'map'], ['Country shapes', D.countries.filter(KINDS.shapes.has), 'shapes'], ['State shapes', D.states, 'shapes'], ['Historical shapes', D.historical.filter(KINDS.shapes.has), 'shapes']].map(([n, list, k]) => `<div class="crow"><span>${n}</span>${masteryBar(list, k)}<span class="pct">${pct(countMasteredK(list, k), list.length)}%</span></div>`).join('')}
        </div>
        <div class="panel">
          <h3>Overall mastery</h3>
          ${masteryBar(all)}
          <div class="legend"><span>${sm.mastered} mastered</span><span>${sm.known} known</span><span>${sm.familiar} familiar</span><span>${sm.learning} learning</span><span>${sm.unseen} new</span></div>
          <p class="muted" style="font-size:13px">A flag counts as mastered after four correct answers in a row spread over several days. Miss it and it drops back.</p>
        </div>
      </div>
    </div>
  </div>`;
}

// ---------- ACHIEVEMENTS view ----------
function renderAchievements() {
  const n = Object.keys(S.ach).length;
  main.innerHTML = `<div class="view">
    <div class="view-head"><div><h1>Achievements</h1><p>${n} of ${ACH.length} unlocked. Each one is worth 25 XP.</p></div></div>
    <div class="ach-grid">${ACH.slice().sort((a, b) => (S.ach[b.id] ? 1 : 0) - (S.ach[a.id] ? 1 : 0)).map(a => {
      const at = S.ach[a.id]; const pr = a.prog ? a.prog() : null;
      return `<div class="ach ${at ? 'unlocked' : 'locked'}"><div class="ico">${a.icon}</div><div><div class="n">${h(a.name)}</div><div class="d">${h(a.desc)}</div>
        ${at ? `<div class="when">Unlocked ${fmtDate(at)}</div>` : pr ? `<div class="p"><div class="bar"><i style="width:${pct(Math.min(pr[0], pr[1]), pr[1])}%"></i></div><span>${Math.min(pr[0], pr[1]).toLocaleString()} / ${pr[1].toLocaleString()}</span></div>` : ''}</div></div>`;
    }).join('')}</div>
  </div>`;
}

// ---------- SETTINGS view ----------
function renderSettings() {
  const sw = (id, on) => `<button class="switch ${on ? 'on' : ''}" id="${id}" role="switch" aria-checked="${on}"></button>`;
  main.innerHTML = `<div class="view" style="max-width:720px">
    <div class="view-head"><div><h1>Settings</h1><p>Progress is saved automatically on this device.</p></div></div>
    <div class="panel">
      <div class="setting"><div><b>Sound effects</b><div class="d">Chimes for correct answers, achievements and level-ups.</div></div>${sw('swSound', S.settings.sound)}</div>
      <div class="setting"><div><b>Auto-advance</b><div class="d">Move to the next flag automatically after answering. Off means you press Enter.</div></div>${sw('swAuto', S.settings.autoAdvance)}</div>
      <div class="setting"><div><b>Facts after answers</b><div class="d">Show a fun or important fact about the country after each answer. It never slows you down: hover the fact or press <kbd>H</kbd> to hold it on screen, then <kbd>Enter</kbd> to move on. Lightning rounds skip facts.</div></div>${sw('swFacts', S.settings.facts)}</div>
      <div class="setting"><div><b>Light theme</b><div class="d">Switch the interface from dark to light.</div></div>${sw('swTheme', S.settings.theme === 'light')}</div>
    </div>
    <div class="panel">
      <h3>Backup</h3>
      <div class="row"><button class="btn" id="export">Export progress to a file</button><button class="btn" id="import">Import from a file</button></div>
      <p class="muted" style="font-size:13px">Export before reinstalling or moving to another PC. Importing replaces your current progress.</p>
    </div>
    <div class="panel">
      <h3>Danger zone</h3>
      <div class="row"><button class="btn danger" id="reset">Reset all progress</button><span class="muted" id="resetMsg"></span></div>
    </div>
    <p class="muted" style="font-size:12px">Flag Master 1.6 · ${GAME_FLAGS.length} flags + ${D.hate.length} hate symbols · flag images from Flagpedia and Wikimedia Commons (public domain) · maps from Natural Earth and the U.S. Census Bureau</p>
  </div>`;
  $('#swSound').addEventListener('click', () => { S.settings.sound = !S.settings.sound; save(); if (S.settings.sound) sound('good'); renderSettings(); });
  $('#swAuto').addEventListener('click', () => { S.settings.autoAdvance = !S.settings.autoAdvance; save(); renderSettings(); });
  $('#swFacts').addEventListener('click', () => { S.settings.facts = !S.settings.facts; save(); renderSettings(); });
  $('#swTheme').addEventListener('click', () => { S.settings.theme = S.settings.theme === 'light' ? 'dark' : 'light'; applyTheme(); save(); renderSettings(); });
  $('#export').addEventListener('click', async () => { const r = await exportBackup(JSON.stringify(S)); if (r?.ok) toast('plain', '💾', 'Exported', r.path); });
  $('#import').addEventListener('click', async () => {
    const r = await importBackup(); if (!r?.ok) return;
    try { const parsed = JSON.parse(r.json); if (!parsed || typeof parsed !== 'object' || !parsed.flags) throw new Error('bad'); localStorage.setItem(KEY, r.json); load(); applyTheme(); renderLevelCard(); toast('plain', '📂', 'Imported', 'Progress restored from file'); renderSettings(); }
    catch (e) { toast('plain', '⚠️', 'Import failed', 'That file is not a Flag Master backup'); }
  });
  let armed = false;
  $('#reset').addEventListener('click', () => {
    if (!armed) { armed = true; $('#resetMsg').textContent = 'Click again to confirm. This cannot be undone.'; $('#reset').textContent = 'Yes, erase everything'; setTimeout(() => { armed = false; if ($('#resetMsg')) { $('#resetMsg').textContent = ''; $('#reset').textContent = 'Reset all progress'; } }, 5000); return; }
    S = defaultState(); try { localStorage.removeItem(KEY); } catch (e) {} save(); applyTheme(); renderLevelCard(); toast('plain', '🧹', 'Reset', 'All progress erased'); renderSettings();
  });
}

// ---------- TRIVIA view ----------
// Short list quizzes from trivia.js. Two ways to play: type the answers against the clock,
// or pick the matching flags out of a wall. Best scores live in S.trivia[quizId].
const TRIVIA = (typeof FM_TRIVIA !== 'undefined' ? FM_TRIVIA : []).map(q => ({ ...q, flags: q.answers.map(id => FLAG_BY_ID[id]).filter(Boolean) }));
const triviaById = id => TRIVIA.find(q => q.id === id);
const triviaIsUS = q => q.answers[0].startsWith('us:');
const triviaTime = q => clamp(Math.round((q.answers.length * 10 + 30) / 30) * 30, 60, 900);
const fmtClock = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const placeKeys = f => [f.name, ...f.aliases].map(normalize);
let trivia = null;
window.__fmTrivia = () => trivia; // read-only peek for build/smoke3.js

function stopTrivia() { if (trivia && !trivia.done) { clearInterval(trivia.timer); trivia = null; } }

function renderTrivia() {
  stopTrivia();
  const played = TRIVIA.filter(q => S.trivia[q.id]?.plays).length;
  const perfect = TRIVIA.filter(q => S.trivia[q.id]?.perfect).length;
  const sections = [...new Set(TRIVIA.map(q => q.section))];
  main.innerHTML = `<div class="view">
    <div class="view-head"><div><h1>Trivia</h1><p>Quick list quizzes. Name them all before the clock runs out, or pick them out of a wall of flags.</p></div>
      <div class="triv-sum"><span><b>${played}</b>/${TRIVIA.length} played</span><span><b>${perfect}</b> perfect</span></div></div>
    ${sections.map(sec => `<div class="section"><div class="eyebrow">${h(sec)}</div><div class="triv-grid">${TRIVIA.filter(q => q.section === sec).map(triviaCard).join('')}</div></div>`).join('')}
  </div>`;
  $$('.triv-card').forEach(el => el.addEventListener('click', () => openTrivia(el.dataset.q)));
}
function triviaCard(q) {
  const r = S.trivia[q.id], n = q.answers.length;
  return `<button class="triv-card ${r?.perfect ? 'perfect' : ''}" data-q="${q.id}">
    <span class="ico">${q.icon}</span>
    <span class="body"><span class="name">${h(q.title)}</span><span class="desc">${h(q.desc)}</span></span>
    <span class="meta"><span>${n} answer${n === 1 ? '' : 's'}</span>${r ? `<span class="best">${r.perfect ? '★ perfect' : `best ${r.best}/${n}`}</span>` : '<span>not played</span>'}</span>
  </button>`;
}

function openTrivia(qid) {
  const q = triviaById(qid);
  if (!q.grid) return startTrivia(q, 'type');
  const opts = [['type', '1', 'Type them', `Name them from memory. You get ${fmtClock(triviaTime(q))}.`], ['grid', '2', 'Click the flags', 'Pick them out of a wall of flags. Wrong clicks count against you.']];
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-label="${h(q.title)}">
    <div><div class="eyebrow">Trivia · ${q.answers.length} answers</div><h2>${q.icon} ${h(q.title)}</h2><p class="muted" style="margin-top:4px">${h(q.desc)}</p></div>
    <div class="mode-list">${opts.map(([id, k, n, d]) => `<button class="mode" data-m="${id}"><span class="k">${k}</span><span><div class="t">${n}</div><div class="d">${h(d)}</div></span><span class="xp">${id === 'type' ? '4 XP each' : '2 XP each'}</span></button>`).join('')}</div>
    <div class="row end"><button class="btn ghost" id="cancel">Cancel</button></div>
  </div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey, true); };
  const pickMode = m => { close(); startTrivia(q, m); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } else if (e.key === '1') pickMode('type'); else if (e.key === '2') pickMode('grid'); };
  $$('.mode', bg).forEach(b => b.addEventListener('click', () => pickMode(b.dataset.m)));
  $('#cancel', bg).addEventListener('click', close);
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(bg);
}

function startTrivia(q, mode) {
  stopTrivia();
  const t = { q, mode, found: new Set(), order: [], wrong: [], start: Date.now(), remaining: triviaTime(q), done: false, timer: null, xp: 0, unlocked: [] };
  t.universe = triviaIsUS(q) ? D.states : D.countries;
  if (mode === 'grid') {
    const ans = new Set(q.answers), skip = new Set(q.noDecoy || []);
    const pool = t.universe.filter(f => !ans.has(f.id) && !skip.has(f.id));
    const regions = new Set(q.flags.map(f => f.region));
    const total = clamp(q.answers.length * 3, 12, 40), need = total - q.answers.length;
    const near = shuffle(pool.filter(f => regions.has(f.region))), far = shuffle(pool.filter(f => !regions.has(f.region)));
    const nNear = Math.min(near.length, Math.ceil(need * 0.6));
    const decoys = [...near.slice(0, nNear), ...far.slice(0, need - nNear)];
    if (decoys.length < need) decoys.push(...near.slice(nNear, nNear + need - decoys.length));
    t.tiles = shuffle([...q.flags, ...decoys]);
  }
  trivia = t;
  go('trivia-play');
  t.timer = setInterval(triviaTick, 1000);
}
function triviaTick() {
  const t = trivia; if (!t || t.done) return;
  const el = $('#tTimer');
  if (t.mode === 'type') {
    t.remaining--;
    if (el) { el.textContent = fmtClock(Math.max(0, t.remaining)); el.classList.toggle('low', t.remaining <= 10); }
    if (t.remaining <= 10 && t.remaining > 0) sound('tick');
    if (t.remaining <= 0) finishTrivia();
  } else if (el) el.textContent = fmtClock(Math.floor((Date.now() - t.start) / 1000));
}

function triviaSlots() {
  const t = trivia, q = t.q;
  const cell = (f, i) => `<div class="slot ${f ? 'on' : ''}">${q.ranked ? `<span class="n">${i + 1}</span>` : ''}${f ? `<img src="${f.src}" alt=""><span class="nm">${h(f.name)}</span>` : ''}</div>`;
  if (q.ranked) return q.flags.map((f, i) => cell(t.found.has(f.id) ? f : null, i)).join('');
  return q.flags.map((_, i) => cell(t.order[i] || null, i)).join('');
}
function renderTriviaPlay() {
  const t = trivia; if (!t) return go('trivia');
  const q = t.q, n = q.answers.length;
  const body = t.mode === 'type'
    ? `<div class="type-row two"><input id="tIn" type="text" autocomplete="off" spellcheck="false" placeholder="Type an answer. Right ones lock in on their own."><button class="btn" id="tEnter">Enter</button></div>
       <div class="triv-msg" id="tMsg"></div>
       <div class="slots ${n > 60 ? 'dense' : ''}" id="tSlots">${triviaSlots()}</div>`
    : `<div class="triv-wall" id="tWall">${t.tiles.map(f => `<button class="wall-flag" data-id="${f.id}"><img src="${f.src}" alt="A flag"><span class="lbl"></span></button>`).join('')}</div>`;
  main.innerHTML = `<div class="quiz triv-quiz">
    <div class="quiz-top">
      <div><div class="eyebrow">Trivia · ${h(q.title)} · ${t.mode === 'type' ? 'Type them' : 'Click the flags'}</div>
        <div class="meta"><span>Found <b id="tFound">${t.found.size}</b>/${n}</span>${t.mode === 'grid' ? '<span>Mistakes <b id="tWrong">0</b></span>' : ''}</div></div>
      <div class="row"><div class="timer" id="tTimer">${t.mode === 'type' ? fmtClock(t.remaining) : '0:00'}</div><button class="btn ghost sm" id="tGive">Give up</button></div>
    </div>
    <div class="triv-prompt"><span class="ico">${q.icon}</span><div><h2>${h(q.desc)}</h2>${q.note ? `<div class="muted">${h(q.note)}</div>` : ''}</div></div>
    ${body}
    <div class="hint">${t.mode === 'type' ? 'Answers lock in as you type · <kbd>Enter</kbd> accepts close spellings' : 'Click every flag that fits'} · <kbd>Esc</kbd> to give up</div>
  </div>`;
  $('#tGive').addEventListener('click', () => finishTrivia());
  if (t.mode === 'type') {
    const inp = $('#tIn'); inp.focus();
    inp.addEventListener('input', () => triviaType(false));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); triviaType(true); } });
    $('#tEnter').addEventListener('click', () => { triviaType(true); inp.focus(); });
  } else {
    $$('.wall-flag').forEach(b => b.addEventListener('click', () => triviaClick(b)));
  }
}
function triviaMsg(text, kind) {
  const el = $('#tMsg'); if (!el) return;
  el.textContent = text; el.className = 'triv-msg ' + (kind || '');
  if (trivia) trivia.keepMsg = false;
}
function triviaFound(f) {
  const t = trivia;
  t.found.add(f.id); t.order.push(f);
  sound('good');
  const fe = $('#tFound'); if (fe) fe.textContent = t.found.size;
  if (t.found.size === t.q.answers.length) setTimeout(finishTrivia, 350);
}
function triviaType(final) {
  const t = trivia; if (!t || t.done) return;
  const inp = $('#tIn'); const v = normalize(inp.value); if (!v) return;
  const open = t.q.flags.filter(f => !t.found.has(f.id));
  let hit = open.find(f => placeKeys(f).includes(v));
  // "Niger" is also the start of "Nigeria": wait for Enter instead of grabbing the shorter one.
  if (hit && !final && t.universe.some(f => f !== hit && placeKeys(f).some(k => k !== v && k.startsWith(v)))) { triviaMsg('Press Enter to lock in ' + hit.name, 'wait'); return; }
  let spell = null;
  if (!hit && final && !t.universe.some(f => placeKeys(f).includes(v))) {
    const near = open.filter(f => typedMatch(inp.value, f));
    if (near.length === 1) { hit = near[0]; spell = typedMatch(inp.value, hit).proper; }
  }
  if (hit) {
    const typed = inp.value.trim();
    triviaFound(hit); inp.value = '';
    if (spell) { triviaMsg(`✓ Spelled ${spell} (you typed “${typed}”)`, 'spell'); t.keepMsg = true; }
    else triviaMsg('✓ ' + hit.name, 'good');
    $('#tSlots').innerHTML = triviaSlots();
    return;
  }
  if (!final) { if (!t.keepMsg) triviaMsg(''); return; }
  const known = t.universe.find(f => placeKeys(f).includes(v));
  if (known && t.found.has(known.id)) triviaMsg(`You already have ${known.name}`, 'wait');
  else if (known) { triviaMsg(`${known.name} is not on this list`, 'bad'); sound('bad'); }
  else triviaMsg(`Not sure what "${inp.value.trim()}" is`, 'bad');
  inp.value = '';
  inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake');
}
function triviaClick(btn) {
  const t = trivia; if (!t || t.done || btn.disabled) return;
  const f = FLAG_BY_ID[btn.dataset.id];
  btn.disabled = true;
  btn.querySelector('.lbl').textContent = f.name;
  if (t.q.answers.includes(f.id)) { btn.classList.add('good'); triviaFound(f); }
  else { btn.classList.add('bad'); t.wrong.push(f); sound('bad'); $('#tWrong').textContent = t.wrong.length; }
}

function finishTrivia() {
  const t = trivia; if (!t || t.done) return;
  t.done = true; clearInterval(t.timer);
  const q = t.q, n = q.answers.length, got = t.found.size;
  t.ms = Date.now() - t.start;
  t.perfect = got === n && t.wrong.length === 0;
  t.xp = got * (t.mode === 'type' ? 4 : 2) + (t.perfect ? 20 + n : 0);
  const r = S.trivia[q.id] || (S.trivia[q.id] = { plays: 0, best: 0, perfect: false, bestMs: 0 });
  r.plays++;
  t.newBest = got > r.best && r.plays > 1;
  r.best = Math.max(r.best, got);
  if (t.perfect) { r.perfect = true; if (!r.bestMs || t.ms < r.bestMs) r.bestMs = t.ms; }
  S.totals.triviaPlays++; S.totals.timeMs += t.ms; touchDay();
  if (t.xp) addXp(t.xp);
  t.unlocked = checkAchievements({});
  save(); sound('end');
  go('trivia-results');
}
function renderTriviaResults() {
  const t = trivia; if (!t) return go('trivia');
  const q = t.q, n = q.answers.length, got = t.found.size, p = pct(got, n);
  const title = t.perfect ? 'Perfect!' : got === n ? 'All found' : p >= 80 ? 'So close' : p >= 50 ? 'Not bad' : got ? 'Tough one' : 'Better luck next time';
  const items = q.flags.map((f, i) => `<div class="ans ${t.found.has(f.id) ? 'got' : 'miss'}">${q.ranked ? `<span class="n">${i + 1}</span>` : ''}<img src="${f.src}" alt=""><span>${h(f.name)}</span></div>`).join('');
  const other = t.mode === 'type' ? 'grid' : 'type';
  main.innerHTML = `<div class="results">
    <div class="view-head"><div><div class="eyebrow">Trivia · ${h(q.title)} · ${t.mode === 'type' ? 'Type them' : 'Click the flags'}</div><h1>${title}</h1></div></div>
    <div class="score-card">
      <div class="ring" style="--p:${p}"><div>${got}/${n}</div></div>
      <div class="tiles">
        <div class="tile"><div class="v num">${p}%</div><div class="l">Found${t.newBest ? ' · new best' : ''}</div></div>
        <div class="tile gold"><div class="v num">+${t.xp}</div><div class="l">XP earned</div></div>
        ${t.mode === 'grid' ? `<div class="tile"><div class="v num">${t.wrong.length}</div><div class="l">Wrong clicks</div></div>` : ''}
        <div class="tile"><div class="v num">${fmtTime(t.ms)}</div><div class="l">Time</div></div>
      </div>
    </div>
    ${t.unlocked.length ? `<div class="section"><div class="eyebrow">Unlocked</div><div class="unlocks">${t.unlocked.map(a => `<div class="unlock"><span class="ico">${a.icon}</span><div><b>${h(a.name)}</b><div class="muted" style="font-size:13px">${h(a.desc)}</div></div></div>`).join('')}</div></div>` : ''}
    <div class="row">
      <button class="btn primary lg" id="tAgain">Play again</button>
      ${q.grid ? `<button class="btn lg" id="tOther">Try ${other === 'type' ? 'typing them' : 'clicking the flags'}</button>` : ''}
      <button class="btn ghost lg" id="tBack">Back to trivia</button>
    </div>
    <div class="section"><div class="eyebrow">The answers${got < n ? ` · ${n - got} missed, in red` : ''}</div>${q.note ? `<p class="muted" style="font-size:13px">${h(q.note)}</p>` : ''}<div class="triv-answers">${items}</div></div>
    ${t.wrong.length ? `<div class="section"><div class="eyebrow">Wrong clicks</div><div class="triv-answers">${t.wrong.map(f => `<div class="ans wrong"><img src="${f.src}" alt=""><span>${h(f.name)}</span></div>`).join('')}</div></div>` : ''}
  </div>`;
  $('#tAgain').addEventListener('click', () => startTrivia(q, t.mode));
  if ($('#tOther')) $('#tOther').addEventListener('click', () => startTrivia(q, other));
  $('#tBack').addEventListener('click', () => { trivia = null; go('trivia'); });
}

// ---------- FACTS ----------
// facts.js: per country, `f` = facts shown after answers, `c` = Mystery Country clues (hardest first).
const FACTS = window.FM_FACTS || {};
const factsOf = f => (FACTS[f.id] && FACTS[f.id].f) || [];
const lastFact = {};
function factFor(f) {
  const list = factsOf(f); if (!list.length) return null;
  // rotate so the same country shows a different fact next time
  const i = ((lastFact[f.id] ?? rand(list.length)) + 1) % list.length; lastFact[f.id] = i;
  return list[i];
}
const factCard = (fact, extra = '') => `<div class="fact-card" id="factCard"><span class="fact-ico">💡</span><div class="fact-txt">${h(fact)}</div>${extra}</div>`;

// ---------- BORDER HOP ----------
// Get from one country to another over land borders, naming as few countries as possible.
// Par = countries on the shortest route between the two (endpoints excluded).
// A guess "in line" borders the chain already joined to the start or the end when you make it.
const BORDERS = typeof FM_BORDERS !== 'undefined' ? FM_BORDERS : {};
const HOP_IDS = Object.keys(BORDERS);
const hopPlace = id => FLAG_BY_ID[id];
const distCache = {};
function distFrom(a) {
  if (distCache[a]) return distCache[a];
  const d = { [a]: 0 }, q = [a];
  for (let i = 0; i < q.length; i++) (BORDERS[q[i]] || []).forEach(n => { if (d[n] == null) { d[n] = d[q[i]] + 1; q.push(n); } });
  return (distCache[a] = d);
}
const hopDist = (a, b) => distFrom(a)[b] ?? Infinity;
// Countries a player may name: every country, plus Western Sahara.
const HOP_GUESSABLE = [...D.countries, FLAG_BY_ID['terr:eh']].filter(Boolean);
const HOP_REGIONS = [['world', 'World'], ['Europe', 'Europe'], ['Africa', 'Africa'], ['Asia', 'Asia'], ['Americas', 'Americas']];
const HOP_DIFF = { easy: { name: 'Easy', lo: 1, hi: 2 }, medium: { name: 'Medium', lo: 3, hi: 4 }, hard: { name: 'Hard', lo: 5, hi: 8 } };
const regionOfHop = f => /America|Caribbean/.test(f.region) ? 'Americas' : f.region;
window.__fmGames = () => ({ hop, myst, best: hop && hopBestRoute() }); // read-only peek for build/smoke6.js
let hop = null, hopSetup = { diff: 'medium', region: 'world' };
const hopStats = () => S.hop || (S.hop = { plays: 0, wins: 0, pars: 0, inline: 0, daily: {} });

// Small seeded RNG so everyone gets the same daily route.
function seeded(str) { let x = 2166136261; for (const c of str) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 1e9) / 1e9; }; }
function hopPairs(diff, region) {
  const D2 = HOP_DIFF[diff]; const ends = HOP_IDS.filter(id => id !== 'terr:eh' && (region === 'world' || regionOfHop(hopPlace(id)) === region));
  const out = [];
  ends.forEach(a => { const d = distFrom(a); ends.forEach(b => { if (a < b && d[b] != null && d[b] - 1 >= D2.lo && d[b] - 1 <= D2.hi) out.push([a, b]); }); });
  return out;
}
function hopRoute(diff, region, r) {
  let pairs = hopPairs(diff, region);
  if (!pairs.length) pairs = hopPairs('medium', 'world');
  let [a, b] = pairs[Math.floor(r() * pairs.length)];
  if (r() < 0.5) [a, b] = [b, a];
  const par = hopDist(a, b) - 1;
  return { start: a, end: b, par, max: par + 4, guesses: [], hints: 0, done: false, won: false, diff, region, map: null };
}
// daily: today's key to record the daily; replay: today's key to replay it without stats
function newHop(diff, region, daily, replay) {
  const day = daily || replay;
  hop = { ...hopRoute(day ? 'medium' : diff, day ? 'world' : region, day ? seeded('hop' + day) : Math.random), daily, replay };
  go('hop-play');
}
// Is end reachable from start using only the endpoints and the guessed countries?
function hopComponent(from, allowed) {
  const seen = new Set([from]), q = [from];
  for (let i = 0; i < q.length; i++) (BORDERS[q[i]] || []).forEach(n => { if (allowed.has(n) && !seen.has(n)) { seen.add(n); q.push(n); } });
  return seen;
}
const hopAllowed = () => new Set([hop.start, hop.end, ...hop.guesses.map(g => g.id)]);
function hopGuess(f) {
  if (!hop || hop.done) return;
  if (f.id === hop.start || f.id === hop.end) return hopMsg(`${f.name} is where you ${f.id === hop.start ? 'start' : 'finish'}.`, 'bad');
  if (hop.guesses.some(g => g.id === f.id)) return hopMsg(`You already named ${f.name}.`, 'bad');
  const allowed = hopAllowed();
  const near = n => (BORDERS[f.id] || []).some(x => n.has(x));
  const inline = near(hopComponent(hop.start, allowed)) || near(hopComponent(hop.end, allowed));
  const detour = hopDist(hop.start, f.id) + hopDist(f.id, hop.end) - hopDist(hop.start, hop.end);
  hop.guesses.push({ id: f.id, inline, detour });
  const now = hopAllowed();
  if (hopComponent(hop.start, now).has(hop.end)) return hopFinish(true);
  if (hop.guesses.length >= hop.max) return hopFinish(false);
  renderHopPlay();
  hopMsg(detour === 0 ? `${f.name} is on a shortest route.` : isFinite(detour) ? `${f.name} adds ${detour} extra countr${detour === 1 ? 'y' : 'ies'} to the trip.` : `${f.name} has no land route to these countries.`, detour === 0 ? 'good' : '');
}
// One shortest route, preferring countries the player already named.
function hopBestRoute() {
  const named = new Set(hop.guesses.map(g => g.id));
  const dA = distFrom(hop.start), dB = distFrom(hop.end), L = dA[hop.end];
  const route = [hop.start]; let cur = hop.start;
  for (let step = 1; step < L; step++) {
    const next = (BORDERS[cur] || []).filter(n => dA[n] === step && dB[n] === L - step);
    cur = next.find(n => named.has(n)) || next.sort()[0]; route.push(cur);
  }
  route.push(hop.end); return route;
}
function hopFinish(won) {
  const s = hop; s.done = true; s.won = won;
  const st = hopStats(); st.plays++;
  const used = s.guesses.length, over = used - s.par;
  const clean = won && s.guesses.every(g => g.inline);
  let gain = 0;
  if (won) {
    st.wins++; if (over === 0) st.pars++; if (clean) st.inline++;
    gain = Math.max(10, 30 + s.par * 10 - over * 8 - s.hints * 10);
    if (clean) gain = Math.round(gain * 1.25);
    addXp(gain); sound('good');
  } else sound('bad');
  s.gain = gain; s.clean = clean;
  if (s.daily) st.daily[s.daily] = { won, over, clean };
  S.totals.hopPlays = (S.totals.hopPlays || 0) + 1;
  touchDay(); save();
  checkAchievements({});
  renderHopPlay();
}
function hopHint() {
  if (!hop || hop.done) return;
  // A country on a shortest route that touches what you have so far.
  const allowed = hopAllowed(), A = hopComponent(hop.start, allowed), B = hopComponent(hop.end, allowed);
  const opt = HOP_IDS.filter(id => !allowed.has(id) && hopDist(hop.start, id) + hopDist(id, hop.end) === hopDist(hop.start, hop.end));
  const touching = opt.filter(id => BORDERS[id].some(n => A.has(n) || B.has(n)));
  const id = (touching.length ? touching : opt)[0]; if (!id) return;
  hop.hints++;
  const f = hopPlace(id), via = hopPlace(BORDERS[id].find(n => A.has(n) || B.has(n)) || hop.start);
  hopMsg(`Hint: a country starting with “${f.name[0]}” (${f.name.replace(/[^\s\-]/g, '•').length} letters) that borders ${via.name}.`, 'info');
}
function hopMsg(text, kind = '') { const el = $('#hopMsg'); if (el) { el.textContent = text; el.className = 'hop-msg ' + kind; } }
const parLabel = over => over === 0 ? 'Par' : over === 1 ? '1 over par' : `${over} over par`;
const detourBadge = d => d === 0 ? '<span class="dt d0" title="On a shortest route">✓ on route</span>' : isFinite(d) ? `<span class="dt ${d <= 2 ? 'd1' : 'd3'}" title="Extra countries this adds to the trip">+${d}</span>` : '<span class="dt dx" title="No land route">no land route</span>';

function renderHop() {
  const st = hopStats(); const today = todayKey(); const daily = st.daily[today];
  main.innerHTML = `<div class="view" style="max-width:900px">
    <div class="view-head"><div><h1>Border Hop</h1><p>Get from one country to another over land borders. Name the countries in between, using as few as you can. Matching the shortest route is par.</p></div></div>
    <div class="hop-hub">
      <div class="panel hop-daily">
        <div class="eyebrow">Daily route · ${h(fmtDate(Date.now()))}</div>
        ${daily ? `<h3>${daily.won ? `Done: ${parLabel(daily.over)}${daily.clean ? ' · in line' : ''}` : 'Done: ran out of guesses'}</h3><p class="muted">A new route arrives tomorrow.</p><button class="btn" id="hopDaily">Play it again (no stats)</button>`
          : `<h3>Today's route is ready</h3><p class="muted">One new route a day, medium difficulty.</p><button class="btn primary lg" id="hopDaily">Play the daily</button>`}
      </div>
      <div class="panel">
        <div class="eyebrow">Practice</div>
        <div class="hop-opt"><span>Difficulty</span><div class="chips">${Object.entries(HOP_DIFF).map(([k, d]) => `<button class="chip ${hopSetup.diff === k ? 'on' : ''}" data-diff="${k}">${d.name} <span class="muted">· par ${d.lo}–${d.hi}</span></button>`).join('')}</div></div>
        <div class="hop-opt"><span>Region</span><div class="chips">${HOP_REGIONS.map(([k, n]) => `<button class="chip ${hopSetup.region === k ? 'on' : ''}" data-region="${k}">${n}</button>`).join('')}</div></div>
        <button class="btn primary lg" id="hopGo">New route</button>
      </div>
    </div>
    <div class="panel hop-how">
      <h3>How it works</h3>
      <ul>
        <li>Type a country to add it to your route. You get <b>par + 4</b> guesses.</li>
        <li>Each guess shows how many extra countries it adds to the trip: <span class="dt d0">✓ on route</span> means it lies on a shortest route.</li>
        <li>Countries can be named in any order, and any connected route counts. Going <b>in line</b> (each guess bordering the chain from the start or the end) earns a 25% XP bonus.</li>
        <li>The map starts blank apart from the two ends. Each country you name appears on it, and the whole map comes back when the route is over.</li>
        <li>Only land borders count. Ferries, bridges to islands and tiny enclaves like Gibraltar, Ceuta and French Guiana are left out.</li>
      </ul>
    </div>
    <div class="tiles"><div class="tile"><div class="v num">${st.plays}</div><div class="l">Routes played</div></div><div class="tile"><div class="v num">${pct(st.wins, st.plays)}%</div><div class="l">Completed</div></div><div class="tile"><div class="v num">${st.pars}</div><div class="l">Made par</div></div><div class="tile"><div class="v num">${st.inline}</div><div class="l">In-line finishes</div></div></div>
  </div>`;
  $('#hopDaily').addEventListener('click', () => daily ? newHop(null, null, null, today) : newHop(null, null, today));
  $$('[data-diff]').forEach(b => b.addEventListener('click', () => { hopSetup.diff = b.dataset.diff; renderHop(); }));
  $$('[data-region]').forEach(b => b.addEventListener('click', () => { hopSetup.region = b.dataset.region; renderHop(); }));
  $('#hopGo').addEventListener('click', () => newHop(hopSetup.diff, hopSetup.region, null));
}
function hopMarks() {
  const m = { [hop.start]: '--accent', [hop.end]: '--accent' };
  hop.guesses.forEach(g => { m[g.id] = g.detour === 0 ? '--good' : isFinite(g.detour) && g.detour <= 2 ? '--warn' : '--bad'; });
  if (hop.done) hopBestRoute().forEach(id => { if (!m[id]) m[id] = '--info'; });
  return m;
}
function renderHopPlay() {
  const s = hop; if (!s) return go('hop');
  const A = hopPlace(s.start), B = hopPlace(s.end);
  const left = s.max - s.guesses.length;
  const route = s.done ? hopBestRoute() : null;
  const over = s.guesses.length - s.par;
  const end = s.done ? `<div class="feedback ${s.won ? 'good' : 'bad'} hop-end">
      <div><div class="fb-title">${s.won ? `${parLabel(over)}${s.clean ? ' · in line all the way' : ''}` : 'Out of guesses'}</div>
      <div class="fb-sub">${s.won ? `You linked ${h(A.name)} to ${h(B.name)} in ${s.guesses.length} guess${s.guesses.length === 1 ? '' : 'es'} (par ${s.par})${s.hints ? `, ${s.hints} hint${s.hints > 1 ? 's' : ''}` : ''}.` : `Par was ${s.par}.`} A shortest route:</div>
      <div class="hop-route">${route.map(id => { const f = hopPlace(id); return `<span class="hr-step"><img src="${f.src}" alt="">${h(f.name)}</span>`; }).join('<span class="hr-arrow">→</span>')}</div></div>
      <div class="row">${s.won ? `<span class="gain">+${s.gain} XP</span>` : ''}<button class="btn primary" id="hopNext">New route <kbd>Enter</kbd></button></div>
    </div>` : '';
  main.innerHTML = `<div class="quiz hop-play">
    <div class="quiz-top">
      <div><div class="eyebrow">Border Hop · ${s.daily ? 'Daily route' : s.replay ? 'Daily replay' : `${HOP_DIFF[s.diff]?.name || ''} · ${HOP_REGIONS.find(r => r[0] === s.region)?.[1] || ''}`}</div>
        <div class="meta"><span>Par <b>${s.par}</b></span><span>Guesses <b>${s.guesses.length}</b>/${s.max}</span>${s.done ? '' : `<span>Left <b>${left}</b></span>`}</div></div>
      <div class="row">${s.done ? '' : '<button class="btn ghost sm" id="hopGiveUp">Give up</button>'}<button class="btn ghost sm" id="hopQuit">Back</button></div>
    </div>
    <div class="hop-ends"><div class="hop-end-c"><img src="${A.src}" alt=""><div><div class="eyebrow">From</div><h2>${h(A.name)}</h2></div></div><div class="hop-arrow">⟶</div><div class="hop-end-c"><img src="${B.src}" alt=""><div><div class="eyebrow">To</div><h2>${h(B.name)}</h2></div></div></div>
    ${s.done ? end : `<div class="type-row"><input id="hopIn" type="text" list="hopList" autocomplete="off" spellcheck="false" placeholder="Name a country on the way and press Enter"><button class="btn" id="hopHint" title="Name a country on a shortest route (−10 XP)">Hint</button><button class="btn primary" id="hopAdd">Add</button></div>
    <datalist id="hopList">${HOP_GUESSABLE.map(f => `<option value="${h(f.name)}">`).join('')}</datalist>
    <div class="hop-msg" id="hopMsg"></div>`}
    <div class="hop-body">
      <div class="hop-guesses">${s.guesses.length ? s.guesses.map((g, i) => { const f = hopPlace(g.id); return `<div class="hop-g"><span class="n">${i + 1}</span><img src="${f.src}" alt=""><span class="nm">${h(f.name)}</span>${detourBadge(g.detour)}${g.inline ? '<span class="il" title="Bordered your route when you named it">in line</span>' : ''}</div>`; }).join('') : '<p class="muted">Your guesses show up here. Start next to either end and work across.</p>'}</div>
      <div id="hopMap" class="hop-map"></div>
    </div>
    <div class="hint"><kbd>Enter</kbd> to add · <kbd>Esc</kbd> to go back</div>
  </div>`;
  $('#hopQuit').addEventListener('click', () => go('hop'));
  if (s.done) $('#hopNext').addEventListener('click', () => s.daily || s.replay ? go('hop') : newHop(s.diff, s.region, null));
  else {
    const inp = $('#hopIn'); inp.focus();
    const submit = () => {
      const t = inp.value; if (!t.trim()) return;
      const f = HOP_GUESSABLE.find(x => typedMatch(t, x)?.exact) || HOP_GUESSABLE.find(x => typedMatch(t, x));
      if (!f) return hopMsg(`“${t.trim()}” isn't a country I know.`, 'bad');
      inp.value = ''; hopGuess(f);
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); } });
    $('#hopAdd').addEventListener('click', submit);
    $('#hopHint').addEventListener('click', () => { hopHint(); inp.focus(); });
    $('#hopGiveUp').addEventListener('click', () => hopFinish(false));
  }
  // globe with the route coloured in
  if (MAP_OK) {
    if (!s.map) s.map = FMMap.create({ kind: 'world', pool: universe('map').filter(f => FMMap.mapFor(f.id) === 'world').map(f => f.id), onPick: () => {} });
    $('#hopMap').appendChild(s.map.el); s.map.resize();
    s.map.setMarks(hopMarks(), { hideRest: !s.done }); // only the ends and your guesses are visible until the route is over
    const ids = [s.start, s.end, ...(s.done ? hopBestRoute() : s.guesses.filter(g => isFinite(g.detour) && g.detour <= 3).map(g => g.id))];
    if (!s.framed || s.done) { s.framed = true; setTimeout(() => s.map && s.map.fitTo([...new Set(ids)], s.done ? 700 : 0), 30); }
  }
}

// ---------- MYSTERY COUNTRY ----------
// Clues get easier one at a time. A wrong guess also reveals the next clue. Fewer clues, more points.
let myst = null, mystSetup = { region: 'world' };
const mystStats = () => S.myst || (S.myst = { plays: 0, wins: 0, dist: {} });
const MYST_POOL = D.countries.filter(f => FACTS[f.id] && (FACTS[f.id].c || []).length >= 5);
function mystClues(f) {
  const c = FACTS[f.id].c; const nb = BORDERS[f.id] || [];
  const sh = SHAPES[f.id];
  const neighbour = nb.length ? `It shares a land border with ${hopPlace(pick(nb)).name}.` : 'It has no land borders with other countries.';
  return [
    { t: 'Fact', html: h(c[0]) },
    { t: 'Fact', html: h(c[1]) },
    { t: 'Where', html: `It's in ${h(f.sub === f.region ? f.region : f.sub + ' (' + f.region + ')')}.` },
    { t: 'Fact', html: h(c[2]) },
    { t: 'Neighbours', html: h(neighbour) },
    { t: 'Fact', html: h(c[3]) },
    sh ? { t: 'Outline', html: `<span class="myst-shape">${shapeSvg(f)}</span>` } : { t: 'Size', html: 'No outline for this one, sorry: it is a very small place.' },
    { t: 'Capital', html: f.capital ? `Its capital starts with “${h(f.capital[0])}” (${f.capital.replace(/[^A-Za-zÀ-ÿ]/g, '').length} letters).` : 'No capital clue.' },
    { t: 'Fact', html: h(c[4]) },
    { t: 'Flag', html: `<img class="myst-flag" src="${f.src}" alt="">` },
  ];
}
function newMyst() {
  const pool = MYST_POOL.filter(f => mystSetup.region === 'world' || regionOfHop(f) === mystSetup.region);
  const recent = new Set((S.mystRecent || []).slice(-25));
  const fresh = pool.filter(f => !recent.has(f.id));
  const f = pick(fresh.length ? fresh : pool);
  S.mystRecent = [...(S.mystRecent || []).slice(-40), f.id];
  myst = { f, clues: mystClues(f), shown: 1, guesses: [], done: false, won: false };
  go('mystery-play');
}
function mystGuess(text) {
  const m = myst; if (!m || m.done) return;
  const g = HOP_GUESSABLE.find(x => typedMatch(text, x)?.exact) || HOP_GUESSABLE.find(x => typedMatch(text, x));
  if (!g) return mystMsg(`“${text.trim()}” isn't a country I know.`, 'bad');
  if (m.guesses.includes(g.id)) return mystMsg(`You already guessed ${g.name}.`, 'bad');
  m.guesses.push(g.id);
  if (g.id === m.f.id) return mystFinish(true);
  sound('bad');
  if (m.shown >= m.clues.length) return mystFinish(false);
  m.shown++; renderMystPlay(); mystMsg(`Not ${g.name}. Here's another clue.`, 'bad');
}
function mystFinish(won) {
  const m = myst; m.done = true; m.won = won;
  const st = mystStats(); st.plays++;
  m.points = won ? m.clues.length + 1 - m.shown : 0;
  if (won) { st.wins++; st.dist[m.shown] = (st.dist[m.shown] || 0) + 1; m.gain = 5 + m.points * 5; addXp(m.gain); sound('good'); }
  else sound('bad');
  S.totals.mystPlays = (S.totals.mystPlays || 0) + 1;
  touchDay(); save(); checkAchievements({});
  renderMystPlay();
}
function mystMsg(text, kind = '') { const el = $('#mystMsg'); if (el) { el.textContent = text; el.className = 'hop-msg ' + kind; } }
function renderMystery() {
  const st = mystStats(); const n = MYST_POOL.length;
  const maxD = Math.max(1, ...Object.values(st.dist));
  main.innerHTML = `<div class="view" style="max-width:900px">
    <div class="view-head"><div><h1>Mystery Country</h1><p>Clues start obscure and get easier. Guess the country with as few as you can: 10 points on the first clue, 1 on the last. A wrong guess reveals the next clue.</p></div></div>
    <div class="panel">
      <div class="hop-opt"><span>Countries from</span><div class="chips">${HOP_REGIONS.map(([k, nm]) => `<button class="chip ${mystSetup.region === k ? 'on' : ''}" data-region="${k}">${nm}</button>`).join('')}</div></div>
      <button class="btn primary lg" id="mystGo">New mystery</button>
      <p class="muted" style="font-size:13px">${n} countries, each with its own facts and clues.</p>
    </div>
    <div class="tiles"><div class="tile"><div class="v num">${st.plays}</div><div class="l">Played</div></div><div class="tile"><div class="v num">${pct(st.wins, st.plays)}%</div><div class="l">Solved</div></div><div class="tile"><div class="v num">${st.wins ? (Object.entries(st.dist).reduce((a, [k, v]) => a + k * v, 0) / st.wins).toFixed(1) : '–'}</div><div class="l">Average clues</div></div></div>
    ${st.wins ? `<div class="panel"><h3>Clues needed</h3><div class="myst-dist">${Array.from({ length: 10 }, (_, i) => i + 1).map(k => `<div class="md-row"><span>${k}</span><i style="width:${100 * (st.dist[k] || 0) / maxD}%"></i><b>${st.dist[k] || 0}</b></div>`).join('')}</div></div>` : ''}
  </div>`;
  $$('[data-region]').forEach(b => b.addEventListener('click', () => { mystSetup.region = b.dataset.region; renderMystery(); }));
  $('#mystGo').addEventListener('click', newMyst);
}
function renderMystPlay() {
  const m = myst; if (!m) return go('mystery');
  const f = m.f;
  const shown = m.done ? m.clues.length : m.shown;
  main.innerHTML = `<div class="quiz myst-play">
    <div class="quiz-top">
      <div><div class="eyebrow">Mystery Country</div>
        <div class="meta"><span>Clue <b>${Math.min(m.shown, m.clues.length)}</b>/${m.clues.length}</span><span>Worth <b>${m.done ? m.points : m.clues.length + 1 - m.shown}</b> pts</span></div></div>
      <div class="row">${m.done ? '' : '<button class="btn ghost sm" id="mystGiveUp">Give up</button>'}<button class="btn ghost sm" id="mystQuit">Back</button></div>
    </div>
    ${m.done ? `<div class="feedback ${m.won ? 'good' : 'bad'}"><div class="myst-ans"><img src="${f.src}" alt=""><div><div class="fb-title">${m.won ? `Got it in ${m.shown} clue${m.shown > 1 ? 's' : ''}` : 'Not this time'}</div><div class="fb-sub">It was <b>${h(f.name)}</b>${f.capital ? `, capital ${h(f.capital)}` : ''}.</div></div></div>
      <div class="row">${m.won ? `<span class="gain">+${m.gain} XP</span>` : ''}<button class="btn primary" id="mystNext">Next mystery <kbd>Enter</kbd></button></div></div>`
    : `<div class="type-row"><input id="mystIn" type="text" list="mystList" autocomplete="off" spellcheck="false" placeholder="Which country is it? Press Enter to guess"><button class="btn" id="mystMore" ${m.shown >= m.clues.length ? 'disabled' : ''}>Next clue</button><button class="btn primary" id="mystAdd">Guess</button></div>
      <datalist id="mystList">${HOP_GUESSABLE.map(x => `<option value="${h(x.name)}">`).join('')}</datalist>
      <div class="hop-msg" id="mystMsg"></div>`}
    <ol class="myst-clues">${m.clues.slice(0, shown).map((c, i) => `<li class="${i >= m.shown ? 'late' : ''} ${i === m.shown - 1 && !m.done ? 'new' : ''}"><span class="mc-n">${i + 1}</span><span class="mc-t">${c.t}</span><div class="mc-b">${c.html}</div></li>`).join('')}</ol>
    ${m.guesses.length ? `<div class="myst-wrong">${m.guesses.filter(id => id !== f.id).map(id => `<span><img src="${FLAG_BY_ID[id].src}" alt="">${h(FLAG_BY_ID[id].name)}</span>`).join('')}</div>` : ''}
    ${m.done && factsOf(f).length ? `<div class="panel"><h3>More about ${h(f.name)}</h3><ul class="myst-facts">${factsOf(f).map(x => `<li>${h(x)}</li>`).join('')}</ul></div>` : ''}
  </div>`;
  $('#mystQuit').addEventListener('click', () => go('mystery'));
  if (m.done) $('#mystNext').addEventListener('click', newMyst);
  else {
    const inp = $('#mystIn'); inp.focus();
    const submit = () => { const t = inp.value; if (!t.trim()) return; inp.value = ''; mystGuess(t); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); } });
    $('#mystAdd').addEventListener('click', submit);
    $('#mystMore').addEventListener('click', () => { if (m.shown < m.clues.length) { m.shown++; renderMystPlay(); } });
    $('#mystGiveUp').addEventListener('click', () => mystFinish(false));
  }
}

// ---------- keyboard ----------
document.addEventListener('keydown', e => {
  if (view === 'trivia-play') { if (e.key === 'Escape') finishTrivia(); return; }
  if (view === 'hop-play' || view === 'mystery-play') {
    const st = view === 'hop-play' ? hop : myst;
    if (e.key === 'Escape') go(view === 'hop-play' ? 'hop' : 'mystery');
    else if (e.key === 'Enter' && st && st.done && e.target.tagName !== 'BUTTON') { e.preventDefault(); $(view === 'hop-play' ? '#hopNext' : '#mystNext')?.click(); }
    return;
  }
  if (session && !session.done && session.answeredCurrent && (e.key === 'h' || e.key === 'H') && view === 'quiz') { holdAdvance(); return; }
  if (view === 'trivia-results') { if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') $('#tAgain')?.click(); if (e.key === 'Escape') $('#tBack')?.click(); return; }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { if (e.key === 'Escape' && session && !session.done) endSession(); else if (e.key === 'Enter' && session && !session.done && session.answeredCurrent) nextOrEnd(); return; }
  if (view === 'quiz' && session && !session.done) {
    if (e.key === 'Escape') return endSession();
    if (!session.answeredCurrent && ['1', '2', '3', '4'].includes(e.key) && session.options.length) { const b = $$('.opt')[+e.key - 1]; if (b) b.click(); return; }
    if (session.answeredCurrent && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); nextOrEnd(); }
  } else if (view === 'results') {
    if (e.key === 'Enter') $('#again')?.click();
    if (e.key === 'Escape') $('#back')?.click();
  } else if (view === 'flash' && flash) {
    if (e.key === 'Escape') return go('study');
    if (!flash.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); flash.revealed = true; renderFlash(); }
    else if (flash.revealed && e.key === '1') rateFlash(false);
    else if (flash.revealed && (e.key === '2' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); rateFlash(true); }
  }
});

// ---------- boot ----------
load(); applyTheme(); renderLevelCard(); go('play');
// Warm the image cache in the background so quizzes never show a blank frame.
setTimeout(() => { D.all.forEach(f => { const i = new Image(); i.src = f.src; }); }, 1500);
// Home-screen web app (iPhone): cache everything for offline play. Skipped in the desktop and Android apps.
if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
