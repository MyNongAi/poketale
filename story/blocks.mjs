import speciesTable from '../data/names/species.json' with { type: 'json' };
import movesTable from '../data/names/moves.json' with { type: 'json' };
import abilitiesTable from '../data/names/abilities.json' with { type: 'json' };
import itemsTable from '../data/names/items.json' with { type: 'json' };
import storyNames from '../data/story-names.json' with { type: 'json' };
import { PARTY_MAX, MAX_LEVEL, MAX_MOVES, MAX_IV, OT_NAME_MAX } from './rules.mjs';
import { STATS } from '../engine/mon.mjs';
import { toID } from '../names/index.js';
import { DEFAULT_EMOJI, customItemId, splitEmoji } from './custom-items.mjs';
import { ruleNote } from './failure.mjs';

export const norm = s => String(s ?? '').normalize('NFKC').replace(/♀/g, 'f').replace(/♂/g, 'm').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const TABLES = { species: speciesTable, moves: movesTable, abilities: abilitiesTable, items: itemsTable };
const reverse = {};

function buildReverse(kind) {
  const names = new Map(), aliases = new Map();
  const add = (k, id) => { if (!k) return; const old = names.get(k); if (old === undefined || id.length < old.length) names.set(k, id); };
  const alias = (k, id) => { if (!k) return; aliases.set(k, aliases.has(k) && aliases.get(k) !== id ? null : id); };
  for (const [id, r] of Object.entries(TABLES[kind])) {
    if (r.en) add(toID(r.en), id), add(norm(r.en), id);
    if (!r.ko) continue;
    add(norm(r.ko), id);

    const m = /^(.+?)\s*\((.+)\)$/.exec(r.ko);
    if (kind !== 'species' || !m) continue;
    const base = norm(m[1]), inner = norm(m[2]);
    if (inner.includes(base)) alias(inner, id);
    const region = /^(.+)의 ?모습$/.exec(m[2].trim());
    if (region) alias(norm(region[1]) + base, id), alias(base + norm(region[1]), id);
  }
  return reverse[kind] = { names, aliases };
}

export function lookupId(kind, raw) {
  const table = TABLES[kind];
  if (!table) throw new TypeError(`모르는 이름표: ${kind}`);
  const id = toID(raw);
  if (id && Object.hasOwn(table, id)) return id;
  const { names, aliases } = reverse[kind] ?? buildReverse(kind);
  const k = norm(raw);
  return names.get(id) ?? names.get(k) ?? aliases.get(k) ?? (kind === 'items' ? tmId(raw) : null);
}

