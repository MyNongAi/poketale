import { findBlocks, findTags, parseChange, hashKey, speciesName, messageId, norm } from './blocks.mjs';
import { expForLevel, calcExpGain, growthOf as growthOfSpecies } from '../engine/exp.mjs';
import { STATS, STATUS_IDS, completeSet, levelEvolution, toID } from '../engine/mon.mjs';
import { engineMember } from '../engine/input.mjs';
import { startsFainted } from '../engine/initial-state.mjs';
import { BAG_ITEMS, isBall } from '../engine/bag.mjs';
import { ppUpCount } from '../engine/pp.mjs';
import { DEFAULT_FORMAT, formatRules } from '../engine/rules.mjs';
import { HYPER_TRAIN_LEVEL, expShareOn } from './items.mjs';
import { say } from './screen-text.mjs';
import { isCustomItem, itemId, customInfo, addCustomItem, tidyCustomItems } from './custom-items.mjs';
import { PARTY_MAX, MAX_LEVEL, MAX_MOVES, MAX_IV, EV_STAT_MAX, EV_TOTAL_MAX, OT_NAME_MAX, BOX_NAME_MAX, PLAYER_NAME } from './rules.mjs';
import { bossBgm, personalName } from './named.mjs';
import { outcomeOf } from './outcome.mjs';
import { opponentPicture } from './trainer-look.mjs';
import { readStored, isRecord } from './stored.mjs';
import { ruleError } from './failure.mjs';
import { surveyBattles } from './chat.mjs';
import { SAVE_VAR } from './save.mjs';
import { QUEUE_VAR, runAction } from './acts.mjs';
import { IMPORT_VAR, readImports, applyImport, importPlace } from './import.mjs';

export const TABLE_VAR = '$pkb_states';

export { DEFAULT_FORMAT };

// Fallback when the player's name is unknown (story/rules.mjs - engine p1 name, summary-screen OT, AI text)
export { PLAYER_NAME };

const TYPICAL_BASE_EXP = 60;

const TYPICAL_EV_YIELD = 1, RARE_EV_YIELD = 2, RARE_EV_ODDS = 10;

const BOX_NAME_SLOTS = 100;
const WATER_BIOMES = new Set(['sea', 'seabed', 'lake', 'beach', 'swamp']);
const CAVE_BIOMES = new Set(['cave', 'ice_cave']);

export { toID };

export const clone = value => JSON.parse(JSON.stringify(value));

const fail = (rule, values) => { throw ruleError(`state.${rule}`, values); };

export function emptyState() {
  return { v: 1, party: [], box: [], bag: {}, money: 0, dex: { seen: [], caught: [] }, trainers: {} };
}

export const trainersOf = state => state?.trainers ?? {};

const trainerKey = battle => norm(personalName(battle));

const emptyTable = () => ({ v: 1, snaps: {}, fills: {}, meta: {}, acts: {} });

export function readTable(chat) {
  const { status, value } = readTableRaw(chat);
  if (status !== 'ok') return emptyTable();
  return { v: 1, snaps: value.snaps ?? {}, fills: value.fills ?? {}, meta: value.meta ?? {}, acts: value.acts ?? {} };
}
const TABLE_PARTS = ['snaps', 'fills', 'meta', 'acts'];
const readTableRaw = chat => readStored(chat?.scriptstate?.[TABLE_VAR], { shape: t => TABLE_PARTS.every(k => t[k] === undefined || isRecord(t[k])) });

export const tableStatus = chat => readTableRaw(chat).status;

export function writeTable(chat, table) {
  chat.scriptstate ??= {};
  chat.scriptstate[TABLE_VAR] = JSON.stringify(table);
}

export function pruneTable(chat, keep = []) {
  if (tableStatus(chat) !== 'ok') return false;
  const table = readTable(chat);
  const tags = new Set(keep), blocks = new Set();
  (chat.message ?? []).forEach((message, i) => {
    const text = String(message?.data ?? '');
    for (const tag of findTags(text)) tags.add(tag.key);
    for (const block of findBlocks(text)) if (block.kind === 'change') blocks.add(`${messageId(message, i)}:${block.key}`);
  });
  const stale = {
    snaps: key => !tags.has(key), meta: key => !tags.has(key), acts: key => !tags.has(key),
    fills: key => !blocks.has(key.slice(0, key.lastIndexOf(':'))),
  };
  let dropped = false;
  for (const [part, isStale] of Object.entries(stale)) {
    for (const key of Object.keys(table[part])) if (isStale(key)) { delete table[part][key]; dropped = true; }
  }
  if (dropped) writeTable(chat, table);
  return dropped;
}

export const createFolds = () => new Map();
const FOLD_CHATS = 4;
function foldList(folds, chat) {
  const id = chat?.id ?? '';
  let list = folds.get(id);
  if (!list) {
    if (folds.size >= FOLD_CHATS) folds.delete(folds.keys().next().value);
    folds.set(id, list = []);
  }
  return list;
}

// Name of one change block in a message: message index + which change block in that message (heldChanges)
export const changeAt = (index, n) => `${index}:${n}`;

export function heldChanges(chat, table = readTable(chat)) {
  return surveyBattles(chat, table).held;
}

export const stateVars = () => [TABLE_VAR, SAVE_VAR, QUEUE_VAR, IMPORT_VAR];

