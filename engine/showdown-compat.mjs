export function injectStatus(battle, pokemon, status, { sleepTurns, freezeTurns } = {}) {
	pokemon.status = status;
	pokemon.statusState = battle.initEffectState({ id: status, target: pokemon });
	if (status === 'slp') pokemon.statusState.startTime = pokemon.statusState.time = sleepTurns;
	if (status === 'frz' && freezeTurns) pokemon.statusState.startTime = pokemon.statusState.time = freezeTurns;
	if (status === 'tox') pokemon.statusState.stage = 0;
}

export function setLevel(battle, pokemon, level) {
	pokemon.set.level = level;
	pokemon.level = level;
	pokemon.details = pokemon.getUpdatedDetails();
	const species = pokemon.transformed ? pokemon.baseSpecies : pokemon.species;
	const stats = battle.spreadModify(species.baseStats, pokemon.set);
	if (species.maxHP) stats.hp = species.maxHP;
	pokemon.baseStoredStats = stats;
	if (!pokemon.transformed) {
		for (const s of Object.keys(pokemon.storedStats)) pokemon.storedStats[s] = stats[s];
		pokemon.speed = pokemon.storedStats.spe;
	}
	const oldMax = pokemon.maxhp;
	pokemon.baseMaxhp = stats.hp;
	pokemon.maxhp = pokemon.volatiles['dynamax'] ? 2 * stats.hp : stats.hp;
	if (pokemon.hp > 0) pokemon.hp = Math.max(1, pokemon.hp + pokemon.maxhp - oldMax);
}

export function newMoveSlot(move, pp) {
	return { move: move.name, id: move.id, pp, maxpp: pp, target: move.target, disabled: false, disabledSource: '', used: false };
}

export function revive(battle, pokemon, hp) {
	pokemon.side.pokemonLeft++;
	pokemon.fainted = false;
	pokemon.faintQueued = false;
	pokemon.subFainted = false;
	pokemon.status = '';
	pokemon.statusState = battle.initEffectState({ id: '', target: pokemon });
	pokemon.hp = hp;
}

const SWITCH_ORDER = 103;

// The side's first Pokemon on the field that can still act (a double battle can have a fainted Pokemon left in the first position)
export const leadOf = side => side.active.find(p => p && !p.fainted && !p.volatiles?.commanding) ?? side.active[0];

export function chooseEventAction(battle, side, event) {
	side.clearChoice();
	const lead = leadOf(side);

	// The side's other Pokemon on the field do nothing this turn (a run takes the whole side's turn)
	for (const pokemon of side.active) {
		side.choice.actions.push(pokemon === lead ? { choice: 'event', event, order: SWITCH_ORDER, priority: 0, pokemon, side } : { choice: 'pass', pokemon, side });
	}
	if (battle.allChoicesDone()) battle.commitChoices();
}

const MOVE_EVENTS = { mega: 'mega', megax: 'megax', megay: 'megay', zmove: 'zmove', ultra: 'ultra', dynamax: 'dynamax', max: 'dynamax', terastal: 'terastallize', terastallize: 'terastallize' };

// One position's part of a side choice: 'move N [target] [gimmick]', 'switch N' or 'pass' (as Side#choose reads it)
function chooseOne(side, text) {
	const [kind, ...rest] = String(text ?? 'pass').trim().split(/\s+/);
	if (kind === 'pass') return side.choosePass();
	if (kind === 'switch') return side.chooseSwitch(rest.join(' '));
	if (kind !== 'move') return false;
	let targetLoc, event = '';
	while (rest.length > 1) {
		const last = rest.at(-1);
		if (targetLoc === undefined && /^[-+]?[1-3]$/.test(last)) targetLoc = parseInt(last, 10);
		else if (!event && MOVE_EVENTS[last]) event = MOVE_EVENTS[last];
		else break;
		rest.pop();
	}
	return side.chooseMove(rest.join(' '), targetLoc, event);
}

// A double battle turn where the Pokemon at one position uses an event action (a bag item) and the others take their own parts.
// false (nothing chosen) when the engine refuses a part, as Battle#choose does
export function chooseSlotEvent(battle, side, slot, event, parts) {
	side.clearChoice();
	for (const [i, pokemon] of side.active.entries()) {
		if (i === slot) side.choice.actions.push({ choice: 'event', event, order: SWITCH_ORDER, priority: 0, pokemon, side });
		else if (!chooseOne(side, parts[i]) || side.choice.error) { side.clearChoice(); return false; }
		// Each part fills its own position only (Showdown auto-passes skipped positions, which would shift the rest)
		if (side.choice.actions.length !== i + 1) { side.clearChoice(); return false; }
	}
	if (battle.allChoicesDone()) battle.commitChoices();
	return true;
}

export function findTrap(battle, pokemon) {
	const candidates = [];
	for (const [id, state] of Object.entries(pokemon.volatiles)) candidates.push({ id, state, event: 'TrapPokemon', holder: pokemon });
	for (const [id, state] of Object.entries(battle.field.pseudoWeather)) candidates.push({ id, state, event: 'TrapPokemon', holder: null });
	for (const foe of pokemon.foes()) {
		if (!foe.ignoringAbility()) candidates.push({ ability: foe.getAbility(), state: foe.abilityState, event: 'FoeTrapPokemon', holder: foe });
		for (const [id, state] of Object.entries(foe.volatiles)) candidates.push({ id, state, event: 'FoeTrapPokemon', holder: foe });
	}
	const saved = { trapped: pokemon.trapped, maybeTrapped: pokemon.maybeTrapped };
	const parent = { effect: battle.effect, effectState: battle.effectState };
	try {
		for (const candidate of candidates) {
			const effect = candidate.ability ?? battle.dex.conditions.getByID(candidate.id);
			const handler = effect?.[`on${candidate.event}`];
			if (typeof handler !== 'function') continue;
			pokemon.trapped = false;
			battle.effect = effect;
			battle.effectState = candidate.state;
			handler.call(battle, pokemon);
			if (pokemon.trapped) return { candidate, effect };
		}
		return null;
	} finally {
		Object.assign(pokemon, saved);
		battle.effect = parent.effect;
		battle.effectState = parent.effectState;
	}
}