let tmByMove;
function tmId(raw) {
  const m = /^\s*(?:tm|기술\s*머신)\s*[-:.#]?\s*(.+?)\s*$/i.exec(raw) ?? /^\s*(.+?)\s*[-:.]?\s*(?:tm|기술\s*머신)\s*$/i.exec(raw);
  if (!m) return null;
  if (/^\d{1,3}$/.test(m[1])) {
    const id = `tm${m[1].padStart(3, '0')}`;
    return Object.hasOwn(itemsTable, id) ? id : null;
  }
  tmByMove ??= new Map(Object.entries(itemsTable).filter(([, r]) => r.move).map(([id, r]) => [r.move, id]));
  const move = lookupId('moves', m[1]);
  return (move && tmByMove.get(move)) ?? null;
}

export function speciesName(raw) {
  const id = lookupId('species', raw);
  return id ? speciesTable[id].en : null;
}

const note = (rule, values) => ruleNote(`block.${rule}`, values);

function need(kind, raw, errors) {
  const id = lookupId(kind, raw);
  if (!id) errors.push(note(`unknown.${kind}`, { name: String(raw).trim() }));
  return id;
}

// Short word tables: normalized name -> value
const words = groups => {
  const m = new Map();
  for (const [value, list] of Object.entries(groups)) for (const w of list) m.set(norm(w), value);
  return m;
};
const GENDER = words({ M: ['male', 'm', '♂', 'boy', 'man', '남', '남자', '남성', '수컷', '수'], F: ['female', 'f', '♀', 'girl', 'woman', '여', '여자', '여성', '암컷', '암'] });
const STATUS = words({
  '': ['none', 'ok', 'healthy', '없음', '정상', '건강'],
  par: ['par', 'paralysis', 'paralyzed', '마비'], brn: ['brn', 'burn', 'burned', '화상'], slp: ['slp', 'sleep', 'asleep', '잠듦', '잠', '수면', '잠듬'],
  frz: ['frz', 'freeze', 'frozen', '얼음', '동결'], psn: ['psn', 'poison', 'poisoned', '독'], tox: ['tox', 'toxic', 'badlypoisoned', '맹독'],
});

const SHINY = words({
  yes: ['yes', 'y', 'true', 'on', 'o', '1', 'shiny', '예', '네', '응', '맞음', '맞다', '이로치', '색이다름'],
  no: ['no', 'n', 'false', 'off', 'x', '0', 'not', 'none', 'nope', 'normal', '아니', '아님', '아니오', '아니요', '아니다', '없음', '일반', '보통'],
});
const NOT_SHINY = new Set(['notshiny', 'nonshiny', 'noshiny', '이로치아님', '이로치아니다', '이로치아니']);
const OPPONENT = words({ wild: ['wild', '야생'], trainer: ['trainer', '트레이너', '사람'] });
const RANK = words({ normal: ['normal', '일반', '보통'], boss: ['boss', '보스', 'ace', '강적'] });
const FORMAT = words({ single: ['single', 'singles', 'singlebattle', '1v1', '싱글', '싱글배틀', '1대1'], double: ['double', 'doubles', 'doublebattle', '2v2', '더블', '더블배틀', '2대2'] });
// Wild Pokemon in one battle: two is a wild double battle
const WILD_MAX = 2;
const TIME = words({ day: ['day', 'morning', 'dawn', 'noon', '낮', '아침', '새벽', '오후', '점심'], night: ['night', 'dusk', 'evening', '밤', '저녁', '황혼', '한밤'] });
const BOSS_CLASS = /관장|사천왕|챔피언|gym\s*leader|elite\s*four|champion/i;

const LOOKS = words({
  boy: ['boy', 'youngboy', '소년', '남자아이', '남자애'], girl: ['girl', 'younggirl', '소녀', '여자아이', '여자애'],
  young_man: ['youngman', '청년', '젊은남자', '젊은남성'], young_woman: ['youngwoman', 'younglady', '숙녀', '아가씨', '젊은여자', '젊은여성'],
  middle_aged_man: ['middleagedman', '중년남자', '중년남성', '아저씨'], middle_aged_woman: ['middleagedwoman', '중년여자', '중년여성', '아주머니', '아줌마'],
  old_man: ['oldman', 'elderlyman', '노인', '할아버지', '노인남자'], old_woman: ['oldwoman', 'elderlywoman', '할머니', '노부인', '노인여자'],
});
const LOOK_GENDER = { boy: 'M', girl: 'F', young_man: 'M', young_woman: 'F', middle_aged_man: 'M', middle_aged_woman: 'F', old_man: 'M', old_woman: 'F' };

export function hashKey(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return (n % 36 ** 8).toString(36).padStart(8, '0');
}

const BLOCK_RE = /<\s*pkb-(battle|change|end|act)\s*>([\s\S]*?)<\s*\/\s*pkb-\1\s*>/gi;
const TAG_RE = /<pkb#([a-z0-9]+)>/g;

const MARK_RE = /<pkb!([a-z]):([a-z0-9]+)>/g;

export const MARK = { open: 'p', discarded: 'x', here: 'h', moved: 'm', openedAt: 'w' };

export function findBlocks(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(BLOCK_RE)) {
    out.push({ kind: m[1].toLowerCase(), body: m[2], start: m.index, end: m.index + m[0].length, key: hashKey(m[2].trim()) });
  }
  return out;
}

export const messageId = (message, index) => message?.chatId ?? `#${index}`;

// Battle key = message id + index of the battle block within the message (from 0) + block content
export const battleKey = (id, n, body) => hashKey(`${id}\n${n}\n${hashKey(String(body ?? '').trim())}`);

export const battlesInText = (text, id) => findBlocks(text).filter(b => b.kind === 'battle').map((b, n) => ({ ...b, hash: b.key, key: battleKey(id, n, b.body) }));

// Battle blocks in a message
export const battlesIn = (message, index) => battlesInText(message?.data ?? '', messageId(message, index));

export const actsIn = (message, index) => findBlocks(message?.data ?? '').filter(b => b.kind === 'act').map((b, n) => {
  const id = ACT_ID_RE.exec(b.body)?.[1];
  return { ...b, own: !!id, key: id ? hashKey(`act-id\n${id}`) : battleKey(`act:${messageId(message, index)}`, n, b.body) };
});
const ACT_ID_RE = /^\s*id\s*:\s*([a-z0-9]+)\s*$/im;

export function actBlock(body, id) {
  return { text: `<pkb-act>\nid: ${id}\n${String(body ?? '').trim()}\n</pkb-act>`, key: hashKey(`act-id\n${id}`) };
}

