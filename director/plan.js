import { buildEngine, replaySnapshot, applyInput, fingerprint, stateCheck, checkSnapshot, battlePoint, moveDeniedText, hiddenTrapText, SNAPSHOT_VERSION } from './index.js';
import { createSteps } from './steps.js';
import { arrange } from './order.js';
import { createProtocolReader } from './parse.js';
import { checkLang, DEFAULT_LANG } from './lang.js';
import { loadExpText } from './steps-exp.js';
import { gimmickOptions } from './steps-mega.js';
import { commitChoice } from '../ai/commit.js';

// Most turns one command block may hold
const PLAN_MAX_TURNS = 6;

const plain = request => !!request && !request.wait && !request.forceSwitch && !!request.active;
const lower = s => String(s ?? '').trim().toLowerCase();

function slotOf(side, who) {
  if (!who) return -1;
  if (Number.isInteger(who.slot)) return side.pokemon.findIndex(p => p.set === side.team[who.slot - 1]);
  const byName = side.pokemon.findIndex(p => who.name && lower(p.name) === lower(who.name));
  if (byName >= 0) return byName;
  return side.pokemon.findIndex(p => who.species && (p.species.id === who.species || p.baseSpecies.id === who.species
    || p.battle.dex.species.get(p.m?.start?.species ?? '').id === who.species));
}

function resolveMine(ctx, request, me) {
  const { battle, bag, run, names, lang, wild, gimmicks } = ctx;
  const side = battle.sides[0];
  if (request.forceSwitch) {

    // A faint (or a pivot move) left a slot to fill: only a switch can fill it
    if (me.kind !== 'switch') return { reason: 'noSwitch' };
  }
  if (me.kind === 'move') {
    const options = request.active[0].moves;

    if (options.length === 1 && options[0].pp === undefined && request.active[0].trapped && options[0].id !== 'struggle') return { choice: 'move 1' };
    const index = options.findIndex(option => option.id === me.move);
    if (index < 0) return { reason: 'noMove' };
    const option = options[index];
    if ((option.pp ?? 1) <= 0) return { reason: 'noPp', text: moveDeniedText(battle, names, option, lang) };
    if (option.disabled) return { reason: 'disabled', text: moveDeniedText(battle, names, option, lang) };

    const offered = gimmickOptions(request, gimmicks);
    const suffix = me.gimmick === 'mega' && offered.mega ? ' mega' : me.gimmick === 'tera' && offered.tera ? ' terastallize' : '';
    return { choice: `move ${index + 1}${suffix}` };
  }
  if (me.kind === 'switch') {
    const slot = slotOf(side, me.target);
    const pokemon = request.side.pokemon[slot];
    if (!pokemon || pokemon.active || / fnt$/.test(pokemon.condition)) return { reason: 'noSwitch' };
    if (!request.forceSwitch && request.active[0].trapped) return { reason: 'trapped', text: hiddenTrapText(battle, names, lang, wild) };
    return { choice: `switch ${slot + 1}` };
  }
  if (me.kind === 'item') {
    if (!bag || !(bag.counts.get(me.item) > 0)) return { reason: 'noItem' };
    const named = slotOf(side, me.target);
    const slot = named >= 0 ? named : side.pokemon.findIndex(p => p.isActive);
    const pokemon = side.pokemon[slot];
    const move = me.move ? pokemon?.moveSlots.findIndex(s => s.id === me.move) : pokemon?.moveSlots.findIndex(s => s.pp < s.maxpp);
    try { return { choice: bag.choice({ kind: 'item', item: me.item, slot, move: Math.max(move ?? 0, 0) }) }; }
    catch { return { reason: 'cantUse' }; }
  }
  if (me.kind === 'run') {
    try { return { choice: run.choice() }; } catch { return { reason: 'cantRun' }; }
  }
  return { reason: 'noMove' };
}

function resolveFoe(battle, request, foe) {
  if (!foe || !plain(request)) return null;
  if (foe.kind === 'move') {
    const index = request.active[0].moves.findIndex(option => option.id === foe.move && !option.disabled && (option.pp ?? 1) > 0);
    return index < 0 ? null : `move ${index + 1}`;
  }
  if (foe.kind === 'switch') {
    const slot = slotOf(battle.sides[1], foe.target);
    const pokemon = request.side.pokemon[slot];
    return !pokemon || pokemon.active || / fnt$/.test(pokemon.condition) || request.active[0].trapped ? null : `switch ${slot + 1}`;
  }
  if (foe.kind === 'item') return `item ${foe.item}`;
  return null;
}

const breaks = (battle, from) => battle.ended || battle.log.slice(from).some(line => line.startsWith('|faint|'))
  || battle.sides.some(side => side.activeRequest?.forceSwitch);