export function computeState(chat, ctx, { uptoIndex, survey: given } = {}) {
  const table = readTable(chat);
  const messages = chat?.message ?? [];
  const last = Math.min(uptoIndex ?? messages.length - 1, messages.length - 1);
  const keep = !!ctx?.folds;
  const folds = keep ? foldList(ctx.folds, chat) : [];
  const parts = messages.map(m => String(m?.data ?? ''));
  const survey = given ?? surveyBattles(chat, table);
  const { held } = survey;

  const committedOf = key => survey.battles.get(table.meta[key].blockKey)?.committed;

  const used = key => {
    const meta = table.meta?.[key];
    if (meta?.storyEnd) return committedOf(key) === 'story' ? `${key}=${survey.battles.get(meta.blockKey).ended.outcome}` : null;
    if (meta && ![undefined, 'done'].includes(committedOf(key))) return null;
    return Object.hasOwn(table.snaps, key) ? key : null;
  };

  const heldIn = i => (held.size ? findBlocks(parts[i]).filter(b => b.kind === 'change').map((_, n) => n).filter(n => held.has(changeAt(i, n))).join(',') : '');

  const imports = new Map();
  for (const imp of readImports(chat).imports) {
    const at = importPlace(messages, imp);
    imports.set(at, [...imports.get(at) ?? [], imp]);
  }
  const importsAt = i => imports.get(i) ?? [];
  const applyImportsAt = (i, start) => importsAt(i).reduce((cur, imp) => applyImport(cur, imp, ctx), start);
  const importKey = i => [...(i === 0 ? importsAt(-1) : []), ...importsAt(i)].map(imp => hashKey(JSON.stringify(imp))).join(',');
  const keyOf = i => `${messageId(messages[i], i)}\u0001${parts[i]}\u0001${findTags(parts[i]).map(t => used(t.key)).filter(Boolean).join(',')}\u0001${heldIn(i)}\u0001${importKey(i)}`;
  let from = 0;
  while (from <= last && from < folds.length && folds[from].key === keyOf(from)) from++;
  if (from <= last) folds.length = from;
  let changed = false;
  for (const fold of folds.slice(0, from)) {
    for (const [key, set] of Object.entries(fold.fills)) if (!Object.hasOwn(table.fills, key)) { table.fills[key] = set; changed = true; }
  }
  let state = from ? folds[from - 1].after : applyImportsAt(-1, emptyState());

  const seen = new Set(parts.slice(0, from).flatMap(text => findTags(text).map(t => t.key)).filter(used));
  const reflected = new Set([...seen].flatMap(key => reflectedBy(table, key)));
  for (let i = from; i <= last; i++) {
    const name = messageId(messages[i], i);

    const placed = t => { const { storyEnd, blockKey } = table.meta[t.key] ?? {}; const ended = storyEnd && survey.battles.get(blockKey)?.ended; return ended?.index === i ? ended.start : t.start; };
    const tags = findTags(parts[i]).filter(t => used(t.key)).map(t => ({ ...t, type: 'tag', start: placed(t) }));
    const changes = findBlocks(parts[i]).filter(b => b.kind === 'change').map((b, n) => ({ ...b, type: 'change', n }));
    const fills = {};
    for (const event of [...tags, ...changes].sort((a, b) => a.start - b.start)) {
      if (event.type === 'tag') {
        const { storyEnd, blockKey } = table.meta?.[event.key] ?? {};
        const acted = table.acts?.[event.key];
        seen.add(event.key);

        for (const action of (acted?.v === 2 ? acted.actions : storyEnd?.actions) ?? []) if (!isReflected(action, reflected, seen)) state = runAction(state, action, ctx).state;
        for (const id of reflectedBy(table, event.key)) reflected.add(id);
        if (acted?.v === 2) continue;
        if (!storyEnd) { state = clone(table.snaps[event.key]); continue; }
        if (storyEnd.engine) state = applyBattleResult(state, storyEnd.engine.result, ctx, { start: storyEnd.engine.start });
        if (storyEnd.who) {
          const outcome = survey.battles.get(blockKey).ended.outcome;
          state = { ...state, trainers: { ...trainersOf(state), [storyEnd.who]: { ...clone(storyEnd.trainer), outcome } } };
        }
        continue;
      }
      if (held.has(changeAt(i, event.n))) continue;
      const { ops } = parseChange(event.body);
      const before = Object.keys(table.fills).length;
      state = applyOps(state, ops, ctx, `${name}:${event.key}`, table).state;
      if (Object.keys(table.fills).length !== before) changed = true;
      ops.forEach((_, j) => { const key = `${name}:${event.key}:${j}`; if (Object.hasOwn(table.fills, key)) fills[key] = table.fills[key]; });
    }
    state = applyImportsAt(i, state);
    if (keep) folds.push({ key: keyOf(i), after: state, fills });
  }

  const counted = new Set(parts.slice(0, last + 1).flatMap(text => findTags(text).map(t => t.key)).filter(used));
  return { state: keep ? clone(state) : state, table, changed, counted, reflected: new Set([...counted].flatMap(key => reflectedBy(table, key))) };
}

export function reflectedBy(table, key) {
  const acted = table.acts?.[key];
  if (acted?.v === 2) return (acted.actions ?? []).map(action => action.id);
  const meta = table.meta?.[key];
  return (meta?.storyEnd ? (meta.storyEnd.actions ?? []).map(action => action.id) : meta?.held) ?? [];
}

export const isReflected = (action, reflected, counted) => reflected.has(action.id) || (!!action.in && counted.has(action.in));

export function applyOps(state, ops, ctx, fillKeyPrefix, table, { trace = false } = {}) {
  let next = clone(state);
  const errors = [], notes = [];
  const steps = [];
  (ops ?? []).forEach((op, i) => {
    const fillKey = `${fillKeyPrefix ?? 'local'}:${i}`;
    const attempt = clone(next);
    const fill = { known: table?.fills?.[fillKey] ?? null, made: null };
    let error = null, errorNotes = [];
    try {
      applyOp(attempt, op, ctx, fillKey, fill);
      tidyCustomItems(attempt);
    } catch (e) {
      error = e.message;
      errorNotes = e.notes ?? [];
      errors.push(error);
      notes.push(...errorNotes);
    }
    const before = next;
    if (!error) {
      next = attempt;
      if (fill.made && table) (table.fills ??= {})[fillKey] = fill.made;
    }
    if (trace) steps.push({ op, before, after: next, error, notes: errorNotes });
  });
  return trace ? { state: next, errors, notes, steps } : { state: next, errors, notes };
}

