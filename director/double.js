import { positionAt } from './read.js';
import { moveTargets } from './targets.js';
import { ownText } from './text.js';
import { isReviving, lockedTurn, slotMove } from './simple-ai.js';
import { gimmickOptions, gimmickSuffix } from './steps-mega.js';
import { moveMenuInfo } from './move-info.js';

export async function chooseDouble(ctx, request) {
  return request.forceSwitch ? forcedSwitches(ctx, request) : commands(ctx, request);
}

// Party slots with the Pokemon already picked by an earlier position this turn blocked
function withChosen(ctx, party, chosen) {
  return party.map((slot, i) => (chosen.has(i) && !slot.blocked ? { ...slot, blocked: ownText('own.alreadyChosen', { pokemonName: slot.name }, ctx.lang) } : slot));
}

// The trainer of a Pokemon on the player's side: the tag partner's name, or null for the player's own
const ownerOf = pokemon => pokemon?.m.partner ?? null;

async function forcedSwitches(ctx, request) {
  const { battle } = ctx;
  const side = battle.sides[0];
  const reviving = isReviving(request);
  const party = ctx.partySlots(request, { reviving });
  const chosen = new Set();
  const open = owned => party.map((slot, j) => j).filter(j => !chosen.has(j) && owned(ownerOf(side.pokemon[j]))
    && (reviving ? party[j].fainted : !party[j].fainted && !party[j].active));
  const picks = [];
  for (const [i, asked] of request.forceSwitch.entries()) {
    const own = ownerOf(side.active[i]);
    const mine = asked ? open(owner => owner === own) : [];
    const candidates = asked && !mine.length ? open(owner => owner !== own) : mine;
    if (!candidates.length) { picks.push('pass'); continue; }
    if (ownerOf(side.pokemon[candidates[0]])) {
      picks.push(`switch ${candidates[0] + 1}`);
      chosen.add(candidates[0]);
      continue;
    }
    const slots = withChosen(ctx, party, chosen);
    const choice = await ctx.view.chooseSwitch({ party: slots, forced: true, position: positionAt(0, i), ...(reviving ? { revive: true } : {}) });
    picks.push(ctx.switchChoice(choice, slots, { reviving }));
    chosen.add(choice.slot);
  }
  return picks.join(', ');
}

// A Tatsugiri inside Dondozo (Commander) takes no action: Showdown passes for it
const commanding = pokemon => !!pokemon?.volatiles?.commanding;

// The first field position the player commands this turn: run and the whole-side choices start there
function firstOwn(side, request) {
  const i = request.active.findIndex((active, j) => { const p = side.active[j]; return p && !p.fainted && !commanding(p) && !p.m.partner; });
  return i < 0 ? 0 : i;
}

async function commands(ctx, request) {
  const { battle, view, run, bag } = ctx;
  const side = battle.sides[0];
  const picks = [];
  const first = firstOwn(side, request);
  for (let i = 0; i < request.active.length;) {
    const active = request.active[i], pokemon = side.active[i];
    if (!pokemon || pokemon.fainted || commanding(pokemon)) { picks[i++] = 'pass'; continue; }
    if (lockedTurn(active)) { picks[i++] = 'move 1'; continue; }
    if (pokemon.m.partner) { picks[i] = slotMove(battle, 'p1', i); i++; continue; }

    const asked = picks.some(pick => typeof pick === 'object');
    const chosen = new Set(picks.filter(pick => pick?.slot !== undefined).map(pick => pick.slot));
    const choice = await view.chooseAction(commandOptions(ctx, request, i, chosen, { back: asked, first, gimmickUsed: picks.some(pick => pick?.gimmick), itemUsed: picks.some(pick => pick?.bag) }));
    if (choice?.kind === 'back') {
      if (!asked) throw new Error('Invalid player choice');
      picks.length = 0; i = 0;
      continue;
    }
    if (choice?.kind === 'run') {
      if (i !== first) throw new Error('Invalid player choice');
      return run.choice();
    }
    // A bag item takes this position's turn only; the other positions still act (one item a turn)
    if (choice?.kind === 'item') {
      if (!bag || picks.some(pick => pick?.bag)) throw new Error('Invalid player choice');
      picks[i] = { ...bag.choice(choice, i), text: 'pass' };
      i++;
      continue;
    }
    picks[i] = pickOf(ctx, request, i, choice, chosen);
    i++;
  }
  const parts = picks.map(pick => (typeof pick === 'string' ? pick : pick.text));
  const item = picks.find(pick => pick?.bag);
  return item ? { bag: item.bag, parts } : parts.join(', ');
}

function commandOptions(ctx, request, i, chosen, { back, first = 0, gimmickUsed, itemUsed }) {
  const { battle, names, lang, run, gimmicks, bag } = ctx;
  const active = request.active[i], pokemon = battle.sides[0].active[i];
  const moves = active.moves.map(option => {
    const move = battle.dex.moves.get(option.id);
    const where = moveTargets(battle, pokemon, option.target ?? move.target);
    return {
      id: option.id, name: names.move(option.id),
      pp: option.pp, maxpp: option.maxpp, disabled: !!option.disabled,
      ...(option.disabled || (option.pp ?? 1) <= 0 ? { blocked: ctx.moveDeniedText(battle, names, option, lang, pokemon) } : {}),

      ...moveMenuInfo(battle, option.id, pokemon, firstFoe(where, pokemon) ?? battle.sides[1].active.find(p => p && !p.fainted)),
      target: { choose: where.choose, spread: where.spread, targets: where.targets.map(t => t.position) },
    };
  });
  const party = withChosen(ctx, ctx.partySlots(request, { trapped: !!active.trapped }), chosen);
  return {
    position: positionAt(0, i), ...(back ? { back: true } : {}), moves, canSwitch: true, party,

    ...(gimmickUsed ? {} : gimmickOptions(request, gimmicks, i)),
    ...(bag && !itemUsed ? { bag: bag.menu(i) } : {}),
    ...(i === first ? { run: run.menu() } : {}),
  };
}

function firstFoe(where, pokemon) {
  const foe = where.targets.find(t => !t.ally);
  return foe ? pokemon.getAtLoc(foe.loc) : null;
}

function pickOf(ctx, request, i, choice, chosen) {
  const { battle } = ctx;
  if (choice?.kind === 'switch') {
    const slots = withChosen(ctx, ctx.partySlots(request, { trapped: !!request.active[i].trapped }), chosen);
    return { text: ctx.switchChoice(choice, slots), slot: choice.slot };
  }
  const active = request.active[i], pokemon = battle.sides[0].active[i];
  const option = active.moves[choice?.index];
  if (choice?.kind !== 'move' || !option || option.disabled) throw new Error('Invalid player choice');
  const where = moveTargets(battle, pokemon, option.target ?? battle.dex.moves.get(option.id).target);
  let loc = '';
  if (where.choose) {
    const target = where.targets.length === 1 && !choice.target ? where.targets[0] : where.targets.find(t => t.position === choice.target);
    if (!target) throw new Error('Invalid player choice');
    loc = ` ${target.loc}`;
  }
  const suffix = gimmickSuffix(choice, request, ctx.gimmicks, i);
  return { text: `move ${choice.index + 1}${loc}${suffix}`, gimmick: !!suffix };
}
