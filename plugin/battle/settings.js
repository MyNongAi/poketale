import { mountLoading } from './loading.js';
import { UI_VARS, CARD_FRAME, crossIcon } from './ui-css.js';
import { isRecord, isUnreadable, unreadableLine } from '../../story/stored.mjs';
import { THEMES as THEME_IDS, DEFAULT_THEME } from '../../view/ui/theme.js';
import { DIFFICULTIES as DIFFICULTY_IDS } from '../../ai/index.js';
import { GAME_SPEEDS, DEFAULT_SPEED } from '../../view/game-speed.js';
import { QUALITIES as QUALITY_IDS } from '../../view/quality.js';
import { MAINLINE_FORMAT, CHAMPIONS_FORMAT } from '../../engine/rules.mjs';
import { EXP_SHARE_MODES } from '../../story/items.mjs';
import { BATTLE_STYLES as BATTLE_STYLE_IDS } from '../../story/rules.mjs';
import { shrinkPicture } from './my-picture.js';
import { loadFont } from '../../view/fonts.js';
import { FONT, noteRule } from '../../story/card.mjs';
import { WHAT, failureText } from '../../story/failure.mjs';
import { sayer, perLang } from '../../story/screen-text.mjs';
import { SHEET_FONT } from '../../story/style.mjs';
import { TAB_COLOR, ICON as PANEL_ICON } from '../../story/panel-html.mjs';

export const SETTINGS_KEY = 'pkb_settings';

// Languages (list order = settings row order). Labels are each language's own name
export const LANGS = [['ko', '한국어'], ['en', 'English']];

export const LANG_OPEN = false;

const OLD_LANG = 'ko';

export const langOf = tag => (/^ko\b/i.test(String(tag ?? '')) ? 'ko' : 'en');

export const hostLang = () => langOf(globalThis.navigator?.language);
export const DEFAULT_SETTINGS = Object.freeze({ iron: false, sound: false, sendFormat: 'key', theme: DEFAULT_THEME, orientation: 'portrait', lang: null, autoSend: false, aux: false, auxRecent: 8, oocTrial: false, difficulty: 'normal',
  rule: 'mainline', battleStyle: 'auto', expShare: 'always', speed: DEFAULT_SPEED, typeHints: false, moveAnims: true, quality: 'high', silhouette: true,
  looks: Object.freeze({}), oldLook: null, debug: false,
  bots: Object.freeze([]), botsOff: Object.freeze([]) });

export const DEFAULT_LOOK = Object.freeze({ gender: 'm', myBack: 'silhouette', myPicture: 'silhouette' });

const labelled = (ids, prefix) => perLang(t => Object.freeze(ids.map(id => Object.freeze([id, t(`${prefix}.${id}`)]))));

const SEND_FORMAT_IDS = ['summary', 'key', 'log'];
const RULE_IDS = ['mainline', 'champions'];
const LOOK_IDS = ['silhouette', 'color'];
const PICTURE_LOOK_IDS = [...LOOK_IDS, 'image'];
const GENDER_IDS = ['m', 'f'];
export const SEND_FORMATS = labelled(SEND_FORMAT_IDS, 'settings.sendFormat');
export const THEMES = labelled(THEME_IDS, 'settings.theme');
export const DIFFICULTIES = labelled(DIFFICULTY_IDS, 'settings.difficulty');

const RULE_FORMATS = { mainline: MAINLINE_FORMAT, champions: CHAMPIONS_FORMAT };
export const RULES = labelled(RULE_IDS, 'settings.rule');
export const EXP_SHARES = labelled(EXP_SHARE_MODES, 'settings.expShare');
export const BATTLE_STYLES = labelled(BATTLE_STYLE_IDS, 'settings.battleStyle');
export const ruleFormat = rule => RULE_FORMATS[rule];
export const SPEEDS = perLang(t => Object.freeze(GAME_SPEEDS.map(speed => Object.freeze([speed, t('settings.speed', { speed })]))));
export const QUALITIES = labelled(QUALITY_IDS, 'settings.quality');

export const LOOKS = labelled(LOOK_IDS, 'settings.look');
export const PICTURE_LOOKS = labelled(PICTURE_LOOK_IDS, 'settings.look');

// My gender = m/f of the protagonist sprites (back and front)
export const GENDERS = labelled(GENDER_IDS, 'settings.gender');

export const pictureLocked = look => look.myPicture !== 'image';

export const SEND_FORMAT_NOTES = perLang((t, lang) => Object.freeze(SEND_FORMATS(lang).map(([id, name]) => Object.freeze([name, t(`settings.sendFormatNote.${id}`)]))));

const LANG_HELP = '화면과 AI 글의 언어\nLanguage of screens and AI text';

const AUX_RECENT_COUNTS = [4, 8, 12, 24];
export const AUX_RECENTS = perLang(t => Object.freeze(AUX_RECENT_COUNTS.map(count => Object.freeze([count, t('settings.auxRecent', { count })]))));

