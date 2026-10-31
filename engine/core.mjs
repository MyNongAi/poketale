import { DEFAULT_FORMAT, doublesFormat } from './rules.mjs';
import { installExtensions, extensionResults } from './extensions.mjs';
import { completeSet, heldItemForm } from './mon.mjs';
import { checkSpec } from './input.mjs';
import { startsFainted } from './initial-state.mjs';

// Format defaults and HP, PP and EV rules live in engine/rules.mjs
export { DEFAULT_FORMAT, MAINLINE_FORMAT, CHAMPIONS_FORMAT, doublesFormat } from './rules.mjs';
export { winnerSide } from './winner.mjs';

export function createStoryBattle(sim, given, options = {}) {
	const spec = tagSpec(given);

	checkSpec(sim.Dex, spec);

	const battle = new sim.Battle({
		formatid: doubleBattle(spec) ? doublesFormat(spec.formatid || DEFAULT_FORMAT) : spec.formatid || DEFAULT_FORMAT,
		seed: spec.seed,
		send: spec.send,
	});

	const context = { spec, options };
	installExtensions(sim, battle, 'create', context);

	const rng = new sim.PRNG(spec.seed);

	context.sets = {};
	for (const key of ['p1', 'p2']) {
		context.sets[key] = spec[key].team.map(m => completeSet(sim.Dex, m.set, rng, { levelUp: options.levelUp, label: m.uid }));
		battle.setPlayer(key, { name: spec[key].name, team: sim.Teams.pack(context.sets[key].map(set => heldItemForm(sim.Dex, set))) });
	}
	installExtensions(sim, battle, 'players', context);
	return battle;
}

function tagSpec(spec) {
	if (!spec.partner) return spec;
	if (!spec.double) throw new Error('태그배틀(partner)은 더블배틀(double)에서만 됩니다');
	return { ...spec, p1: { ...spec.p1, team: [...spec.p1.team, ...spec.partner.team.map(member => ({ ...member, partner: spec.partner.name }))] } };
}

function doubleBattle(spec) {
	return !!spec.double && [spec.p1, spec.p2].every(side => side.team.filter(member => !startsFainted(member)).length >= 2);
}

// Copies the current engine state as JSON, whether or not the battle has ended.
export function extractResult(sim, battle) {
	return {
		ended: battle.ended,
		turn: battle.turn,
		...(battle.activePerHalf > 1 ? { double: true } : {}),
		sides: battle.sides.map(side => ({
			id: side.id,
			name: side.name,
			pokemonLeft: side.pokemonLeft,
			team: side.pokemon.filter(p => !p.m.partner).map(p => resultMon(sim, p)),
		})),

		...(battle.sides[0].pokemon.some(p => p.m.partner) ? { partner: battle.sides[0].pokemon.filter(p => p.m.partner).map(p => resultMon(sim, p)) } : {}),

		...extensionResults(battle),
	};
}

function resultMon(sim, p) {
	return {
		uid: p.m.uid,

		species: p.m.start.species,
		baseSpecies: p.m.start.species,
		name: p.name,
		level: p.level,
		hp: p.hp,
		maxhp: p.maxhp,
		fainted: p.fainted,
		status: p.fainted ? 'fnt' : p.status || '',
		active: p.isActive,
		item: p.item || '',
		originalItem: sim.Dex.toID(p.set.item) || '',
		ability: sim.Dex.toID(p.m.start.ability),

		nature: p.set.nature,
		ivs: { ...p.set.ivs },

		evs: { ...p.set.evs },
		gender: p.gender,
		shiny: !!p.set.shiny,
		teraType: p.teraType,
		terastallized: p.terastallized || '',

		moves: p.baseMoveSlots.map((s, i) => ({ id: s.id, pp: s.pp, maxpp: s.maxpp, ppUps: p.ppUps[i] ?? 0 })),
		exp: p.m.exp,
	};
}
