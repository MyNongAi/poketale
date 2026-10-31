export { PARTY_MAX, MAX_LEVEL, MAX_MOVES, MAX_IV } from '../engine/mon.mjs';

// EVs: 252 per stat, 510 total - same values as the battle (engine/rules.mjs)
export { EV_STAT_MAX, EV_TOTAL_MAX } from '../engine/rules.mjs';

export const OT_NAME_MAX = 24;

export const BOX_SIZE = 30;

export const BOX_NAME_MAX = 16;

export const PLAYER_NAME = 'Player';

// Battle styles of the settings: 'auto' follows the battle block, the others hold for every trainer battle
export const BATTLE_STYLES = ['auto', 'single', 'double'];
