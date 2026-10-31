import { chooseEventAction, findTrap, leadOf } from './showdown-compat.mjs';

export function installRun(sim, battle, options = {}) {
	if (battle.storyRun) throw new Error('도망가기가 이미 설치됐습니다');
	const state = { wild: !!options.wild, attempts: 0, pending: false, ran: false, forfeited: false };
	battle.storyRun = state;
	battle.onEvent('StoryRun', battle.format, function () {
		if (!state.pending) throw new Error('도망 행동인데 선택이 없습니다');
		state.pending = false;
		attemptRun(this, state);
	});
	return state;
}

export function runResult(battle) {
	const state = battle.storyRun;
	if (!state) return {};
	return { ran: state.ran, ...(state.ran ? { outcome: 'run', winner: null } : {}),
		...(state.forfeited ? { forfeited: true, outcome: 'forfeit', winner: 'p2' } : {}) };
}

const fail = (reason, extra) => ({ ok: false, reason, ...extra });

export function checkRun(battle) {
	const state = battle.storyRun;
	if (!state) throw new Error('installRun 을 먼저 부르세요');
	if (battle.ended) return fail('ended');
	const side = battle.sides[0];
	if (side.requestState !== 'move' || side.choice.cantUndo) return fail('notyourturn');
	const user = leadOf(side);
	if (!user || user.fainted) return fail('notyourturn');
	if (!state.wild) return fail('trainer');

	if (user.getLockedMove()) return fail('locked');
	if (escapeGuarantee(user)) return { ok: true };

	if (user.trapped) return fail('trapped', { trap: trapSource(battle, user) ?? { effect: 'other', id: '', name: '', source: null } });

	if (user.hasItem('shedshell')) {
		const trap = trapSource(battle, user);
		if (trap) return fail('trapped', { trap });
	}
	return { ok: true };
}

// Sets p1's action this turn to running. If blocked, changes nothing and returns { ok:false, reason }
export function chooseRun(battle) {
	const check = checkRun(battle);
	if (!check.ok) return check;
	battle.storyRun.pending = true;
	chooseEventAction(battle, battle.sides[0], 'StoryRun');
	return { ok: true };
}

export function checkForfeit(battle) {
	const state = battle.storyRun;
	if (!state) throw new Error('installRun 을 먼저 부르세요');
	if (battle.ended) return fail('ended');
	const side = battle.sides[0];
	if (side.requestState !== 'move' || side.choice.cantUndo) return fail('notyourturn');
	if (state.wild) return fail('wild');
	return { ok: true };
}

export function forfeit(battle) {
	const check = checkForfeit(battle);
	if (!check.ok) return check;
	const side = battle.sides[0];
	const user = leadOf(side);
	side.clearChoice();
	battle.storyRun.forfeited = true;
	battle.add('-story-forfeit', user ?? side.id, user?.m.uid ?? '');
	battle.lose(side);
	return { ok: true };
}

export function escapeGuarantee(pokemon) {
	if (pokemon.hasAbility('runaway')) return 'ability';
	if (pokemon.hasItem('smokeball')) return 'item';
	if (pokemon.hasType('Ghost')) return 'type';
	return null;
}

export function escapeOdds(playerSpeed, wildSpeed, attempts) {
	if (playerSpeed >= wildSpeed) return Infinity;

	return Math.floor(playerSpeed * 128 / wildSpeed) + 30 * attempts;
}

export const unmodifiedSpeed = pokemon => pokemon.getStat('spe', true, true);

function attemptRun(battle, state) {
	const user = leadOf(battle.sides[0]);

	// With two wild Pokemon out, the faster one decides the odds
	const foe = battle.sides[1].active.filter(p => p && !p.fainted).sort((a, b) => unmodifiedSpeed(b) - unmodifiedSpeed(a))[0];
	if (!user || user.fainted) return;
	const guarantee = escapeGuarantee(user);
	const from = guarantee === 'ability' ? ['[from] ability: Run Away'] : guarantee === 'item' ? ['[from] item: Smoke Ball'] : [];
	if (!guarantee) {

		const trap = trapSource(battle, user);
		if (trap) {
			battle.add('-story-run', user, user.m.uid, 'blocked', ...trapTags(trap));
			return;
		}
	}
	state.attempts++;
	let escaped = true;
	if (!guarantee && foe && !foe.fainted) {
		const odds = escapeOdds(unmodifiedSpeed(user), unmodifiedSpeed(foe), state.attempts);
		if (odds < 256) escaped = battle.random(256) < odds;
	}
	battle.add('-story-run', user, user.m.uid, escaped ? 'escaped' : 'failed', ...from);
	if (!escaped) return;
	state.ran = true;
	battle.tie();
}

function trapTags(trap) {
	const kind = trap.effect === 'ability' ? 'ability' : trap.effect === 'move' ? 'move' : null;
	return [...(kind ? [`[from] ${kind}: ${trap.name}`] : []), ...(trap.source ? [`[of] ${trap.source}`] : [])];
}

export function trapSource(battle, pokemon) {
	const found = findTrap(battle, pokemon);
	return found && describeTrap(battle, found.candidate, found.effect, pokemon);
}

function describeTrap(battle, candidate, effect, pokemon) {
	if (candidate.ability) return { effect: 'ability', id: effect.id, name: effect.name, source: candidate.holder };

	const move = battle.dex.moves.get(candidate.state?.sourceEffect?.id ?? candidate.id);
	const source = candidate.state?.source ?? candidate.holder ?? (candidate.id === 'ingrain' ? pokemon : null);
	if (move.exists) return { effect: 'move', id: move.id, name: move.name, source: source ?? null };
	return { effect: 'other', id: candidate.id, name: effect.name ?? candidate.id, source: source ?? null };
}
