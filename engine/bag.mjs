import { BALLS, ballModifier, captureValues, rollCapture } from './capture.mjs';
import { awardCaptureExperience } from './exp.mjs';
import { PARTY_MAX, toID } from './mon.mjs';
import { chooseEventAction, chooseSlotEvent, leadOf, revive } from './showdown-compat.mjs';

// Bag items usable in battle. Balls are in capture.mjs BALLS.
export const BAG_ITEMS = {

	potion: { name: 'Potion', heal: 20 },
	superpotion: { name: 'Super Potion', heal: 60 },
	hyperpotion: { name: 'Hyper Potion', heal: 120 },
	maxpotion: { name: 'Max Potion', heal: 'full' },

	fullrestore: { name: 'Full Restore', heal: 'full', cure: 'all', confusion: true },

	antidote: { name: 'Antidote', cure: ['psn', 'tox'] },
	burnheal: { name: 'Burn Heal', cure: ['brn'] },
	iceheal: { name: 'Ice Heal', cure: ['frz'] },
	awakening: { name: 'Awakening', cure: ['slp'] },
	paralyzeheal: { name: 'Paralyze Heal', cure: ['par'] },
	fullheal: { name: 'Full Heal', cure: 'all', confusion: true },

	revive: { name: 'Revive', revive: 'half' },
	maxrevive: { name: 'Max Revive', revive: 'full' },

	// PP (Ether: one move 10, Max Ether: one move full, Elixir: all moves 10, Max Elixir: all moves full)
	ether: { name: 'Ether', pp: 10, oneMove: true },
	maxether: { name: 'Max Ether', pp: 'full', oneMove: true },
	elixir: { name: 'Elixir', pp: 10 },
	maxelixir: { name: 'Max Elixir', pp: 'full' },

	xattack: { name: 'X Attack', boost: 'atk' },
	xdefense: { name: 'X Defense', boost: 'def' },
	xspatk: { name: 'X Sp. Atk', boost: 'spa' },
	xspdef: { name: 'X Sp. Def', boost: 'spd' },
	xspeed: { name: 'X Speed', boost: 'spe' },
	xaccuracy: { name: 'X Accuracy', boost: 'accuracy' },

	direhit: { name: 'Dire Hit', crit: true },

	freshwater: { name: 'Fresh Water', heal: 30 },
	sodapop: { name: 'Soda Pop', heal: 50 },
	lemonade: { name: 'Lemonade', heal: 70 },
	moomoomilk: { name: 'Moomoo Milk', heal: 100 },
	sweetheart: { name: 'Sweet Heart', heal: 20 },
	energypowder: { name: 'Energy Powder', heal: 60 },
	energyroot: { name: 'Energy Root', heal: 120 },
	healpowder: { name: 'Heal Powder', cure: 'all', confusion: true },
	revivalherb: { name: 'Revival Herb', revive: 'full' },
	lavacookie: { name: 'Lava Cookie', cure: 'all', confusion: true },
	oldgateau: { name: 'Old Gateau', cure: 'all', confusion: true },
	casteliacone: { name: 'Casteliacone', cure: 'all', confusion: true },
	ragecandybar: { name: 'Rage Candy Bar', cure: 'all', confusion: true },
	lumiosegalette: { name: 'Lumiose Galette', cure: 'all', confusion: true },
	shaloursable: { name: 'Shalour Sable', cure: 'all', confusion: true },
	bigmalasada: { name: 'Big Malasada', cure: 'all', confusion: true },
	pewtercrunchies: { name: 'Pewter Crunchies', cure: 'all', confusion: true },
};

export const FIELD_ITEMS = {
	rarecandy: { name: 'Rare Candy' },
	everstone: { name: 'Everstone' },
};
const X_STAGES = 2;

export function isBall(id) {
	return Object.hasOwn(BALLS, id);
}

export function installBag(sim, battle, options = {}) {
	if (battle.storyBag) throw new Error('가방이 이미 설치됐습니다');
	const state = {
		options: { ...options, env: { ...options.env } },
		catchRates: options.catchRates?.byNum ?? options.catchRates ?? null,
		caught: new Set(options.caughtSpecies || []),
		pending: null,
		itemsUsed: [],
		captured: null,
	};
	battle.storyBag = state;
	battle.onEvent('StoryBag', battle.format, function () {
		const choice = state.pending;
		state.pending = null;
		if (!choice) throw new Error('가방 행동인데 선택이 없습니다');
		if (isBall(choice.item)) throwBall(sim, this, state, choice);
		else useItem(sim, this, state, choice);
	});
	return state;
}

export function bagResult(battle) {
	const state = battle.storyBag;
	if (!state) return {};
	return {
		itemsUsed: state.itemsUsed.map(u => ({ ...u })),
		captured: state.captured ? { ...state.captured } : null,
	};
}

const fail = (reason, detail) => ({ ok: false, reason, ...(detail ? { detail } : {}) });

// The Pokemon using a bag item: the one at choice.position (a double battle field position), else the side's lead
const userOf = (side, choice) => (Number.isInteger(choice?.position) ? side.active[choice.position] : leadOf(side));