export const ON_OFF = perLang(t => Object.freeze([Object.freeze([true, t('settings.on')]), Object.freeze([false, t('settings.off')])]));

export const SETTING_TABS = perLang((t, lang) => {
  const row = (key, options, extra = {}) => ({ key, label: t(`settings.row.${key}`), ...(options ? { options } : {}), ...('help' in extra ? {} : { help: t(`settings.help.${key}`) }), ...extra });
  const onOff = ON_OFF(lang);
  return Object.freeze([
    { id: 'battle', rows: [row('rule', RULES(lang)), row('battleStyle', BATTLE_STYLES(lang)), row('expShare', EXP_SHARES(lang)), row('iron', onOff), row('difficulty', DIFFICULTIES(lang)), row('speed', SPEEDS(lang)), row('typeHints', onOff)] },
    { id: 'screen', rows: [
      ...(LANG_OPEN ? [row('lang', LANGS, { help: LANG_HELP })] : []),
      row('sound', onOff), row('moveAnims', onOff),
      row('silhouette', LOOKS(lang), { get: s => (s.silhouette ? 'silhouette' : 'color'), set: id => ({ silhouette: id === 'silhouette' }) }),
      row('persona'),
      row('gender', GENDERS(lang), { look: true }), row('myBack', LOOKS(lang), { look: true }), row('myPicture', PICTURE_LOOKS(lang), { look: true }),
      row('theme', THEMES(lang)), row('quality', QUALITIES(lang)),
    ] },
    { id: 'story', rows: [row('sendFormat', SEND_FORMATS(lang), { help: SEND_FORMAT_NOTES(lang) }), row('autoSend', onOff, { permission: 'sendChat' }), row('aux', onOff), row('auxRecent', AUX_RECENTS(lang)), row('oocTrial', onOff), row('debug', onOff)] },
    { id: 'bot', rows: [row('bot', onOff, { help: undefined }), row('bots'), row('import')] },
  ].map(tab => Object.freeze({ ...tab, label: t(`settings.tab.${tab.id}`) })));
});

export const rowValue = (row, values, inUse = {}) => (row.get ? row.get(values) : values[row.key]) ?? inUse[row.key];

// Value chosen in a row -> settings patch
export const rowPatch = (row, id) => (row.set ? row.set(id) : { [row.key]: id });

export const POKE_BALL_ICON = '<svg viewBox="-9 -9 18 18" width="100%" height="100%" aria-hidden="true">'
  + '<circle r="9" fill="#fff" fill-opacity=".73"/><circle r="7.5" fill="#18242e"/>'
  + '<path d="M-5.94-.84A6 6 0 0 1 5.94-.84Z" fill="#e3343f"/><path d="M-5.94.84A6 6 0 0 0 5.94.84Z" fill="#fff"/>'
  + '<circle r="2.64" fill="#18242e"/><circle r="1.56" fill="#fff"/></svg>';

const pick = (v, ids, dflt) => (ids.includes(v) ? v : dflt);

const normalizeLook = l => ({
  gender: pick(l.gender, GENDER_IDS, null),
  myBack: pick(l.myBack, LOOK_IDS, DEFAULT_LOOK.myBack),
  myPicture: pick(l.myPicture, PICTURE_LOOK_IDS, DEFAULT_LOOK.myPicture),
});

const lookMap = value => Object.fromEntries(Object.entries(isRecord(value) ? value : {})
  .filter(([name, look]) => name && isRecord(look)).map(([name, look]) => [name, normalizeLook(look)]));

export function normalizeSettings(raw) {
  let value = raw;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = null; } }
  const s = value && typeof value === 'object' ? value : {};
  return {
    iron: s.iron === true,
    sound: s.sound === true,
    sendFormat: pick(s.sendFormat, SEND_FORMAT_IDS, DEFAULT_SETTINGS.sendFormat),
    theme: pick(s.theme, THEME_IDS, DEFAULT_SETTINGS.theme),
    orientation: 'portrait',
    lang: pick(s.lang, LANGS.map(([id]) => id), null),
    autoSend: s.autoSend === true,
    aux: s.aux === true,
    auxRecent: pick(s.auxRecent, AUX_RECENT_COUNTS, DEFAULT_SETTINGS.auxRecent),
    oocTrial: s.oocTrial === true,
    difficulty: pick(s.difficulty, DIFFICULTY_IDS, DEFAULT_SETTINGS.difficulty),
    rule: pick(s.rule, RULE_IDS, DEFAULT_SETTINGS.rule),
    battleStyle: pick(s.battleStyle, BATTLE_STYLE_IDS, DEFAULT_SETTINGS.battleStyle),
    expShare: pick(s.expShare, EXP_SHARE_MODES, DEFAULT_SETTINGS.expShare),
    speed: pick(s.speed, GAME_SPEEDS, DEFAULT_SETTINGS.speed),
    typeHints: s.typeHints === true,
    moveAnims: s.moveAnims !== false,
    quality: pick(s.quality, QUALITY_IDS, DEFAULT_SETTINGS.quality),
    silhouette: s.silhouette !== false,
    debug: s.debug === true,
    looks: lookMap(s.looks),
    oldLook: isRecord(s.oldLook) ? normalizeLook(s.oldLook) : null,
    bots: nameList(s.bots),
    botsOff: nameList(s.botsOff),
  };
}