function takeCustom(state, id, op, named = true) {
  if (op.custom) addCustomItem(state, id, op.custom);
  if (named && isCustomItem(id) && !customInfo(state, id)) fail('itemNoName');
}

function applyOp(state, op, ctx, fillKey, fill) {
  const { sim } = ctx;
  switch (op?.op) {
    case 'add': {
      let set = fill.known;
      if (!set || toID(set.species) !== toID(op.set.species)) set = fill.made = fillSet(ctx, op.set, rngFor(sim, fillKey));
      const mon = newMon(ctx, clone(set), uniqueUid(state, `m${hashKey(fillKey)}`));
      takeCustom(state, mon.set.item, op, false);
      if (op.set.hpPercent !== undefined) mon.hp = hpFromPercent(sim, mon.set, op.set.hpPercent, false, ctx.formatid);
      if (op.set.status) mon.status = op.set.status;
      if (mon.hp === 0) mon.status = 'fnt';

      if (op.ot) mon.ot = String(op.ot).trim().slice(0, OT_NAME_MAX);

      // A full party sends it to the box
      (op.to === 'box' || state.party.length >= PARTY_MAX ? state.box : state.party).push(mon);
      markDex(state, sim, mon.set.species, true);
      return;
    }
    case 'level': {
      const { list, index, mon } = findMon(state, op.ref, sim);
      const delta = op.to !== undefined ? op.to - mon.set.level : op.delta;
      if (!Number.isInteger(delta) || delta <= 0) fail('levelUpOnly', { mon: monLabel(mon), level: mon.set.level });
      if (mon.set.level >= MAX_LEVEL) fail('maxLevel', { mon: monLabel(mon), max: MAX_LEVEL });

      list[index] = op.candy ? levelUpOutside(mon, delta, ctx, null, { effort: false }) : levelUpOutside(mon, delta, ctx, rngFor(sim, fillKey));
      return;
    }
    case 'heal': {
      if (op.ref === 'all') return healParty(state, ctx, op);
      heal(sim, findMon(state, op.ref, sim).mon, op, ctx.formatid);
      return;
    }
    case 'swap': {

      const a = findMon(state, op.a, sim), b = findMon(state, op.b, sim);
      if (a.mon.uid === b.mon.uid) fail('swapSame', { mon: monLabel(a.mon) });
      a.list[a.index] = b.mon;
      b.list[b.index] = a.mon;
      return;
    }
    case 'item': {
      const id = itemId(op.item);
      if (!id) fail('itemNoName');
      takeCustom(state, id, op, op.delta > 0);

      if (op.fromBag && (state.bag[id] ?? 0) + op.delta < 0) fail('notInBag');
      const count = Math.max(0, (state.bag[id] ?? 0) + op.delta);
      if (count) state.bag[id] = count; else delete state.bag[id];
      return;
    }
    case 'release': {
      const { list, index } = findMon(state, op.ref, sim);
      list.splice(index, 1);
      return;
    }
    case 'deposit': {
      const { list, index, mon } = findMon(state, op.ref, sim);
      if (list !== state.party) fail('inBox', { mon: monLabel(mon) });
      state.box.push(...list.splice(index, 1));
      return;
    }
    case 'withdraw': {
      const { list, index, mon } = findMon(state, op.ref, sim, { boxFirst: true });
      if (list !== state.box) fail('inParty', { mon: monLabel(mon) });
      if (state.party.length >= PARTY_MAX) fail('partyFull', { max: PARTY_MAX, mon: monLabel(mon) });
      state.party.push(...list.splice(index, 1));
      return;
    }
    case 'nickname': {
      findMon(state, op.ref, sim).mon.set.name = String(op.name ?? '').trim();
      return;
    }
    case 'hold': {
      const { mon } = findMon(state, op.ref, sim);
      const item = op.item ? itemId(op.item) : '';
      takeCustom(state, item, op);
      if (op.fromBag) {

        if (item && !(state.bag[item] > 0)) fail('itemNotInBag', { item });
        if (item) { state.bag[item] -= 1; if (!state.bag[item]) delete state.bag[item]; }
        if (mon.set.item) state.bag[mon.set.item] = (state.bag[mon.set.item] ?? 0) + 1;
      }
      mon.set.item = item;
      return;
    }
    case 'evolve': {
      const { mon } = findMon(state, op.ref, sim);
      evolve(ctx, mon, op.species);
      markDex(state, sim, mon.set.species, true);
      return;
    }
    case 'teach': {
      const { mon } = findMon(state, op.ref, sim);
      const move = sim.Dex.moves.get(op.move);
      if (!move.exists) fail('unknownMove', { move: op.move });
      if (mon.set.moves.includes(move.id)) fail('knowsMove', { mon: monLabel(mon), move: move.name });
      if (!op.forget) {
        if (mon.set.moves.length < MAX_MOVES) {
          mon.set.moves.push(move.id);
          mon.pending.moves = mon.pending.moves.filter(m => m !== move.id);
          settlePending(mon);
        } else if (!mon.pending.moves.includes(move.id)) mon.pending.moves.push(move.id);
        return;
      }
      const at = mon.set.moves.indexOf(toID(op.forget));
      if (at < 0) fail('forgetUnknown', { mon: monLabel(mon), move: op.forget });
      forgetMove(mon, mon.set.moves[at]);
      mon.set.moves[at] = move.id;
      mon.pending.moves = mon.pending.moves.filter(m => m !== move.id);
      return;
    }
    case 'money': {
      if (state.money === null) return;
      state.money = Math.max(0, state.money + op.delta);
      return;
    }

    case 'learn': {

      const { mon } = findMon(state, op.ref, sim);
      const move = sim.Dex.moves.get(op.move);
      if (!move.exists) fail('unknownMove', { move: op.move });
      mon.pending.moves = mon.pending.moves.filter(m => m !== move.id);
      if (!op.skip) {
        if (mon.set.moves.includes(move.id)) fail('knowsMove', { mon: monLabel(mon), move: move.name });
        if (op.forget) {
          const at = mon.set.moves.indexOf(toID(op.forget));
          if (at < 0) fail('forgetUnknown', { mon: monLabel(mon), move: op.forget });
          forgetMove(mon, mon.set.moves[at]);
          mon.set.moves[at] = move.id;
        } else {
          if (mon.set.moves.length >= MAX_MOVES) fail('movesFull', { mon: monLabel(mon), max: MAX_MOVES });
          mon.set.moves.push(move.id);
        }
      }
      settlePending(mon);
      return;
    }
    case 'noevolve': {

      const { mon } = findMon(state, op.ref, sim);
      mon.pending.evolve = null;
      settlePending(mon);
      return;
    }
    case 'pp': {

      const { mon } = findMon(state, op.ref, sim);
      const ids = op.move ? [toID(op.move)] : [...mon.set.moves];
      if (op.move && !mon.set.moves.includes(ids[0])) fail('moveNotKnown', { mon: monLabel(mon), move: op.move });
      for (const id of ids) {
        const { pp: now, maxpp: max } = movePp(sim, mon, id, ctx.formatid);
        const next = op.amount === 'full' ? max : Math.min(max, now + Math.max(0, Number(op.amount) || 0));
        if (next >= max) delete mon.pp[id]; else mon.pp[id] = next;
      }
      return;
    }
    case 'ppup': {

      const { mon } = findMon(state, op.ref, sim);
      const id = toID(op.move);
      if (!mon.set.moves.includes(id)) fail('moveNotKnown', { mon: monLabel(mon), move: op.move });
      const move = sim.Dex.moves.get(id);
      const from = ppUpsOf(mon, id);
      const to = ppUpCount(move, from + Math.max(0, Math.trunc(Number(op.amount) || 0)));
      if (to <= from) fail('ppMax', { mon: monLabel(mon), move: move.name });
      const { pp: now, maxpp: oldMax } = movePp(sim, mon, id, ctx.formatid);
      (mon.ppUps ??= {})[id] = to;
      const max = maxPp(sim, id, to, ctx.formatid);
      if (Object.hasOwn(mon.pp, id) && now + max - oldMax < max) mon.pp[id] = now + max - oldMax; else delete mon.pp[id];
      return;
    }

    case 'evs': {

      const { mon } = findMon(state, op.ref, sim);
      const stat = String(op.stat ?? '');
      if (!STATS.includes(stat)) fail('unknownStat', { stat: op.stat });
      const evs = mon.set.evs ??= {};
      for (const s of STATS) evs[s] ??= 0;
      const total = STATS.reduce((sum, s) => sum + evs[s], 0);
      const gain = Math.min(Math.max(0, Math.trunc(Number(op.amount) || 0)), EV_STAT_MAX - evs[stat], EV_TOTAL_MAX - total);
      if (gain <= 0) fail('evsMax', { mon: monLabel(mon) });
      const oldMax = maxHp(sim, mon.set, ctx.formatid);
      evs[stat] += gain;
      keepHpGain(sim, mon, oldMax, ctx.formatid);
      return;
    }
    case 'exp': {

      const { list, index, mon } = findMon(state, op.ref, sim);
      const growth = growthOf(ctx, mon.set.species);
      if (!growth) fail('noGrowth', { mon: monLabel(mon) });
      if (mon.set.level >= MAX_LEVEL) fail('maxLevel', { mon: monLabel(mon), max: MAX_LEVEL });
      const amount = Math.trunc(Number(op.amount) || 0);
      if (amount <= 0) fail('expUpOnly', { mon: monLabel(mon) });
      const low = expForLevel(growth, mon.set.level);
      const exp = Math.min(expForLevel(growth, MAX_LEVEL), Math.max(low, mon.exp ?? low) + amount);
      let to = mon.set.level;
      while (to < MAX_LEVEL && expForLevel(growth, to + 1) <= exp) to++;
      if (to > mon.set.level) list[index] = levelUpOutside({ ...mon, exp }, to - mon.set.level, ctx, null, { effort: false });
      else mon.exp = exp;
      return;
    }
    case 'ability': {

      const { mon } = findMon(state, op.ref, sim);
      const species = sim.Dex.species.get(mon.set.species);
      const ability = Object.values(species.abilities).find(a => toID(a) === toID(op.ability));
      if (!ability) fail('abilityNot', { mon: monLabel(mon), ability: op.ability });
      if (toID(ability) === toID(mon.set.ability)) fail('abilitySame', { mon: monLabel(mon), ability });
      mon.set.ability = ability;
      return;
    }
    case 'nature': {

      const { mon } = findMon(state, op.ref, sim);
      const nature = sim.Dex.natures.get(op.nature);
      if (!nature.exists) fail('unknownNature', { nature: op.nature });
      if (nature.name === mon.set.nature) fail('natureSame', { mon: monLabel(mon), nature: nature.name });
      const original = mon.natureOrig ?? mon.set.nature;
      mon.set.nature = nature.name;
      if (nature.name === original) delete mon.natureOrig; else mon.natureOrig = original;
      return;
    }
    case 'hypertrain': {

      const { mon } = findMon(state, op.ref, sim);
      if (mon.set.level < HYPER_TRAIN_LEVEL) fail('hyperLevel', { mon: monLabel(mon), level: HYPER_TRAIN_LEVEL });
      const stats = op.stats === 'all' ? STATS : [].concat(op.stats ?? []);
      if (!stats.length || stats.some(s => !STATS.includes(s))) fail('unknownStat', { stat: op.stats });
      const ivs = mon.set.ivs ??= {};
      const raise = stats.filter(s => (ivs[s] ?? MAX_IV) < MAX_IV);
      if (!raise.length) fail('ivsMax', { mon: monLabel(mon) });
      const oldMax = maxHp(sim, mon.set, ctx.formatid);
      mon.hyper ??= {};
      for (const s of raise) { mon.hyper[s] = ivs[s]; ivs[s] = MAX_IV; }
      keepHpGain(sim, mon, oldMax, ctx.formatid);
      return;
    }
    case 'boxname': {

      const index = Number(op.box);
      if (!Number.isInteger(index) || index < 0 || index >= BOX_NAME_SLOTS) fail('boxNumber', { box: op.box });
      const names = [...(state.boxNames ?? [])];
      while (names.length <= index) names.push('');
      names[index] = String(op.name ?? '').trim().slice(0, BOX_NAME_MAX);
      while (names.length && !names.at(-1)) names.pop();
      if (names.length) state.boxNames = names; else delete state.boxNames;
      return;
    }
  }
  fail('unknownOp', { op: op?.op });
}