// The wild Pokemon a ball can aim at: the only one left standing (with two out, the player can't aim)
const liveFoes = battle => battle.sides[1].active.filter(p => p && !p.fainted);

export function checkBagItem(battle, choice) {
	const state = battle.storyBag;
	if (!state) throw new Error('installBag 을 먼저 부르세요');
	if (battle.ended) return fail('ended');
	const side = battle.sides[0];
	if (side.requestState !== 'move' || side.choice.cantUndo) return fail('notyourturn');
	const user = userOf(side, choice);
	if (!user || user.fainted) return fail('notyourturn');

	if (user.getLockedMove()) return fail('locked');

	const id = toID(choice?.item);
	if (isBall(id)) return checkBall(battle, state, id);
	const item = BAG_ITEMS[id];
	if (!item) return fail('unknownitem', choice?.item);

	const target = side.pokemon.find(p => p.m.uid === choice.target);
	if (!target) return fail('notarget', choice.target);
	if (target.m.partner) return fail('partner');
	if (target.isActive && target.volatiles['embargo']) return fail('embargo');
	// A fainted Pokemon still holding its field position (a double battle with no one left to send out) stays there: reviving it would leave it on the field without acting
	if (item.revive) return !target.fainted ? fail('notfainted') : side.active.includes(target) ? fail('onfield') : { ok: true };
	if (item.pp) {

		const slots = ppSlots(target, item, choice.move);
		if (!slots) return fail('nomove', choice.move);
		return slots.some(s => s.pp < s.maxpp) ? { ok: true } : fail('noeffect');
	}
	if (target.fainted) return fail('fainted');
	if (item.boost || item.crit) {
		if (!target.isActive) return fail('notactive');
		if (item.crit) return target.volatiles['focusenergy'] || target.volatiles['dragoncheer'] ? fail('noeffect') : { ok: true };
		const stage = target.boosts[item.boost];
		const capped = target.hasAbility('contrary') ? stage <= -6 : stage >= 6;
		return capped ? fail('noeffect') : { ok: true };
	}
	return itemHasEffect(target, item) ? { ok: true } : fail('noeffect');
}

function itemHasEffect(target, item) {
	if (item.heal && target.hp < target.maxhp) return true;
	if (item.cure && target.status && (item.cure === 'all' || item.cure.includes(target.status))) return true;
	if (item.confusion && target.isActive && target.volatiles['confusion']) return true;
	return false;
}

function ppSlots(target, item, move) {
	if (!item.oneMove) return target.moveSlots;
	const slot = target.moveSlots.find(s => s.id === toID(move));
	return slot ? [slot] : null;
}

const realSpecies = pokemon => pokemon.battle.dex.species.get(pokemon.m.start.species);

function checkBall(battle, state, id) {
	const foes = liveFoes(battle), foe = foes[0];
	if (!foe) return fail('nofoe');
	if (!state.options.wild) return { ok: true };
	if (foes.length > 1) return fail('twofoes');

	if (foe.isSemiInvulnerable()) return fail('semiinvulnerable');
	if (!BALLS[id].master && !catchRateOf(state, realSpecies(foe))) return fail('norate', realSpecies(foe).name);
	return { ok: true };
}

function catchRateOf(state, species) {
	return state.catchRates?.[species.num] || 0;
}

// parts: in a double battle, every position's choice ('move N [target]', 'switch N', 'pass'); the item takes only choice.position's turn
export function chooseBagItem(battle, choice, parts = null) {
	const check = checkBagItem(battle, choice);
	if (!check.ok) return check;
	const position = Number.isInteger(choice.position) ? choice.position : null;
	battle.storyBag.pending = { item: toID(choice.item), target: choice.target ?? null, move: choice.move ? toID(choice.move) : null, ...(position !== null ? { position } : {}) };
	if (position !== null && parts) {
		if (!chooseSlotEvent(battle, battle.sides[0], position, 'StoryBag', parts)) { battle.storyBag.pending = null; return fail('otherchoice'); }
	} else chooseEventAction(battle, battle.sides[0], 'StoryBag');
	return { ok: true };
}

const isEnemyItem = item => !!item && !item.revive && !item.pp && !item.boost && !item.crit && !!(item.heal || item.cure);

export function checkEnemyItem(battle, choice) {
	if (battle.ended) return fail('ended');
	const side = battle.sides[1];
	if (side.requestState !== 'move' || side.choice.cantUndo) return fail('notyourturn');
	const user = side.active[0];
	if (!user || user.fainted) return fail('notyourturn');
	if (user.getLockedMove()) return fail('locked');
	const item = BAG_ITEMS[toID(choice?.item)];
	if (!isEnemyItem(item)) return fail('unknownitem', choice?.item);
	if (user.volatiles['embargo']) return fail('embargo');
	return itemHasEffect(user, item) ? { ok: true } : fail('noeffect');
}