const storedLook = (settings, name) => (name && Object.hasOwn(settings.looks, name) ? settings.looks[name] : null);

export const lookOf = (settings, name) => {
  const look = storedLook(settings, name);
  return look ? { ...look, gender: look.gender ?? DEFAULT_LOOK.gender } : DEFAULT_LOOK;
};

// This persona's chosen gender ('m' | 'f'), null when not chosen or the name is unknown
export const chosenGender = (settings, name) => storedLook(settings, name)?.gender ?? null;

export const shownLook = (settings, name) => ({ ...lookOf(settings, name), gender: chosenGender(settings, name) });

export const setLook = (settings, name, patch) => normalizeSettings({ ...settings, looks: { ...settings.looks, [name]: { ...storedLook(settings, name), ...patch } } });

export const adoptOldLook = (settings, name) => (settings.oldLook
  ? normalizeSettings({ ...settings, looks: { [name]: settings.oldLook, ...settings.looks }, oldLook: null }) : settings);

export const AUTO_BOT_WORDS = ['포켓몬', 'poké', 'pokemon'];

const BOT_NAME_MAX = 200;

export const botKey = name => String(name ?? '').normalize('NFC').trim().toLowerCase();

export const autoBot = name => { const key = botKey(name); return AUTO_BOT_WORDS.some(word => key.includes(word)); };

function nameList(value) {
  const seen = new Set(), out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim(), key = botKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(name);
  }
  return out;
}
const hasName = (list, name) => list.some(other => botKey(other) === botKey(name));

// Whether the features are enabled for the bot with this name
export function botEnabled(settings, name) {
  if (!botKey(name)) return false;
  const s = normalizeSettings(settings);
  if (hasName(s.botsOff, name)) return false;
  return autoBot(name) || hasName(s.bots, name);
}

export function setBotEnabled(settings, name, on) {
  const s = normalizeSettings(settings);
  const trimmed = String(name ?? '').trim();
  if (!botKey(trimmed)) return s;
  const bots = s.bots.filter(other => botKey(other) !== botKey(trimmed));
  const botsOff = s.botsOff.filter(other => botKey(other) !== botKey(trimmed));
  if (on && !autoBot(trimmed)) bots.push(trimmed);
  if (!on && autoBot(trimmed)) botsOff.push(trimmed);
  return normalizeSettings({ ...s, bots, botsOff });
}

export function botsSwitched(before, next) {
  const b = normalizeSettings(before), n = normalizeSettings(next);
  return nameList([...b.bots, ...b.botsOff, ...n.bots, ...n.botsOff])
    .filter(name => botEnabled(b, name) !== botEnabled(n, name))
    .map(name => ({ name, on: botEnabled(n, name) }));
}

export const SETTINGS_VERSION = 1;

export const settingsUnreadable = lang => failureText(WHAT.settings, 'unreadable', lang);

export function readSettings(raw) {
  const fallback = status => ({ settings: normalizeSettings({ lang: OLD_LANG }), status });
  if (raw === undefined || raw === null || raw === '') return { settings: normalizeSettings(null), status: 'none' };
  let value = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { return fallback('corrupt'); } }
  if (!isRecord(value)) return fallback('corrupt');
  if ((value.v ?? SETTINGS_VERSION) !== SETTINGS_VERSION) return fallback('unsupported');

  const old = Object.keys(DEFAULT_LOOK).some(key => key in value);

  const lang = 'lang' in value ? value.lang : OLD_LANG;
  return { settings: normalizeSettings({ ...value, lang, ...(old ? { oldLook: value } : {}) }), status: 'ok' };
}
export async function loadSettings(storage) {
  let raw;
  try { raw = await storage?.getItem?.(SETTINGS_KEY); } catch { return { settings: normalizeSettings({ lang: OLD_LANG }), status: 'corrupt' }; }
  return readSettings(raw);
}
export async function saveSettings(storage, settings) {
  await storage?.setItem?.(SETTINGS_KEY, JSON.stringify({ v: SETTINGS_VERSION, ...normalizeSettings(settings) }));
}

const SETTINGS_Z = 300;