function keepHpGain(sim, mon, oldMax, formatid) {
  if (mon.hp === null || mon.hp === undefined || mon.hp <= 0) return;
  const max = maxHp(sim, mon.set, formatid);
  mon.hp = Math.min(max, mon.hp + Math.max(0, max - oldMax));
  if (mon.hp >= max) mon.hp = null;
}

// When the queue (moves to learn, evolution) is empty, the n in "level up up-arrow n" goes to 0 as well
function settlePending(mon) {
  if (!mon.pending.moves.length && !mon.pending.evolve) mon.pending.levels = 0;
}

export function maxPp(sim, moveId, ppUps = 0, formatid) {
  return formatRules(sim, formatid || DEFAULT_FORMAT).maxPp(moveId, ppUps);
}

export const ppUpsOf = (mon, moveId) => mon?.ppUps?.[toID(moveId)] ?? 0;

export function movePp(sim, mon, moveId, formatid) {
  const id = toID(moveId), ppUps = ppUpsOf(mon, id), maxpp = maxPp(sim, id, ppUps, formatid);
  return { pp: Math.min(maxpp, mon?.pp?.[id] ?? maxpp), maxpp, ppUps };
}

function forgetMove(mon, moveId) {
  delete mon.pp[moveId];
  if (mon.ppUps) {
    delete mon.ppUps[moveId];
    if (!Object.keys(mon.ppUps).length) delete mon.ppUps;
  }
}