// Sets the opponent's (p2) action this turn to a healing item use. The handler is attached on first use
export function chooseEnemyItem(battle, choice) {
	const check = checkEnemyItem(battle, choice);
	if (!check.ok) return check;
	if (!battle.storyEnemyItem) {
		const state = battle.storyEnemyItem = { pending: null };
		battle.onEvent('StoryEnemyItem', battle.format, function () {
			const picked = state.pending;
			state.pending = null;
			if (!picked) throw new Error('상대 도구 행동인데 선택이 없습니다');
			useItem(null, this, null, picked, this.sides[1]);
		});
	}
	const side = battle.sides[1];
	battle.storyEnemyItem.pending = { item: toID(choice.item), target: side.active[0].m.uid, move: null };
	chooseEventAction(battle, side, 'StoryEnemyItem');
	return { ok: true };
}

function itemEffect(item, id) {

	return { id, name: item.name, fullname: `item: ${item.name}`, effectType: 'Item', kind: 'Item', exists: true, num: 0, gen: 9, flags: {} };
}

function useItem(sim, battle, state, choice, side = battle.sides[0]) {
	const item = BAG_ITEMS[choice.item];
	const target = side.pokemon.find(p => p.m.uid === choice.target);
	if (!target || (target.fainted && !item.revive)) return;
	const effect = itemEffect(item, choice.item);
	const from = `[from] ${effect.fullname}`;
	battle.add('-story-item', target, target.m.uid, choice.item);

	if (item.revive) {

		revive(battle, target, item.revive === 'full' ? target.maxhp : Math.max(1, Math.floor(target.maxhp / 2)));
		battle.add('-heal', target, target.getHealth, from);
	}
	if (item.heal) {
		const amount = item.heal === 'full' ? target.maxhp : item.heal;
		if (target.heal(amount)) battle.add('-heal', target, target.getHealth, from);
	}
	if (item.cure && target.status && (item.cure === 'all' || item.cure.includes(target.status))) {
		battle.add('-curestatus', target, target.status, from);
		target.clearStatus();
	}
	if (item.confusion && target.isActive && target.volatiles['confusion']) target.removeVolatile('confusion');
	if (item.pp) {
		for (const slot of ppSlots(target, item, choice.move)) {
			if (slot.pp >= slot.maxpp) continue;
			slot.pp = item.pp === 'full' ? slot.maxpp : Math.min(slot.maxpp, slot.pp + item.pp);
			battle.add('-story-pp', target, target.m.uid, battle.dex.moves.get(slot.id).name, slot.pp, slot.maxpp);
		}
	}
	if (item.boost) battle.boost({ [item.boost]: X_STAGES }, target, target, effect);
	if (item.crit) target.addVolatile('focusenergy', target, effect);

	state?.itemsUsed.push({ turn: battle.turn, item: choice.item, target: choice.target, ...(choice.move && item.oneMove ? { move: choice.move } : {}) });
}

function throwBall(sim, battle, state, choice) {
	const foe = liveFoes(battle)[0] ?? battle.sides[1].active[0];
	const user = userOf(battle.sides[0], choice);
	if (!state.options.wild) {

		// Trainer battle: the opponent blocks the ball. The turn is used and the ball is not consumed
		battle.add('-story-ball', foe, foe.m.uid, choice.item, 0, 'blocked');
		return;
	}
	const ctx = ballContext(sim, battle, state, user, foe);
	const mod = ballModifier(choice.item, ctx);
	let roll;
	if (mod.master) {
		roll = { caught: true, shakes: 3, critical: false };
	} else {
		const values = captureValues({
			maxhp: foe.maxhp, hp: foe.hp, rate: catchRateOf(state, realSpecies(foe)), ballMod: mod.mod, rateAdd: mod.rateAdd,
			status: foe.status, level: foe.level, badgePenalty: state.options.badgePenalty ?? 1, bonusMisc: state.options.bonusMisc ?? 1,
		});
		roll = rollCapture(values, n => battle.random(n), state.options.critical || null);
	}

	const toBox = roll.caught && battle.sides[0].pokemon.length >= PARTY_MAX;
	battle.add('-story-ball', foe, foe.m.uid, choice.item, roll.shakes, roll.caught ? 'caught' : 'broke',
		...(roll.critical ? ['[critical]'] : []), ...(toBox ? ['[tobox]'] : []));
	state.itemsUsed.push({ turn: battle.turn, item: choice.item, target: foe.m.uid });
	if (!roll.caught) return;
	state.captured = {
		uid: foe.m.uid, species: realSpecies(foe).name, level: foe.level, ball: choice.item,
		turn: battle.turn, shakes: roll.shakes, critical: roll.critical, toBox,
	};

	awardCaptureExperience(battle, foe);
	battle.win(battle.sides[0]);
}

export function ballContext(sim, battle, state, user, foe) {
	const view = p => ({ species: p.species, level: p.level, gender: p.gender, status: p.status, types: p.getTypes() });
	const caught = state.caught.has(realSpecies(foe).id) || state.caught.has(toID(realSpecies(foe).baseSpecies));
	return { target: view(foe), user: view(user), turn: battle.turn, env: state.options.env, caught, dex: battle.dex };
}
