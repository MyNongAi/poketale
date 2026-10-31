import { moveTargets } from './targets.js';

export const isReviving = request => !!request?.forceSwitch && !!request.side?.pokemon?.some(p => p.active && p.reviving);

export const lockedTurn = active => active.moves.length === 1 && active.moves[0].pp === undefined && !!active.trapped && active.moves[0].id !== 'struggle';

export function simpleAI(battle, sideId) {
  const side = battle.getSide(sideId);
  const request = side.activeRequest;

  if (request?.forceSwitch) {
    const reviving = isReviving(request), used = new Set();
    const picks = request.forceSwitch.map(asked => {
      if (!asked) return 'pass';
      const index = request.side.pokemon.findIndex((p, i) => !used.has(i) && !p.active && / fnt$/.test(p.condition) === reviving);
      if (index < 0) return 'pass';
      used.add(index);
      return `switch ${index + 1}`;
    });
    if (picks.every(pick => pick === 'pass')) throw new Error(`${sideId}: no Pokemon to switch in`);
    return picks.join(', ');
  }
  if (!request?.active?.length) throw new Error(`${sideId}: no move request`);
  return request.active.map((slot, i) => {
    const pokemon = side.active[i];
    if (!pokemon || pokemon.fainted || pokemon.volatiles?.commanding || !slot?.moves?.length) return 'pass';
    return moveChoice(battle, sideId, pokemon, slot.moves);
  }).join(', ');
}

// The move choice of one field position i ('move N [loc]') - a tag partner's command (director/double.js)
export function slotMove(battle, sideId, i) {
  const side = battle.getSide(sideId);
  return moveChoice(battle, sideId, side.active[i], side.activeRequest.active[i].moves);
}

function moveChoice(battle, sideId, pokemon, moves) {

  if (moves.length === 1 && moves[0].pp === undefined) return 'move 1';
  const double = battle.activePerHalf > 1;
  const score = (move, target) => {
    if (!target || target.fainted) return 0;
    const matchup = battle.dex.getImmunity(move.type, target) ? 2 ** battle.dex.getEffectiveness(move.type, target) : 0;
    return move.basePower * matchup * (pokemon.hasType(move.type) ? 1.5 : 1);
  };
  let best = -1, bestScore = -Infinity, bestLoc = 0;
  moves.forEach((option, index) => {
    if (option.disabled || option.pp === 0) return;
    const move = battle.dex.moves.get(option.id);
    if (!double) {
      const value = score(move, pokemon.side.foe.active[0]);
      if (value > bestScore) { best = index; bestScore = value; }
      return;
    }
    const where = moveTargets(battle, pokemon, option.target ?? move.target);
    const foes = where.targets.filter(t => !t.ally);
    let value = 0, loc = 0;
    if (where.choose) {
      for (const t of foes) { const v = score(move, pokemon.getAtLoc(t.loc)); if (v > value || !loc) { value = v; loc = t.loc; } }
      if (!loc) loc = where.targets[0]?.loc ?? 0;
    } else if (where.spread) {
      value = foes.reduce((sum, t) => sum + score(move, pokemon.getAtLoc(t.loc)), 0) * 0.75;
      value -= where.targets.filter(t => t.ally && t.loc !== pokemon.getLocOf(pokemon)).reduce((sum, t) => sum + score(move, pokemon.getAtLoc(t.loc)), 0);
    }
    if (value > bestScore) { best = index; bestScore = value; bestLoc = loc; }
  });
  if (best < 0) throw new Error(`${sideId}: no usable move in request`);
  return `move ${best + 1}${bestLoc ? ` ${bestLoc}` : ''}`;
}