export async function planTurns(sim, snapshot, turns, { options = {}, enemyAI, names, lang = DEFAULT_LANG } = {}) {
  checkSnapshot(snapshot);
  checkLang(lang);
  await loadExpText(lang);
  const { battle, wild, bag, run } = buildEngine(sim, snapshot.spec, options, names, lang);
  try {
    const inputs = [];
    const input = entry => { inputs.push(structuredClone(entry)); return applyInput({ battle, bag, run }, entry); };
    const fp = fingerprint(battle);
    replaySnapshot(battle, snapshot, fp, input);
    enemyAI.loadState?.(battle, snapshot.ai);
    const reseeds = snapshot.reseeds ?? [];

    const lines = [], marks = {};
    const view = new Proxy({}, { get: (_, key) => (key === 'then' ? undefined
      : key === 'message' ? async message => { if (typeof message === 'string') lines.push(message.replace(/\n/g, ' ')); } : async () => undefined) });
    const step = createSteps({ battle, view, names, warn: () => {}, bag, options, run, mode: { silent: true }, wild, lang, onInput: () => {} });
    const reader = createProtocolReader();
    const readOn = async () => {
      for (const item of arrange(reader.read(battle.log, battle.storyLogMeta))) {
        await step(item);
        if (item.kind === 'turn') marks[Number(item.args[0])] = lines.length;
      }
      await step.flush();
    };
    await readOn();
    const logFrom = battle.log.length;
    const ctx = { battle, bag, run, names, lang, wild, gimmicks: { teraOrb: snapshot.spec.teraOrb !== false } };
    const entries = [], results = [];
    const enemy = async () => (await enemyAI(battle, 'p2'));

    const p1 = () => battle.sides[0].activeRequest, p2 = () => battle.sides[1].activeRequest;
    if (turns.length && !battle.ended && p1()?.wait && p2()?.forceSwitch) {
      const choice = await enemy();
      if (!input(['p2', choice])) throw new Error(`Engine rejected enemy choice: ${choice}`);
      commitChoice(battle, 'p2', choice);
      await readOn();
    }
    let stop = false;
    for (const command of turns.slice(0, PLAN_MAX_TURNS)) {
      const request = p1();
      if (stop || battle.ended || !request || request.wait || (request.forceSwitch && results.length)) { results.push({ state: 'dropped' }); stop = true; continue; }
      // Story commands name one Pokemon's action: a double battle is commanded on the battle screen
      if (battle.activePerHalf > 1) { results.push({ state: 'rejected', reason: 'double' }); stop = true; continue; }
      const from = battlePoint(battle);
      const mine = resolveMine(ctx, request, command.me);
      if (!mine.choice) { results.push({ state: 'rejected', reason: mine.reason, ...(mine.text ? { text: mine.text } : {}) }); stop = true; continue; }
      const logFrom = battle.log.length, turn = battle.turn, given = inputs.length;
      const enemyRequest = p2();
      const asks = enemyRequest && !enemyRequest.wait;

      let foe = asks ? resolveFoe(battle, enemyRequest, command.foe) : null;
      if (asks && !foe) foe = await enemy();
      if (!input(['p1', mine.choice])) {

        const retry = p1()?.active?.[0];
        const blocked = /^move (\d+)/.exec(typeof mine.choice === 'string' ? mine.choice : '');
        const text = retry?.trapped && /^switch/.test(mine.choice) ? hiddenTrapText(battle, names, lang, wild)
          : blocked && retry?.moves?.[blocked[1] - 1]?.disabled ? moveDeniedText(battle, names, retry.moves[blocked[1] - 1], lang) : undefined;
        inputs.length = given;
        results.push({ state: 'rejected', reason: /^switch/.test(mine.choice) ? 'trapped' : 'disabled', ...(text ? { text } : {}) });
        stop = true;
        continue;
      }
      commitChoice(battle, 'p1', mine.choice);
      if (foe && !run.ends(mine.choice)) {
        let accepted = input(['p2', foe]);
        if (!accepted) { foe = await enemy(); accepted = input(['p2', foe]); }
        if (!accepted) throw new Error(`Engine rejected enemy choice: ${foe}`);
        commitChoice(battle, 'p2', foe);
      }
      entries.push({ from, inputs: inputs.slice(given), ai: enemyAI.saveState?.(battle) ?? null });
      results.push({ state: 'done', turn });
      await readOn();
      if (breaks(battle, logFrom)) stop = true;
    }
    const to = { v: SNAPSHOT_VERSION, spec: snapshot.spec, inputs: structuredClone(inputs), ai: enemyAI.saveState?.(battle) ?? null,
      turn: battle.turn, fp, check: stateCheck(battle), ...(reseeds.length ? { reseeds: structuredClone(reseeds) } : {}) };
    return { entries, turns: results, to, lines, marks, log: [...battle.log], logFrom };
  } finally {
    battle.destroy();
  }
}

export function commandQueue(entries) {
  const queue = [...entries ?? []];
  return {
    take(point) {
      const next = queue[0];
      if (!next || next.from.turn !== point.turn || next.from.check !== point.check) return null;
      return queue.shift();
    },
    get left() { return queue.length; },
  };
}