const TAB_COLORS = { battle: TAB_COLOR.party, screen: TAB_COLOR.box, story: TAB_COLOR.bag, bot: '#3f8f5a' };
const TAB_ICONS = {
  battle: PANEL_ICON.party,
  screen: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="13" height="9" rx="1.5" fill="#fff" stroke="#18242e" stroke-width="1.5"/>'
    + `<path d="M5 14h6" stroke="#fff" stroke-width="1.5"/><circle cx="6" cy="7.5" r="1.4" fill="${TAB_COLORS.screen}"/><path d="M3.5 11l3-3 2 2 2.5-3 2 4z" fill="${TAB_COLORS.screen}"/></svg>`,
  story: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5h8l3 3v8h-11z" fill="#fff" stroke="#18242e" stroke-width="1.5"/>'
    + `<path d="M5 7h6M5 9.5h6M5 12h4" stroke="${TAB_COLORS.story}" stroke-width="1.4"/></svg>`,
  bot: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="4.5" width="11" height="9" rx="2" fill="#fff" stroke="#18242e" stroke-width="1.5"/>'
    + `<path d="M8 1.8v2.7" stroke="#fff" stroke-width="1.5"/><circle cx="6" cy="9" r="1.2" fill="${TAB_COLORS.bot}"/><circle cx="10" cy="9" r="1.2" fill="${TAB_COLORS.bot}"/></svg>`,
};

const CURSOR = '<svg class="cur" viewBox="0 0 8 10" aria-hidden="true"><path d="M1 0h2l5 5-5 5H1z" fill="currentColor"/></svg>';

export function importLabel({ count }, lang) {
  return sayer(lang)('settings.importLabel', { count });
}