function ppUpsFromSlots(moves, previous) {
  const entries = moves.map(m => [m.id, Number.isInteger(m.ppUps) ? m.ppUps : previous?.[m.id] ?? 0]).filter(([, n]) => n > 0);
  return entries.length ? Object.fromEntries(entries) : null;
}

export function healParty(state, ctx, op = {}) {
  for (const mon of state.party) heal(ctx.sim, mon, op, ctx.formatid);
}

function heal(sim, mon, { hpPercent, hpAdd, statusOnly, revive }, formatid) {
  const fainted = mon.hp === 0;
  if (hpAdd !== undefined) {

    if (fainted) fail('fainted', { mon: monLabel(mon) });
    const max = maxHp(sim, mon.set, formatid);
    const hp = Math.min(max, (mon.hp ?? max) + Math.max(0, Number(hpAdd) || 0));
    mon.hp = hp >= max ? null : hp;
    return;
  }
  if (statusOnly) {
    if (!fainted) mon.status = '';
    return;
  }
  if (revive) {
    if (!fainted) return;
    mon.hp = hpPercent === undefined ? null : hpFromPercent(sim, mon.set, hpPercent, true, formatid);
    mon.status = '';
    return;
  }
  if (hpPercent !== undefined) {

    if (!fainted) mon.hp = hpFromPercent(sim, mon.set, hpPercent, true, formatid);
    return;
  }

  mon.hp = null;
  mon.status = '';
  mon.pp = {};
}

export function fillSet({ sim, levelUp }, teamSet, rng) {
  const { hpPercent, status, ...set } = clone(teamSet);
  const species = sim.Dex.species.get(set.species);
  if (!species.exists) fail('unknownSpecies', { species: set.species });
  set.species = species.name;
  if (!Number.isInteger(set.level) || set.level < 1 || set.level > MAX_LEVEL) fail('levelRange', { species: species.name, max: MAX_LEVEL, level: set.level });
  if (status !== undefined && !STATUS_IDS.has(status)) fail('unknownStatus', { species: species.name, status });
  if (set.moves?.length) {
    set.moves = set.moves.map(m => {
      const move = sim.Dex.moves.get(m);
      if (!move.exists) fail('speciesUnknownMove', { species: species.name, move: m });
      return move.id;
    });
  }
  const full = completeSet(sim.Dex, set, rng, { levelUp, label: species.name });
  full.item = full.item ? itemId(full.item) : '';
  full.name = full.name ?? '';
  return full;
}

export function newMon(ctx, set, uid) {
  const growth = growthOf(ctx, set.species);
  return {
    uid, set, hp: null, status: '', pp: {},
    exp: growth ? expForLevel(growth, set.level) : 0,
    pending: { levels: 0, moves: [], evolve: null },
  };
}

export function levelUpOutside(mon, delta, ctx, rng, { effort } = {}) {
  const { sim, levelUp } = ctx;
  effort ??= formatRules(sim, ctx.formatid || DEFAULT_FORMAT).effort;
  const next = clone(mon);
  const set = next.set;
  const from = set.level;
  const to = Math.min(MAX_LEVEL, from + Math.trunc(delta));
  if (to <= from) return next;
  const growth = growthOf(ctx, set.species);

  // Exp: kept as is within the new level, clamped into its range
  if (growth) {
    const low = expForLevel(growth, to);
    const high = to < MAX_LEVEL ? expForLevel(growth, to + 1) - 1 : low;
    next.exp = Math.max(low, Math.min(high, mon.exp ?? 0));
  }

  if (effort) {
    const curve = growth ?? 'mediumfast';
    let defeats = 0;
    for (let level = from; level < to; level++) {
      const need = expForLevel(curve, level + 1) - expForLevel(curve, level);
      defeats += need / calcExpGain({ baseExp: TYPICAL_BASE_EXP, level, victorLevel: level });
    }
    set.evs = gainEffort({ ...set.evs }, Math.max(1, Math.round(defeats)), rng);
  }

  const oldMax = maxHp(sim, { ...mon.set }, ctx.formatid);
  set.level = to;
  const newMax = maxHp(sim, set, ctx.formatid);
  if (next.hp !== null && next.hp > 0) next.hp = Math.min(newMax, next.hp + newMax - oldMax);

  next.pending.levels += to - from;
  const speciesId = sim.Dex.species.get(set.species).id;
  for (const [level, moveid] of levelUp?.[speciesId] ?? []) {
    if (level <= from || level > to) continue;
    if (set.moves.includes(moveid) || next.pending.moves.includes(moveid)) continue;
    next.pending.moves.push(moveid);
  }

  const evolution = levelEvolution(sim.Dex, set, to);
  if (evolution) next.pending.evolve = evolution;
  return next;
}