export function findTags(text) {
  return [...String(text ?? '').matchAll(TAG_RE)].map(m => ({ key: m[1], start: m.index, end: m.index + m[0].length }));
}

export function findMarks(text) {
  return [...String(text ?? '').matchAll(MARK_RE)].map(m => ({ kind: m[1], key: m[2], start: m.index, end: m.index + m[0].length }));
}
export const markText = (kind, key) => `<pkb!${kind}:${key}>`;

export function stripForPrompt(text) {
  return String(text ?? '').replace(BLOCK_RE, '').replace(TAG_RE, '').replace(MARK_RE, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function lines(body, errors) {
  const out = [];
  for (const raw of String(body ?? '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*•·]\s+/, '').trim();
    if (!line) continue;
    const m = /^([^:：]+?)\s*[:：]\s*(.*)$/.exec(line);
    if (!m) { errors.push(note('badLine', { line })); continue; }
    out.push({ key: norm(m[1]), value: m[2].trim(), line });
  }
  return out;
}

const BATTLE_KEYS = words({
  opponent: ['opponent', 'type', 'battle', 'vs', '상대', '종류', '배틀'], name: ['name', 'trainer', 'trainername', '이름', '트레이너이름'],
  gender: ['gender', 'sex', '성별'], look: ['look', 'looks', 'appearance', '모습', '외모', '겉모습'], class: ['class', 'trainerclass', 'job', '직업'], rank: ['rank', 'tier', '등급'],
  place: ['place', 'biome', 'location', 'area', '장소', '바이옴', '지형'], time: ['time', '시간', '시간대'], pokemon: ['pokemon', 'mon', '포켓몬'],
  format: ['format', 'style', 'battlestyle', 'mode', '방식', '형식', '배틀방식', '배틀형식'],
  ally: ['ally', 'partner', 'allyname', 'partnername', 'allytrainer', '동료', '파트너', '아군', '동료이름', '동료트레이너'],
  allyPokemon: ['allypokemon', 'allymon', 'partnerpokemon', 'partnermon', '동료포켓몬', '파트너포켓몬', '아군포켓몬'],
});
const SET_KEYS = words({
  ability: ['ability', '특성'], moves: ['moves', 'move', '기술', '기술들'], item: ['item', 'helditem', 'hold', '도구', '지닌도구', '지닌물건'],
  nature: ['nature', '성격'], gender: ['gender', 'sex', '성별'], shiny: ['shiny', '이로치', '색이다름'], tera: ['tera', 'teratype', '테라', '테라타입'],
  name: ['nickname', 'name', '별명', '이름', '닉네임'], hp: ['hp', '체력'], status: ['status', '상태', '상태이상'], level: ['level', 'lv', 'lvl', '레벨'],
  box: ['box', '박스'], party: ['party', '파티'], ot: ['ot', 'originaltrainer', '어버이'], ivs: ['ivs', 'iv', '개체값'],
});
const CHANGE_KEYS = words({
  add: ['add', 'get', 'catch', '추가', '얻음', '받음', '잡음'], level: ['level', 'levelup', 'lv', '레벨', '레벨업'], heal: ['heal', 'restore', '회복', '치료'],
  item: ['item', 'bag', 'items', '도구', '가방', '아이템'], release: ['release', 'farewell', '놓아주기', '떠나보내기', '방생'],
  deposit: ['deposit', 'tobox', '맡기기', '보관'], withdraw: ['withdraw', 'toparty', '꺼내기'], nickname: ['nickname', 'rename', '별명', '이름'],
  hold: ['hold', 'helditem', 'give', '지닌도구', '지니기', '들리기'], evolve: ['evolve', 'evolution', '진화'], teach: ['teach', 'learn', 'move', '기술', '가르치기', '배우기'],
  money: ['money', 'cash', '돈', '소지금', '금액'],
});

const LEVEL_RES = [/(?:\blv\.?|\blvl\.?|\bl|레벨)\s*\.?\s*(\d{1,3})(?!\d)/i, /(?<!\d)(\d{1,3})\s*(?:레벨|lv\b)/i];

function takeLevel(text) {
  for (const re of LEVEL_RES) {
    const m = re.exec(text);
    if (m) return { level: Number(m[1]), rest: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).trim() };
  }
  return { level: null, rest: text.trim() };
}

function splitSeg(seg, map) {
  const m = /^(\S+)(?:\s+(\S+))?/.exec(seg);
  if (!m) return null;
  for (const [head, n] of [[m[1] + (m[2] ?? ''), 2], [m[1], 1]]) {
    const k = norm(head.replace(/[:：]$/, ''));

    if (n === 2 && !(m[2] && /[\p{L}\p{N}]/u.test(m[2]))) continue;
    if (map.has(k)) return [map.get(k), seg.split(/\s+/).slice(n).join(' ').replace(/^[:：]\s*/, '').trim()];
  }

  const c = /^([^:：]+)[:：]\s*(.*)$/.exec(seg);
  if (c && map.has(norm(c[1]))) return [map.get(norm(c[1])), c[2].trim()];
  return null;
}

function percent(v, warn) {
  const s = String(v).trim();
  const m = /^(\d+(?:\.\d+)?)\s*%?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (n > 100) { warn?.(note('hpCapped', { value: s })); return 100; }
  return n;
}

function readIvs(v) {
  const n = /^([1-6])\s*v$/i.exec(v);
  if (n) return Number(n[1]) === STATS.length ? { ivs: Object.fromEntries(STATS.map(s => [s, MAX_IV])) } : { perfectIvs: Number(n[1]) };
  const nums = v.split('/').map(x => x.trim());
  if (nums.length !== STATS.length || !nums.every(x => /^\d{1,2}$/.test(x) && Number(x) <= MAX_IV)) return null;
  return { ivs: Object.fromEntries(STATS.map((s, i) => [s, Number(nums[i])])) };
}

function parseSet(value, errors, dest, warnings = errors) {
  const warn = text => warnings.push(text);
  const segs = String(value).split(/[|｜]/).map(s => s.trim()).filter(Boolean);
  if (!segs.length) { errors.push(note('emptyMon')); return null; }
  let { level, rest } = takeLevel(segs[0]);
  const set = {};
  let to = 'party', ot = null, custom = null;

  const ivField = (v, seg) => {
    const r = readIvs(v);
    if (!r) { errors.push(note('badIvs', { max: MAX_IV, seg })); return; }
    delete set.ivs; delete set.perfectIvs;
    Object.assign(set, r);
  };
  for (const seg of segs.slice(1)) {
    const kv = splitSeg(seg, SET_KEYS);
    if (!kv) {

      const lv = takeLevel(seg);
      if (level == null && lv.level != null && !lv.rest) { level = lv.level; continue; }
      if (/^\d+(?:\.\d+)?\s*%$/.test(seg)) { set.hpPercent = percent(seg, warn); continue; }
      if (GENDER.has(norm(seg)) && /^[♂♀]$/.test(seg)) { set.gender = GENDER.get(norm(seg)); continue; }
      if (NOT_SHINY.has(norm(seg))) continue;
      if (/^\d+\s*v$/i.test(seg)) { ivField(seg, seg); continue; }
      errors.push(note('unknownExtra', { seg }));
      continue;
    }
    const [k, v] = kv;
    if (k === 'shiny') {
      const yes = v ? SHINY.get(norm(v)) : 'yes';
      if (yes === 'yes') set.shiny = true;
      else if (yes !== 'no') errors.push(note('shinyWord', { seg }));
      continue;
    }
    if (k === 'box' || k === 'party') {
      if (dest) to = k; else errors.push(note('notInBattle', { seg }));
      continue;
    }
    if (!v) { errors.push(note('noValue', { text: seg })); continue; }
    if (k === 'ot') {

      if (dest) ot = v.slice(0, OT_NAME_MAX); else errors.push(note('notInBattle', { seg }));
      continue;
    }
    if (k === 'ivs') {
      ivField(v, seg);
    } else if (k === 'level') {
      const n = /^(?:lv\.?\s*)?(\d{1,3})$/i.exec(v);
      if (n) level = Number(n[1]); else errors.push(note('badLevel', { value: v }));
    } else if (k === 'ability') {
      const id = need('abilities', v, errors); if (id) set.ability = id;
    } else if (k === 'item') {

      // A name-table item, else a custom item under the name as written (the same reading as item / hold lines)
      const { emoji, rest: name } = splitEmoji(v);
      const item = itemOf(name, emoji, v, errors);
      if (item) { set.item = item.item; custom = item.custom ?? null; }
    } else if (k === 'moves') {
      const moves = v.split(/[,，、\/]/).map(s => s.trim()).filter(Boolean).map(s => need('moves', s, errors)).filter(Boolean);
      if (moves.length > MAX_MOVES) errors.push(note('tooManyMoves', { max: MAX_MOVES, n: moves.length }));
      if (moves.length) set.moves = [...new Set(moves)].slice(0, MAX_MOVES);
    } else if (k === 'nature') {
      const n = storyNames.natures[norm(v)];
      if (n) set.nature = n; else errors.push(note('unknownNature', { value: v }));
    } else if (k === 'gender') {
      const g = GENDER.get(norm(v));
      if (g) set.gender = g; else errors.push(note('unknownGender', { value: v }));
    } else if (k === 'tera') {
      const t = storyNames.types[norm(v)];
      if (t) set.teraType = t; else errors.push(note('unknownTera', { value: v }));
    } else if (k === 'name') {
      set.name = v;
    } else if (k === 'hp') {
      const p = percent(v, warn);
      if (p != null) set.hpPercent = p; else errors.push(note('hpRange', { value: v }));
    } else if (k === 'status') {
      const s = STATUS.get(norm(v));
      if (s !== undefined) set.status = s; else errors.push(note('unknownStatus', { value: v }));
    }
  }
  if (!rest) { errors.push(note('noMonName', { seg: segs[0] })); return null; }
  const species = speciesName(rest);
  if (!species) { errors.push(note('unknown.species', { name: rest })); return null; }
  if (level == null) { errors.push(note('noLevel', { name: rest })); return null; }
  if (level < 1 || level > MAX_LEVEL) { errors.push(note('monLevelRange', { max: MAX_LEVEL, name: rest, level })); return null; }
  return { set: { species, level, ...set }, to, ...(ot ? { ot } : {}), ...(custom ? { custom } : {}) };
}

export function parseBattle(body) {
  const errors = [];
  let fatal = false;
  const spec = { wild: null, name: null, gender: null, look: null, trainerClass: null, boss: null, place: 'plains', time: 'day', format: null, ally: null, team: [] };
  for (const { key, value, line } of lines(body, errors)) {
    const k = BATTLE_KEYS.get(key);
    if (!k) { errors.push(note('unknownKey', { line })); continue; }
    if (k === 'pokemon') {
      const r = parseSet(value, errors, false);
      if (r) spec.team.push(r.set); else fatal = true;
      continue;
    }
    // A broken ally line only drops that Pokemon: the battle can still be played
    if (k === 'allyPokemon') {
      const r = parseSet(value, errors, false);
      if (r) (spec.ally ??= { name: null, team: [] }).team.push(r.set);
      continue;
    }
    if (!value) { errors.push(note('noValue', { text: line })); continue; }
    if (k === 'opponent') {
      const o = OPPONENT.get(norm(value));
      if (o) spec.wild = o === 'wild';
      else if (FORMAT.has(norm(value))) spec.format = FORMAT.get(norm(value));
      else errors.push(note('sideWord', { value }));
    } else if (k === 'format') {
      const f = FORMAT.get(norm(value));
      if (f) spec.format = f; else errors.push(note('formatWord', { value }));
    } else if (k === 'ally') (spec.ally ??= { name: null, team: [] }).name = value;
    else if (k === 'name') spec.name = value;
    else if (k === 'class') spec.trainerClass = value;
    else if (k === 'gender') {
      const g = GENDER.get(norm(value));
      if (g) spec.gender = g; else errors.push(note('unknownGender', { value }));
    } else if (k === 'look') {
      const l = LOOKS.get(norm(value));
      if (l) spec.look = l; else errors.push(note('unknownLook', { value }));
    } else if (k === 'rank') {
      const r = RANK.get(norm(value));
      if (r) spec.boss = r === 'boss'; else errors.push(note('rankWord', { value }));
    } else if (k === 'place') {
      const b = storyNames.biomes[norm(value)];
      if (b) spec.place = b; else errors.push(note('unknownPlace', { value }));
    } else if (k === 'time') {
      const t = TIME.get(norm(value));
      if (t) spec.time = t; else errors.push(note('timeWord', { value }));
    }
  }
  if (spec.wild == null) { errors.push(note('noSide')); fatal = true; }
  const n = spec.team.length;
  if (!n && !fatal) { errors.push(note('noMons')); fatal = true; }
  if (spec.wild === true && n > WILD_MAX) { errors.push(note('wildMax', { max: WILD_MAX, n })); fatal = true; }
  if (spec.wild === false && n > PARTY_MAX) { errors.push(note('trainerMax', { max: PARTY_MAX, n })); fatal = true; }

  // An ally fights beside the player in a trainer battle (a tag battle)
  if (spec.ally) {
    if (spec.wild) { errors.push(note('allyWild')); spec.ally = null; }
    else if (!spec.ally.team.length) { errors.push(note('allyNoMons')); spec.ally = null; }
    else if (spec.ally.team.length > PARTY_MAX) { errors.push(note('allyMax', { max: PARTY_MAX, n: spec.ally.team.length })); fatal = true; }
  }

  // Without a rank, guess from the class (else the name)
  if (spec.boss == null) spec.boss = !spec.wild && BOSS_CLASS.test(`${spec.trainerClass ?? ''} ${spec.name ?? ''}`);

  if (spec.look) spec.gender = LOOK_GENDER[spec.look];
  return { spec: fatal ? null : spec, errors };
}

function ref(str, errors) {
  const s = String(str ?? '').trim();

  const b = /^(?:box|storage|박스)\s*#?\s*(\d+)(?:번)?$/i.exec(s);
  if (b) {
    const box = Number(b[1]);
    if (box >= 1) return { box };
    errors.push(note('boxNumber', { ref: s }));
    return null;
  }
  const m = /^#\s*(\d+)(?:번)?$/.exec(s);
  if (m) {
    const slot = Number(m[1]);
    if (slot >= 1 && slot <= PARTY_MAX) return { slot };
    errors.push(note('partyNumber', { max: PARTY_MAX, ref: s }));
    return null;
  }
  if (!s || s.startsWith('#')) { errors.push(s ? note('badPartyNumber', { ref: s }) : note('noWho')); return null; }
  return { name: s };
}

function headRef(value, rest = true) {
  const s = value.trim();
  const slot = /^(#\s*\d+(?:번)?)\s*(.*)$/.exec(s);
  if (slot) return [slot[1], slot[2].trim()];
  const parts = s.split(/\s+/).filter(Boolean);
  for (let n = parts.length - (rest ? 1 : 0); n >= 2; n--) {
    const head = parts.slice(0, n).join(' ');
    if (speciesName(head)) return [head, parts.slice(n).join(' ')];
  }
  return parts.length ? [parts[0], parts.slice(1).join(' ')] : ['', ''];
}

function itemOf(name, emoji, value, errors) {
  const id = lookupId('items', name);
  if (id) return { item: id };
  if (!/\p{L}/u.test(name)) { errors.push(note('noItemName', { value: value.trim() })); return null; }
  return { item: customItemId(name), custom: { name, emoji: emoji || DEFAULT_EMOJI } };
}

function atEmoji(value) {
  const parts = value.trim().split(/\s+/);
  const leads = (part, i) => { const { emoji, rest } = splitEmoji(part); return !!emoji && (!!rest || i < parts.length - 1); };
  const at = parts.findIndex((part, i) => i > 0 && !/^[♀♂]/u.test(part) && leads(part, i));
  return at > 0 ? [parts.slice(0, at).join(' '), parts.slice(at).join(' ')] : null;
}

function tailCount(value, dflt) {
  const m = /^(.*?)\s*(?:([+-]\s*\d[\d,]*)|[x×*]\s*(\d[\d,]*)|(\d[\d,]*)\s*(?:개|ea)?)$/i.exec(value.trim());
  if (!m || !m[1]) return { name: value.trim(), n: dflt };
  const raw = (m[2] ?? m[3] ?? m[4]).replace(/[\s,]/g, '');
  return { name: m[1].trim(), n: Number(raw) };
}

const HEAL_MODS = words({ status: ['status', 'statusonly', 'cure', '상태', '상태이상', '상태만'], revive: ['revive', 'faint', 'fainted', '기절', '기절회복', '부활', '되살리기'] });
const ALL = words({ all: ['all', 'party', 'everyone', '전체', '모두', '전부', '파티'] });
const NONE = words({ none: ['none', 'nothing', 'remove', '없음', '빼기', '없애기', '해제'] });

export function parseChange(body) {
  const errors = [], warnings = [];
  const ops = [];
  for (const { key, value, line } of lines(body, errors)) {
    const op = CHANGE_KEYS.get(key);
    if (!op) { errors.push(note('unknownKey', { line })); continue; }
    if (!value) { errors.push(note('noValue', { text: line })); continue; }
    const errs = [], warns = [];
    const r = parseOp(op, value, errs, warns);
    errors.push(...errs, ...warns);
    warnings.push(...warns);

    if (r && !errs.length) ops.push(r);
  }
  return { ops, errors, warnings };
}

function parseOp(op, value, errors, warnings) {
  const warn = text => warnings.push(text);
  switch (op) {
    case 'add': {
      const r = parseSet(value, errors, true, warnings);
      return r && { op, set: r.set, to: r.to, ...(r.ot ? { ot: r.ot } : {}), ...(r.custom ? { custom: r.custom } : {}) };
    }
    case 'level': {
      const m = /^(.*?)\s*(?:([+-])\s*(\d{1,3})|=\s*(?:lv\.?\s*)?(\d{1,3})|(?:lv\.?\s*|레벨\s*)?(\d{1,3}))\s*(?:레벨)?$/i.exec(value);
      if (!m || !m[1] || /^#\s*$/.test(m[1])) { errors.push(note('badLevelChange', { value })); return null; }
      const who = ref(m[1], errors);
      if (!who) return null;
      if (m[3] != null) {
        const delta = Number(m[2] + m[3]);
        if (!delta) { errors.push(note('levelZero', { value })); return null; }
        return { op, ref: who, delta };
      }
      const to = Number(m[4] ?? m[5]);
      if (to < 1 || to > MAX_LEVEL) { errors.push(note('levelRange', { max: MAX_LEVEL, level: to })); return null; }
      return { op, ref: who, to };
    }
    case 'heal': {
      const toks = value.trim().split(/\s+/), mods = {};

      while (toks.length) {
        const w = toks[toks.length - 1], k = norm(w);
        if (/%$/.test(w) && percent(w) != null) mods.hpPercent = percent(w, warn);
        else if (HEAL_MODS.get(k) === 'status') mods.statusOnly = true;
        else if (HEAL_MODS.get(k) === 'revive') mods.revive = true;
        else if (!['회복', 'heal', 'full', '가득'].includes(k)) break;
        toks.pop();
      }
      const target = toks.join(' ');
      const who = !target || ALL.has(norm(target)) ? 'all' : ref(target, errors);
      return who && { op, ref: who, ...mods };
    }
    case 'item': {
      const { emoji, rest } = splitEmoji(value);

      const { name, n } = /^\s*(?:tm|기술\s*머신)\s*[-:.#]?\s*\d{1,3}\s*$/i.test(rest) ? { name: rest, n: 1 } : tailCount(rest, 1);
      const item = itemOf(name, emoji, value, errors);
      if (!item) return null;
      if (!Number.isSafeInteger(n)) { errors.push(note('itemCountBig', { value })); return null; }
      if (!n) { errors.push(note('itemCountZero', { value })); return null; }
      return { op, ...item, delta: n };
    }
    case 'release': case 'deposit': case 'withdraw': {
      const who = ref(value, errors);
      return who && { op, ref: who };
    }
    case 'nickname': {
      const [h, name] = headRef(value);
      if (!name) { errors.push(note('noNickname', { value })); return null; }
      const who = ref(h, errors);
      return who && { op, ref: who, name };
    }
    case 'hold': {
      const [h, rest] = atEmoji(value) ?? headRef(value, false);
      const who = ref(h, errors);
      if (!who) return null;
      if (!rest || NONE.has(norm(rest))) return { op, ref: who, item: null };
      const { emoji, rest: name } = splitEmoji(rest);
      const item = itemOf(name, emoji, value, errors);
      return item && { op, ref: who, ...item };
    }
    case 'evolve': {
      const [h, rest] = headRef(value);
      if (!rest) { errors.push(note('noEvolveTo', { value })); return null; }
      const who = ref(h, errors);
      if (!who) return null;
      const species = speciesName(rest);
      if (!species) { errors.push(note('unknown.species', { name: rest })); return null; }
      return { op, ref: who, species };
    }
    case 'teach': {
      const [h, rest] = headRef(value);
      const who = ref(h, errors);
      if (!who) return null;

      let learn = rest, forget = null;
      const f = /^(.*?)\s+(?:forget|replace|replacing|잊기|잊고|잊음)\s+(.+)$/i.exec(rest);
      const d = /^(.+?)\s+(?:대신|instead\s+of)\s+(.+)$/i.exec(rest);
      if (f) [learn, forget] = [f[1], f[2]];
      else if (d) [forget, learn] = [d[1], d[2]];
      if (!learn) { errors.push(note('noLearn', { value })); return null; }
      const move = need('moves', learn, errors);
      const old = forget ? need('moves', forget, errors) : null;
      if (!move || (forget && !old)) return null;
      return old ? { op, ref: who, move, forget: old } : { op, ref: who, move };
    }
    case 'money': {
      const m = /^([+-])?\s*[₩$]?\s*(\d[\d,]*)\s*(?:원|₩|p|pokedollars?)?$/i.exec(value.trim());
      if (!m) { errors.push(note('badMoney', { value })); return null; }
      const delta = Number((m[1] ?? '+') + m[2].replace(/,/g, ''));

      if (!Number.isSafeInteger(delta)) { errors.push(note('moneyBig', { value })); return null; }
      if (!delta) { errors.push(note('moneyZero', { value })); return null; }
      return { op, delta };
    }
  }
  return null;
}

const END_KEYS = words({ result: ['result', 'outcome', 'winner', '결과', '승패'] });
const END_RESULT = words({
  win: ['win', 'won', 'victory', 'player', '승리', '이김', '이겼다', '플레이어'],
  lose: ['lose', 'lost', 'loss', 'defeat', 'opponent', '패배', '짐', '졌다', '상대'],
  stop: ['stop', 'stopped', 'interrupted', 'cancel', 'cancelled', 'draw', 'none', '중단', '중지', '무승부', '없음'],
});

export function parseEnd(body) {
  const errors = [];
  const bare = String(body ?? '').trim();

  if (bare && !/[:：]/.test(bare)) {
    const r = END_RESULT.get(norm(bare));
    if (r) return { outcome: r, errors };
  }
  let outcome = null;
  for (const { key, value, line } of lines(body, errors)) {
    if (END_KEYS.get(key) !== 'result') { errors.push(note('unknownKey', { line })); continue; }
    const r = END_RESULT.get(norm(value));
    if (r) outcome = r; else errors.push(note('endWord', { value }));
  }
  return { outcome: outcome ?? 'stop', errors };
}

const ACT_KEYS = words({ turn: ['turn', 'action', 'command', '턴', '행동', '명령'] });
const ACT_SIDES = words({ me: ['me', 'my', 'mine', 'player', 'own', '나', '내', '내쪽', '아군', '플레이어'],
  foe: ['foe', 'opponent', 'enemy', 'opp', 'them', '상대', '적', '상대쪽'] });
const ACT_VERBS = words({ switch: ['switch', 'swap', 'change', 'go', 'send', '교체', '교대', '바꾸기'], item: ['item', 'use', 'bag', '도구', '가방', '사용'],
  run: ['run', 'flee', 'escape', 'forfeit', '도망', '도주', '항복'], move: ['move', 'attack', '기술', '공격'] });
const GIMMICKS = words({ tera: ['tera', 'terastallize', 'terastal', '테라', '테라스탈'], mega: ['mega', 'megaevolve', '메가', '메가진화'] });

function actTarget(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const slot = /^#\s*(\d+)(?:번)?$/.exec(s);
  if (slot) return { slot: Number(slot[1]) };
  return { species: lookupId('species', s), name: s };
}

// One side's part of a turn ("switch Bulbasaur") -> command, with errors for names the tables do not know
function actPart(rest, side, errors) {
  const toks = rest.trim().split(/\s+/).filter(Boolean);
  const verb = ACT_VERBS.get(norm(toks[0]));
  const after = toks.slice(verb ? 1 : 0).join(' ');
  if (verb === 'run') return side === 'me' ? { kind: 'run' } : null;
  if (verb === 'switch') {
    const target = actTarget(after);
    if (!target) errors.push(note('act.noSwitchTarget', { text: rest }));
    return target && { kind: 'switch', target };
  }
  if (verb === 'item') {
    const m = /^(.*?)\s*(?:(#\s*\d+(?:번)?)|(?:\b(?:on|to)\b|에게|→|->)\s*(.+))?$/i.exec(after);
    const name = (m?.[1] ?? after).trim();
    const item = lookupId('items', name);
    if (!item) errors.push(note('unknown.items', { name }));
    const target = actTarget(m?.[2] ?? m?.[3]);
    return { kind: 'item', item, ...(target ? { target } : {}) };
  }

  const words = after.split(/\s+/).filter(Boolean);
  const gimmick = words.length > 1 ? GIMMICKS.get(norm(words.at(-1))) : undefined;
  const name = (gimmick ? words.slice(0, -1) : words).join(' ');
  const move = lookupId('moves', name);
  if (!move) errors.push(note('unknown.moves', { name }));
  return { kind: 'move', move, ...(gimmick ? { gimmick } : {}), ...(move ? {} : { raw: name }) };
}

export function parseAct(body) {
  const errors = [], turns = [], labels = [];
  for (const { key, value, line } of lines(body, errors)) {
    if (key === 'id') continue;
    if (ACT_KEYS.get(key.replace(/\d+$/, '')) !== 'turn') { errors.push(note('unknownKey', { line })); continue; }
    const turn = { me: null, foe: null }, label = { me: '', foe: '' };
    for (const part of value.split('|').map(p => p.trim()).filter(Boolean)) {
      const m = /^(\S+)\s+(.+)$/.exec(part);
      const side = m && ACT_SIDES.get(norm(m[1]));
      if (!side) { errors.push(note('act.badSide', { part })); continue; }
      turn[side] = actPart(m[2], side, errors);
      label[side] = m[2].trim();
    }
    if (!turn.me) { errors.push(note('act.noMine', { line })); continue; }
    turns.push(turn);
    labels.push(label);
  }
  return { turns, labels, errors };
}