export function mountSettings({ parent = document.body, settings, bot = null, persona = null, notice = '', picture = null, imports = null, inUse = {}, lang,
  onChange = () => {}, onPicture = async () => {}, onPermission = async () => false, onImport = async () => {}, onCancelImport = async () => imports, onClose = () => {} }) {
  const t = sayer(lang);
  const NEEDS_CHAT = t('settings.needsChat');
  let current = normalizeSettings(settings);
  loadFont(SHEET_FONT).catch(error => console.warn('[poke-battle] 설정 창 글꼴을 올리지 못함 — 대체 글꼴로', error));
  const root = document.createElement('section');
  root.className = 'pkb-settings';
  root.innerHTML = `<style>
    .pkb-settings { ${UI_VARS}
      position:fixed; inset:0; z-index:${SETTINGS_Z}; overflow:auto; display:flex; justify-content:center; align-items:flex-start; padding:24px 16px;
      background:#0f1822; font:14px/1.45 ${FONT}; font-weight:400; color:#14304a; }
    .pkb-settings * { box-sizing:border-box; }
    .pkb-settings button { font:inherit; }
    .pkb-settings button:focus-visible { outline:2px solid #ffcf4a; outline-offset:2px; }
    .pkb-settings .card { width:min(420px, 100%); height:640px; max-height:100%; display:flex; flex-direction:column; overflow:hidden; ${CARD_FRAME} }
    .pkb-settings .hd { flex:none; display:flex; align-items:center; gap:8px; min-height:36px; padding:6px 8px 6px 12px; background:var(--navy); color:#fff; border-bottom:2.5px solid var(--navy-dark); }
    .pkb-settings .hd .pb { flex:none; width:18px; height:18px; margin:0 -1.5px; } /* 15px ball + 1.5px white rim (takes only the ball's room) */
    .pkb-settings .hd .pb svg { display:block; }
    .pkb-settings .hd b { flex:1; font-weight:400; font-size:15px; letter-spacing:.02em; }
    .pkb-settings .hd button { width:26px; height:26px; padding:0; display:flex; align-items:center; justify-content:center; border:2px solid #fff; border-radius:7px;
      background:transparent; color:#fff; cursor:pointer; }
    .pkb-settings .hd button svg { width:12px; height:12px; }
    ${noteRule('.pkb-settings .notice', 'error')}
    .pkb-settings .notice { flex:none; margin:8px 10px 0; font-size:13px; }
    /* Tabs: coloured tabs, the current one joins the panel below */
    .pkb-settings .tabs { flex:none; display:flex; gap:4px; padding:8px 10px 0; background:linear-gradient(#cfdfeb,#e3eef6); border-bottom:2.5px solid var(--navy); }
    .pkb-settings .tab { flex:1; min-width:0; display:flex; align-items:center; justify-content:center; gap:6px; height:34px; padding:0 4px; border:2.5px solid var(--navy); border-bottom:none;
      border-radius:9px 9px 0 0; color:#fff; font-size:13px; white-space:nowrap; cursor:pointer; opacity:.62; transform:translateY(3px); transition:transform .12s, opacity .12s; }
    .pkb-settings .tab svg { flex:none; display:block; width:16px; height:16px; }
    .pkb-settings .tab[aria-selected="true"] { opacity:1; transform:translateY(2.5px); height:36px; box-shadow:inset 0 -3px 0 rgba(0,0,0,.12); }
    /* Rows: cursor · name · choices (the picture and bot name fields start at the name on the line below) */
    .pkb-settings .list { flex:1; min-height:0; overflow:auto; padding:8px 10px 10px; }
    .pkb-settings .page[hidden] { display:none; }
    .pkb-settings .row { display:grid; grid-template-columns:18px 1fr auto; align-items:center; gap:4px 6px; min-height:46px; padding:6px 6px 6px 2px; border-bottom:1.5px dashed #b9cddc; }
    .pkb-settings .row:last-child { border-bottom:none; }
    .pkb-settings .cur { width:14px; height:14px; visibility:hidden; color:var(--red); }
    .pkb-settings .row.on .cur { visibility:visible; }
    .pkb-settings .lab { min-width:0; overflow-wrap:anywhere; }
    .pkb-settings .row.off .lab { opacity:.55; }
    /* Choices: text only, the chosen one white on red */
    .pkb-settings .opts { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:2px; }
    .pkb-settings .opt { min-width:38px; padding:5px 7px 4px; border:none; border-radius:6px; background:transparent; color:#9aaab7; font-size:13px; cursor:pointer; }
    .pkb-settings .opt[aria-checked="false"]:not(:disabled):hover { color:#23435f; }
    .pkb-settings .opt[aria-checked="true"] { color:#fff; background:var(--red); box-shadow:0 2px 0 var(--red-dark); }
    .pkb-settings .opt:disabled { cursor:default; }
    .pkb-settings .row.off .opt[aria-checked="true"] { opacity:.45; }
    /* Buttons (picture field, adding a bot name) */
    .pkb-settings .btn { flex:none; padding:5px 9px 4px; border:2px solid var(--navy); border-radius:7px; background:#fff; color:#23435f; font-size:12px;
      box-shadow:0 2px 0 var(--navy-dark); cursor:pointer; }
    .pkb-settings .btn:not(:disabled):active { transform:translateY(2px); box-shadow:none; }
    .pkb-settings .btn:disabled { cursor:default; box-shadow:none; }
    /* My picture field: open only for "picture" */
    .pkb-settings .pic { grid-column:2 / 4; display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:4px 0 2px; padding:8px; border:1.5px solid #789db7; border-radius:9px;
      background:#f4f9fc; box-shadow:0 2px 0 #466c87; }
    .pkb-settings .pic.locked { display:none; }
    .pkb-settings .pic .preview { flex:none; width:44px; height:52px; display:flex; align-items:center; justify-content:center; overflow:hidden;
      border:1.5px solid #8fb0c8; border-radius:7px; background:#dbe8f2; }
    .pkb-settings .pic .preview img { display:block; max-width:100%; max-height:100%; }
    .pkb-settings .pic .btns { display:flex; flex-wrap:wrap; gap:6px; }
    .pkb-settings .pic:not(.locked) .btn:disabled { opacity:.45; }
    ${noteRule('.pkb-settings .pic .fail', 'error')}
    .pkb-settings .pic .fail { flex-basis:100%; margin:0 0 3px; font-size:12px; }
    .pkb-settings .pic .fail[hidden] { display:none; }
    /* Bot name field */
    .pkb-settings .add { grid-column:2 / 4; display:flex; gap:6px; margin-top:4px; }
    .pkb-settings .add input { flex:1; min-width:0; font:inherit; font-size:13px; padding:6px 8px; border:2px solid var(--navy); border-radius:7px; background:#fff; color:#23435f; }
    .pkb-settings .add input:focus-visible { outline:2px solid #ffcf4a; outline-offset:1px; }
    .pkb-settings .names { grid-column:2 / 4; display:flex; flex-wrap:wrap; gap:6px; margin-top:2px; }
    .pkb-settings .names[hidden] { display:none; }
    .pkb-settings .chip { display:inline-flex; align-items:center; gap:2px; max-width:100%; padding:1px 2px 1px 8px; border-radius:999px; background:#e4edf4;
      box-shadow:inset 0 0 0 1.5px #a8bccc; color:var(--navy); font-size:12px; }
    .pkb-settings .chip > span { overflow-wrap:anywhere; }
    .pkb-settings .chip.off { background:#eef0f2; box-shadow:inset 0 0 0 1.5px #c3cad0; color:#87929b; }
    .pkb-settings .chip .tag { margin-right:4px; font-size:11px; }
    .pkb-settings .chip button { flex:none; width:20px; height:20px; padding:0; display:flex; align-items:center; justify-content:center; border:0; border-radius:50%;
      background:transparent; color:inherit; cursor:pointer; }
    .pkb-settings .chip button svg { width:8px; height:8px; }
    /* Import row: open button; past imports, each with cancel (asked once more) */
    .pkb-settings .imports { grid-column:2 / 4; display:flex; flex-wrap:wrap; gap:6px; margin-top:2px; }
    .pkb-settings .imports[hidden] { display:none; }
    .pkb-settings .chip .ask { display:inline-flex; gap:2px; margin-left:4px; }
    .pkb-settings .chip .ask button { width:auto; height:20px; padding:0 6px; border-radius:999px; font-size:11px; }
    .pkb-settings .chip .ask .yes { background:var(--red); color:#fff; }
    ${noteRule('.pkb-settings .import-fail', 'error')}
    .pkb-settings .import-fail { grid-column:2 / 4; margin:4px 0 2px; font-size:12px; }
    .pkb-settings .import-fail[hidden] { display:none; }
    /* Message window: the chosen row's description + a blinking red triangle at the bottom right */
    .pkb-settings .msg { flex:none; position:relative; min-height:76px; margin:0 10px 10px; padding:9px 12px; border:3px solid #4f6f8a; border-radius:10px; background:#fff;
      box-shadow:inset 0 0 0 2px #dbe8f2, 0 3px 0 #466c87; font-size:13px; line-height:1.55; white-space:pre-line; word-break:keep-all; overflow-wrap:anywhere; }
    .pkb-settings .msg::after { content:""; position:absolute; right:10px; bottom:8px; border:5px solid transparent; border-top:6px solid var(--red); border-bottom:0;
      animation:pkb-settings-blink 1s steps(2) infinite; }
    .pkb-settings .terms { display:grid; grid-template-columns:auto 1fr; gap:5px 8px; margin:0; white-space:normal; }
    .pkb-settings .terms dt { color:var(--red); -webkit-text-stroke:.35px var(--red); }
    .pkb-settings .terms dd { margin:0; min-width:0; }
    @keyframes pkb-settings-blink { 50% { opacity:0; } }
    @media (prefers-reduced-motion:reduce) { .pkb-settings .msg::after { animation:none; } .pkb-settings .tab { transition:none; } }
    /* Phones: the window fills the screen, only the list scrolls, the message window at the bottom */
    @media (max-width:640px) {
      .pkb-settings { padding:0; }
      .pkb-settings .card { width:100%; height:100%; border:0; border-radius:0; box-shadow:none; }
    }
  </style><div class="card" role="dialog" aria-labelledby="pkb-settings-title">
    <div class="hd"><span class="pb">${POKE_BALL_ICON}</span><b id="pkb-settings-title">${t('settings.title')}</b>
      <button class="x" type="button" aria-label="${t('settings.close')}" title="${t('settings.close')}">${crossIcon(2.8)}</button></div>
    <div class="tabs" role="tablist"></div>
    <div class="list"></div>
    <div class="msg" aria-live="polite"></div>
  </div>`;
  parent.append(root);
  const tabBar = root.querySelector('.tabs'), list = root.querySelector('.list'), msg = root.querySelector('.msg');
  if (notice) {
    const line = document.createElement('p'); line.className = 'notice'; line.setAttribute('role', 'alert'); line.textContent = notice;
    tabBar.before(line);
  }

  // Selected row and message box
  const helps = new Map();
  let picked = null;
  const drawHelp = () => {
    const help = picked ? helps.get(picked)() : '';
    if (typeof help === 'string') { msg.textContent = help; return; }
    const terms = document.createElement('dl'); terms.className = 'terms';
    for (const [term, text] of help) {
      const dt = document.createElement('dt'); dt.textContent = `${term}:`;
      const dd = document.createElement('dd'); dd.textContent = text;
      terms.append(dt, dd);
    }
    msg.replaceChildren(terms);
  };
  const pick = row => {
    picked?.classList.remove('on'); row.classList.add('on');
    picked = row;
    drawHelp();
  };

  const line = (page, label, help, control) => {
    const r = document.createElement('div'); r.className = 'row'; r.innerHTML = CURSOR;
    const name = document.createElement('span'); name.className = 'lab'; name.textContent = label;
    r.append(name, control ?? document.createElement('span'));
    helps.set(r, help);
    for (const type of ['pointerenter', 'click', 'focusin']) r.addEventListener(type, () => pick(r));
    page.append(r);
    return r;
  };
  const setChoice = (group, id) => { for (const b of group.children) b.setAttribute('aria-checked', String(b.dataset.id === String(id))); };

  const choices = (list, value, label, change, disabled = false) => {
    const g = document.createElement('div'); g.className = 'opts'; g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', label);
    for (const [id, name] of list) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'opt'; b.setAttribute('role', 'radio');
      b.textContent = name; b.dataset.id = String(id); b.disabled = disabled;
      b.onclick = () => { setChoice(g, id); change(id); };
      g.append(b);
    }
    setChoice(g, value);
    return g;
  };
  const button = (label, press) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.textContent = label; b.onclick = press; return b;
  };
  const commit = next => { current = next; Promise.resolve(onChange(current)).catch(console.error); };

  const pic = document.createElement('div'); pic.className = 'pic';
  const preview = document.createElement('span'); preview.className = 'preview';
  const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
  const failLine = document.createElement('p'); failLine.className = 'fail'; failLine.setAttribute('role', 'alert'); failLine.hidden = true;
  let image = picture, busy = false;

  const setPicture = async next => {
    busy = true; failLine.hidden = true; drawPicture();
    try { await onPicture(next); image = next; } catch (error) {
      console.warn('[poke-battle] 내 그림을 저장하지 못함', error);
      failLine.textContent = failureText(next ? WHAT.picture : WHAT.pictureRemove, error, lang); failLine.hidden = false;
    } finally { busy = false; drawPicture(); }
  };
  const uploadButton = button(t('settings.upload'), () => fileInput.click());
  const changeButton = button(t('settings.change'), () => fileInput.click());
  const removeButton = button(t('settings.remove'), () => setPicture(null));
  fileInput.onchange = async () => {
    const [file] = fileInput.files; fileInput.value = '';
    if (!file) return;
    let next;
    try { next = await shrinkPicture(file); } catch (error) {
      console.warn('[poke-battle] 고른 파일을 그림으로 읽지 못함', error);
      failLine.textContent = failureText(WHAT.picture, 'notPicture', lang); failLine.hidden = false;
      return;
    }
    await setPicture(next);
  };
  const picButtons = document.createElement('div'); picButtons.className = 'btns';
  picButtons.append(uploadButton, changeButton, removeButton);
  pic.append(preview, picButtons, fileInput, failLine);
  function drawPicture() {
    const locked = pictureLocked(lookOf(current, persona));
    pic.classList.toggle('locked', locked);
    pic.setAttribute('aria-disabled', String(locked));
    uploadButton.disabled = locked || busy || !!image;
    changeButton.disabled = removeButton.disabled = locked || busy || !image;
    if (image && preview.firstChild?.src !== image) preview.replaceChildren(Object.assign(document.createElement('img'), { src: image, alt: t('settings.myPictureAlt') }));
    else if (!image) preview.replaceChildren();
  }

  const enabledNow = () => !!bot?.name && botEnabled(current, bot.name);
  const botSub = !bot ? NEEDS_CHAT
    : `${bot.name || t('settings.noNameBot')}${autoBot(bot.name) ? ` · ${t('settings.autoBot')}` : ''}${bot.compat ? `\n${bot.compat}\n${t('settings.compatHint')}` : ''}`;
  let botChoices = null, hinted = false;
  const botHelp = text => () => (hinted ? `${text}\n${t('settings.botRedraw')}` : text);
  const names = document.createElement('div'); names.className = 'names';
  const form = document.createElement('div'); form.className = 'add';
  const input = document.createElement('input');
  Object.assign(input, { type: 'text', placeholder: t('settings.botName'), maxLength: BOT_NAME_MAX });
  input.setAttribute('aria-label', t('settings.botNameToAdd'));

  const changeBots = next => {
    const before = enabledNow();
    current = normalizeSettings(next);
    Promise.resolve(onChange(current)).catch(console.error);
    const after = enabledNow();
    if (bot?.name && before !== after) { hinted = true; drawHelp(); }
    drawBots();
    drawImports();
  };
  const chip = (name, off) => {
    const c = document.createElement('span'); c.className = `chip${off ? ' off' : ''}`;
    if (off) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = t('settings.offTag'); c.append(tag); }
    const label = document.createElement('span'); label.textContent = name;
    const remove = document.createElement('button'); remove.type = 'button';
    remove.innerHTML = crossIcon(3);
    const what = t(off ? 'settings.botOn' : 'settings.botRemove', { name });
    remove.setAttribute('aria-label', what); remove.title = what;
    remove.onclick = () => changeBots(off ? { ...current, botsOff: current.botsOff.filter(n => n !== name) } : { ...current, bots: current.bots.filter(n => n !== name) });
    c.append(label, remove);
    return c;
  };
  function drawBots() {
    names.replaceChildren(...current.bots.map(n => chip(n, false)), ...current.botsOff.map(n => chip(n, true)));
    names.hidden = !names.childElementCount;
    if (botChoices) setChoice(botChoices, enabledNow());
  }
  const addName = () => {
    const name = input.value.trim();
    if (!name) return;
    input.value = '';
    changeBots({ ...current, bots: [...current.bots, name], botsOff: current.botsOff.filter(n => botKey(n) !== botKey(name)) });
  };
  form.append(input, button(t('settings.add'), addName));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addName(); } });

  let pastImports = imports, importBusy = false, asking = null;
  const importButton = button(t('settings.open'), async () => {
    importBusy = true; importFail.hidden = true; drawImports();
    try { await onImport(); } catch (error) {
      console.warn('[poke-battle] 가져오기 화면을 열지 못함', error);
      importFail.textContent = failureText(WHAT.importOpen, error, lang); importFail.hidden = false;
    } finally { importBusy = false; drawImports(); }
  });
  const importList = document.createElement('div'); importList.className = 'imports';
  const importFail = document.createElement('p'); importFail.className = 'import-fail'; importFail.setAttribute('role', 'alert'); importFail.hidden = true;
  const cancelPast = async id => {
    importBusy = true; asking = null; importFail.hidden = true; drawImports();
    try { pastImports = await onCancelImport(id); } catch (error) {
      console.warn('[poke-battle] 가져오기를 취소하지 못함', error);
      importFail.textContent = failureText(WHAT.importCancel, error, lang); importFail.hidden = false;
    } finally { importBusy = false; drawImports(); drawHelp(); }
  };
  const importChip = imp => {
    const c = document.createElement('span'); c.className = 'chip';
    const label = document.createElement('span'); label.textContent = importLabel(imp, lang);
    c.append(label);
    if (asking === imp.id) {
      const ask = document.createElement('span'); ask.className = 'ask';
      const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'yes'; yes.textContent = t('settings.cancelIt'); yes.onclick = () => cancelPast(imp.id);
      const no = document.createElement('button'); no.type = 'button'; no.textContent = t('settings.keep'); no.onclick = () => { asking = null; drawImports(); };
      ask.append(yes, no); c.append(ask);
      return c;
    }
    const remove = document.createElement('button'); remove.type = 'button'; remove.innerHTML = crossIcon(3); remove.disabled = importBusy;
    const what = t('settings.cancelImport', { label: importLabel(imp, lang) });
    remove.setAttribute('aria-label', what); remove.title = what;
    remove.onclick = () => { asking = imp.id; drawImports(); };
    c.append(remove);
    return c;
  };
  function drawImports() {
    importButton.disabled = importBusy || !enabledNow();
    importRow?.classList.toggle('off', !enabledNow());
    const list = pastImports?.list ?? [];
    importList.replaceChildren(...list.map(importChip));
    importList.hidden = !list.length;
  }

  const importHelp = row => () => {
    if (!bot) return NEEDS_CHAT;
    if (!enabledNow()) return t('settings.importNeedsOn');
    return isUnreadable(pastImports?.status) ? `${row.help}\n${unreadableLine(lang)}` : row.help;
  };
  let importRow = null;

  const pages = new Map();
  for (const tab of SETTING_TABS(lang)) {
    const tabButton = document.createElement('button'); tabButton.type = 'button'; tabButton.className = 'tab'; tabButton.setAttribute('role', 'tab'); tabButton.dataset.tab = tab.id;
    tabButton.style.background = TAB_COLORS[tab.id];
    tabButton.innerHTML = TAB_ICONS[tab.id]; tabButton.append(tab.label);
    tabButton.onclick = () => showTab(tab.id);
    tabBar.append(tabButton);
    const page = document.createElement('div'); page.className = 'page'; page.setAttribute('role', 'tabpanel'); page.setAttribute('aria-label', tab.label);
    list.append(page); pages.set(tab.id, page);
    for (const row of tab.rows) {
      if (row.key === 'bot') {
        botChoices = choices(row.options, enabledNow(), row.label, on => changeBots(setBotEnabled(current, bot.name, on)), !bot?.name);
        line(page, row.label, botHelp(botSub), botChoices).classList.toggle('off', !bot?.name);
      } else if (row.key === 'bots') {
        line(page, row.label, botHelp(row.help)).append(form, names);
      } else if (row.key === 'import') {
        importRow = line(page, row.label, importHelp(row), importButton);
        importRow.append(importList, importFail);
      } else if (row.key === 'persona') {
        line(page, t('settings.personaOf', { label: row.label, name: persona ?? t('settings.unknown') }), () => (persona ? row.help : NEEDS_CHAT)).classList.toggle('off', !persona);
      } else if (row.look) {
        const r = line(page, row.label, () => row.help, choices(row.options, rowValue(row, shownLook(current, persona)), row.label, id => {
          commit(setLook(current, persona, rowPatch(row, id)));
          if (row.key === 'myPicture') drawPicture();
        }, !persona));
        r.classList.toggle('off', !persona);
        if (row.key === 'myPicture') r.append(pic);
      } else {
        const group = choices(row.options, rowValue(row, current, inUse), row.label, async id => {
          if (row.permission && id === true && rowValue(row, current) !== true && !(await onPermission(row.permission))) {
            setChoice(group, rowValue(row, current));
            return;
          }
          commit(normalizeSettings({ ...current, ...rowPatch(row, id) }));
        });
        line(page, row.label, () => row.help, group);
      }
    }
  }
  function showTab(id) {
    for (const tabButton of tabBar.children) tabButton.setAttribute('aria-selected', String(tabButton.dataset.tab === id));
    for (const [key, page] of pages) page.hidden = key !== id;
    list.scrollTop = 0;
    pick(pages.get(id).firstElementChild);
  }
  drawPicture();
  drawBots();
  drawImports();
  showTab(SETTING_TABS(lang)[0].id);

  let closed = false;
  const close = async () => { if (closed) return; closed = true; try { await onClose(); } finally { root.remove(); } };
  root.querySelector('.hd .x').onclick = close;
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  root.addEventListener('pointerdown', e => { if (e.target === root) close(); });
  root.querySelector('.hd .x').focus();
  return { close, get settings() { return current; }, setImports(next) { pastImports = next; asking = null; drawImports(); drawHelp(); } };
}

export function mountPreparing({ parent = document.body, lang }) {
  const preparing = mountLoading(parent, { page: true, lang });
  preparing.element.style.zIndex = SETTINGS_Z;
  return preparing;
}