function gainEffort(evs, defeats, rng) {
  for (const s of STATS) evs[s] ??= 0;
  let total = STATS.reduce((sum, s) => sum + evs[s], 0);
  for (let i = 0; i < defeats && total < EV_TOTAL_MAX; i++) {
    const open = STATS.filter(s => evs[s] < EV_STAT_MAX);
    if (!open.length) break;
    const stat = open[rng.random(open.length)];
    const gain = Math.min(rng.random(RARE_EV_ODDS) === 0 ? RARE_EV_YIELD : TYPICAL_EV_YIELD, EV_STAT_MAX - evs[stat], EV_TOTAL_MAX - total);
    evs[stat] += gain;
    total += gain;
  }
  return evs;
}

function sameSlotAbility(from, ability, to) {
  const slot = Object.keys(from.abilities).find(k => toID(from.abilities[k]) === toID(ability)) ?? '0';
  return to.abilities[slot] ?? to.abilities['0'];
}

function evolve(ctx, mon, target) {
  const { sim, levelUp } = ctx;
  const from = sim.Dex.species.get(mon.set.species);
  const to = sim.Dex.species.get(target);
  if (!to.exists) fail('unknownSpecies', { species: target });
  mon.set.ability = sameSlotAbility(from, mon.set.ability, to);
  mon.set.species = to.name;
  mon.pending.evolve = null;

  for (const [level, moveid] of levelUp?.[to.id] ?? []) {
    if (level !== 0 || mon.set.moves.includes(moveid) || mon.pending.moves.includes(moveid)) continue;
    mon.pending.moves.push(moveid);
  }
  settlePending(mon);
}

export function applyBattleResult(before, result, ctx, { battle = null, outcome = outcomeOf(result), start = null } = {}) {
  const { sim } = ctx;
  const state = clone(before);
  const mine = result.sides.find(s => s.id === 'p1');
  const theirs = result.sides.find(s => s.id === 'p2');
  const evolutions = new Map((result.evolutions ?? []).filter(e => !e.unsupported).map(e => [e.uid, e]));
  const started = new Map((start ?? []).map(m => [m.uid, m]));

  for (const member of mine?.team ?? []) {
    const mon = [...state.party, ...state.box].find(m => m.uid === member.uid);
    if (!mon) continue;
    const from = started.get(member.uid) ?? { set: mon.set, exp: mon.exp };
    const sameSpecies = toID(mon.set.species) === toID(from.set.species);
    gainLevel(ctx, mon, member, from);

    if (member.evs) mon.set.evs = addEffort(mon.set.evs, member.evs, from.set.evs);
    learnFromBattle(mon, member.moves.map(m => m.id), (from.set.moves ?? []).map(toID));
    const slots = new Map(member.moves.map(m => [m.id, m]));
    mon.pp = Object.fromEntries(mon.set.moves.flatMap(id => {
      const slot = slots.get(id);
      if (!slot) return Object.hasOwn(mon.pp ?? {}, id) ? [[id, mon.pp[id]]] : [];
      return slot.pp < slot.maxpp ? [[id, slot.pp]] : [];
    }));

    const ppUps = ppUpsFromSlots(mon.set.moves.map(id => slots.get(id) ?? { id }), mon.ppUps);
    if (ppUps) mon.ppUps = ppUps; else delete mon.ppUps;
    mon.hp = member.fainted || member.hp <= 0 ? 0 : member.hp >= member.maxhp ? null : member.hp;
    mon.status = mon.hp === 0 ? 'fnt' : member.status || '';
    mon.pending.moves = mon.pending.moves.filter(id => !mon.set.moves.includes(id));

    const evolution = sameSpecies ? evolutions.get(member.uid) : null;
    if (evolution?.evolved === true) {
      evolve(ctx, mon, evolution.to);
      mon.pending.moves = mon.pending.moves.filter(id => !mon.set.moves.includes(id));
      markDex(state, sim, mon.set.species, true);
    } else if (evolution && evolution.evolved === undefined) {
      mon.pending.evolve = evolution.to;
    }
  }
  for (const { uid, move } of result.learnQueue ?? []) {
    const mon = [...state.party, ...state.box].find(m => m.uid === uid);
    if (mon && !mon.set.moves.includes(move) && !mon.pending.moves.includes(move)) mon.pending.moves.push(move);
  }

  for (const used of result.itemsUsed ?? []) {
    const id = toID(used.item);
    const count = Math.max(0, (state.bag[id] ?? 0) - 1);
    if (count) state.bag[id] = count; else delete state.bag[id];
  }

  for (const foe of theirs?.team ?? []) markDex(state, sim, foe.species, false);

  const who = battle && trainerKey(battle);
  if (who) {
    const team = [...theirs?.team ?? []].sort((a, b) => a.uid.localeCompare(b.uid, 'en', { numeric: true }))
      .map(foe => rosterMon({ ...foe, moves: foe.moves.map(m => m.id) }));
    state.trainers = { ...trainersOf(state), [who]: { name: battle.name, personal: personalName(battle), outcome, team } };
  }

  const caught = result.captured;
  const foe = caught && theirs?.team.find(m => m.uid === caught.uid);
  if (foe) {
    const set = {
      species: sim.Dex.species.get(caught.species).name, level: foe.level, ability: foe.ability, nature: foe.nature,
      ivs: { ...foe.ivs }, evs: { ...foe.evs }, gender: foe.gender || '', shiny: !!foe.shiny,
      teraType: foe.teraType, moves: foe.moves.map(m => m.id), item: foe.originalItem || '', name: '',
    };
    const uid = uniqueUid(state, `c${hashKey(JSON.stringify([set, caught.turn, result.turn]))}`);
    const mon = newMon(ctx, set, uid);
    mon.hp = foe.hp >= foe.maxhp ? null : foe.hp;
    mon.status = foe.status || '';
    mon.pp = Object.fromEntries(foe.moves.filter(m => m.pp < m.maxpp).map(m => [m.id, m.pp]));
    const ppUps = ppUpsFromSlots(foe.moves, null);
    if (ppUps) mon.ppUps = ppUps;
    if (caught.ball) mon.ball = caught.ball;

    // The actual box slot is decided here: last
    (caught.toBox || state.party.length >= PARTY_MAX ? state.box : state.party).push(mon);
    markDex(state, sim, set.species, true);
  }
  return state;
}

function gainLevel(ctx, mon, end, from) {
  const level = Math.min(MAX_LEVEL, mon.set.level + Math.max(0, end.level - from.set.level));
  const growth = growthOf(ctx, mon.set.species);
  if (growth) {
    const gained = Number.isFinite(end.exp) && Number.isFinite(from.exp) ? end.exp - from.exp : 0;
    const low = expForLevel(growth, level), high = level < MAX_LEVEL ? expForLevel(growth, level + 1) - 1 : low;
    mon.exp = Math.max(low, Math.min(high, (mon.exp ?? low) + gained));
  }
  mon.set.level = level;
}

function addEffort(now, end, from) {
  const out = Object.fromEntries(STATS.map(s => [s, now?.[s] ?? 0]));
  let total = STATS.reduce((sum, s) => sum + out[s], 0);
  for (const s of STATS) {
    const gain = Math.min(Math.max(0, (end[s] ?? 0) - (from?.[s] ?? 0)), EV_STAT_MAX - out[s], EV_TOTAL_MAX - total);
    out[s] += gain;
    total += gain;
  }
  return out;
}

function learnFromBattle(mon, end, from) {
  const moves = [...mon.set.moves];
  end.forEach((id, i) => {
    if (from.includes(id) || moves.includes(id)) return;
    const slot = from[i] ? moves.indexOf(from[i]) : -1;
    if (slot >= 0) moves[slot] = id;
    else if (moves.length < MAX_MOVES) moves.push(id);
    else if (!mon.pending.moves.includes(id)) mon.pending.moves.push(id);
  });
  mon.set.moves = moves;
}

export const rosterMon = set => ({ species: set.species, level: set.level, nature: set.nature, ivs: { ...set.ivs }, evs: { ...set.evs },
  ability: set.ability, gender: set.gender || '', shiny: !!set.shiny, teraType: set.teraType, moves: (set.moves ?? []).map(toID) });

export function storyEndTrainer(battle, outcome, team = null) {
  const who = battle && trainerKey(battle);
  if (!who) return null;
  return { who, trainer: { name: battle.name, personal: personalName(battle), outcome, team: team ?? battle.team.map(({ species, level }) => ({ species, level })) } };
}

// Whether a battle block asks for a double battle under a battle style. Wild: two wild Pokemon (unless always single).
// Trainer: always double, or (auto) format double or an ally at the player's side
export function wantsDouble(battle, style = 'auto') {
  if (!battle) return false;
  if (battle.wild) return style !== 'single' && (battle.team?.length ?? 0) > 1;
  if (style === 'single') return false;
  return style === 'double' || battle.format === 'double' || !!battle.ally;
}

// A block Pokemon as an engine member (the opponent's or an ally's)
function blockMember(teamSet, uid, { sim, past } = {}) {
  const { hpPercent, status, ppUps, ...blockSet } = clone(teamSet);
  const set = past ? continuePast(sim, blockSet, past) : blockSet;

  if (isCustomItem(set.item)) set.item = '';
  const member = { uid, set };
  if (ppUps) member.ppUps = ppUps;
  if (hpPercent !== undefined) member.hpPercent = hpPercent;
  if (status) member.status = status;
  return member;
}

const ableCount = team => team.filter(member => !startsFainted(member)).length;

export function toEngineSpec(state, battle, ctx, { seed, formatid, picture, player, expShare, style = 'auto' } = {}) {
  if (!state.party.length) fail('noParty');
  if (!state.party.some(m => m.hp !== 0)) fail('allFainted');
  const { sim } = ctx;
  const place = battle.place || 'plains';
  const { sprite, silhouette } = opponentPicture(battle, picture);
  const bgm = bossBgm({ wild: battle.wild, boss: battle.boss, sprite, name: battle.name, trainerClass: battle.trainerClass });

  const p1 = state.party.map(mon => engineMember(mon, state.customItems));

  const past = pairPast(sim, battle.team, trainersOf(state)[trainerKey(battle)]?.team ?? []);
  const double = wantsDouble(battle, style);
  const ableMine = ableCount(p1);

  let p2 = battle.team.map((teamSet, i) => blockMember(teamSet, `foe-${i + 1}`, { sim, past: past[i] }));

  // A second wild Pokemon only when both sides can field two: otherwise it would come out after the first in a single battle
  if (battle.wild && !(double && ableMine >= 2 && ableCount(p2) >= 2)) p2 = p2.slice(0, 1);

  // The ally only joins a battle that stays double (two able Pokemon on the opponent's side), else the player fights alone
  const allyTeam = double && battle.ally ? battle.ally.team.map((teamSet, i) => blockMember(teamSet, `ally-${i + 1}`)) : [];
  const partner = allyTeam.length && ableCount(allyTeam) && ableCount(p2) >= 2
    ? { name: battle.ally.name || say(ctx.lang, 'spec.ally'), team: allyTeam } : null;
  return {
    ...(seed ? { seed: [...seed] } : {}),
    formatid: formatid || ctx.formatid || DEFAULT_FORMAT,
    ...(double ? { double: true } : {}),
    ...(partner ? { partner } : {}),
    p1: { name: ctx.playerName || PLAYER_NAME, team: p1,

      ...(player ? { trainerSprite: player.gender } : {}), ...(player?.silhouette ? { trainerSilhouette: true } : {}) },
    p2: { name: battle.name || say(ctx.lang, battle.wild ? 'spec.wild' : 'spec.foe'), team: p2,

      ...(sprite ? { trainerSprite: sprite } : {}), ...(silhouette ? { trainerSilhouette: true } : {}) },

    ...(bgm ? { bgm } : {}),
    bag: {

      items: Object.fromEntries(Object.entries(state.bag).filter(([id]) => BAG_ITEMS[id] || isBall(id))), wild: !!battle.wild, caughtSpecies: [...state.dex.caught],
      env: { night: battle.time === 'night', cave: CAVE_BIOMES.has(place), water: WATER_BIOMES.has(place) },
    },
    wild: !!battle.wild,
    boss: !battle.wild && !!battle.boss,
    ...(expShareOn(expShare, state.bag) ? {} : { expShare: false }),
    teraOrb: (state.bag.teraorb ?? 0) > 0,
    biome: place,
  };
}

function pairPast(sim, team, pastTeam) {
  const left = [...pastTeam];
  return team.map(({ species }) => {
    const target = sim.Dex.species.get(species);
    const at = [left.findIndex(m => toID(m.species) === target.id), left.findIndex(m => evolvedFrom(sim, target, m.species))].find(j => j >= 0);
    return at === undefined ? null : left.splice(at, 1)[0];
  });
}

function evolvedFrom(sim, target, past) {
  for (let s = sim.Dex.species.get(target.prevo); s.exists; s = sim.Dex.species.get(s.prevo)) if (s.id === toID(past)) return true;
  return false;
}

function continuePast(sim, set, past) {
  const from = sim.Dex.species.get(past.species), to = sim.Dex.species.get(set.species);
  const same = from.id === to.id;
  const carry = { nature: past.nature, ivs: past.ivs, evs: past.evs, ability: same || past.ability === undefined ? past.ability : sameSlotAbility(from, past.ability, to),
    gender: past.gender, shiny: past.shiny, teraType: past.teraType, ...(same && set.level === past.level ? { moves: past.moves } : {}) };
  const out = { ...set };

  for (const [k, v] of Object.entries(carry)) if (out[k] === undefined && v !== undefined) out[k] = clone(v);
  return out;
}

export function findMon(state, ref, sim, { boxFirst = false } = {}) {
  if (ref && typeof ref.uid === 'string') {

    for (const list of [state.party, state.box]) {
      const index = list.findIndex(m => m.uid === ref.uid);
      if (index >= 0) return { list, index, mon: list[index] };
    }
    fail('monGone');
  }
  if (ref && Number.isInteger(ref.box)) {

    const mon = state.box[ref.box - 1];
    if (!mon) fail('noBoxMon', { n: ref.box });
    return { list: state.box, index: ref.box - 1, mon };
  }
  if (ref && Number.isInteger(ref.slot)) {
    const mon = state.party[ref.slot - 1];
    if (!mon) fail('noPartyMon', { n: ref.slot });
    return { list: state.party, index: ref.slot - 1, mon };
  }
  const name = String(ref?.name ?? '').trim();
  if (!name) fail('noWho');
  const lists = boxFirst ? [state.box, state.party] : [state.party, state.box];
  const key = name.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  for (const list of lists) {
    const index = list.findIndex(m => m.set.name && m.set.name.normalize('NFKC').toLowerCase().replace(/\s+/g, '') === key);
    if (index >= 0) return { list, index, mon: list[index] };
  }
  const species = speciesName(name);
  if (species) {
    const id = toID(species);
    for (const list of lists) {
      let index = list.findIndex(m => toID(m.set.species) === id);
      if (index < 0) index = list.findIndex(m => toID(sim.Dex.species.get(m.set.species).baseSpecies) === id);
      if (index >= 0) return { list, index, mon: list[index] };
    }
  }
  fail('notFound', { name });
}

export function rngFor(sim, text) {
  const a = parseInt(hashKey(text), 36), b = parseInt(hashKey(`${text}#`), 36);
  const seed = [a % 65536, Math.floor(a / 65536) % 65536, b % 65536, Math.floor(b / 65536) % 65536];
  if (seed.every(n => n === 0)) seed[0] = 1;
  return new sim.PRNG(seed);
}

export function uniqueUid(state, base) {
  const used = new Set([...state.party, ...state.box].map(m => m.uid));
  let uid = base;
  for (let n = 2; used.has(uid); n++) uid = `${base}-${n}`;
  return uid;
}

const growthOf = ({ sim, exp }, species) => growthOfSpecies(exp, sim.Dex.species.get(species));

export function maxHp(sim, set, formatid) {
  return formatRules(sim, formatid || DEFAULT_FORMAT).maxHp(set);
}

export function hpPercentOf(sim, mon, formatid) {
  if (mon.hp === null || mon.hp === undefined) return 100;
  if (mon.hp <= 0) return 0;
  return Math.max(1, Math.min(100, Math.round(mon.hp / maxHp(sim, mon.set, formatid) * 100)));
}

export function hpFromPercent(sim, set, percent, keepAlive = false, formatid) {
  if (percent >= 100) return null;
  const hp = Math.round(maxHp(sim, set, formatid) * percent / 100);
  return percent > 0 || keepAlive ? Math.max(1, hp) : hp;
}

export function markDex(state, sim, species, caught) {
  const id = sim.Dex.species.get(species).id;
  if (!id) return;
  if (!state.dex.seen.includes(id)) state.dex.seen.push(id);
  if (caught && !state.dex.caught.includes(id)) state.dex.caught.push(id);
}

function monLabel(mon) {
  return mon.set.name || mon.set.species;
}
