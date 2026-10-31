import { createNamer } from './ai-names.mjs';

// Why the battle could not take a command (director/plan.js reasons) - after "But it failed!"
const WHY = {
  noMove: (c, n) => `${n.moves(c.move ?? '') || c.raw || 'that move'} is not one of its moves`,
  noPp: (c, n) => `${n.moves(c.move)} has no PP left`,
  disabled: (c, n) => `${n.moves(c.move)} can't be used right now`,
  noSwitch: () => 'no such Pokémon can come in',
  trapped: () => "it can't be switched out",
  noItem: (c, n) => `there is no ${c.item ? n.items(c.item) : 'such item'} in the bag`,
  cantUse: (c, n) => `${n.items(c.item)} would have no effect`,
  cantRun: () => "there's no running from this battle",
  double: () => 'a Double Battle is commanded on the battle screen',
};

function commandText(c, n) {
  if (c.kind === 'move') return `${c.move ? n.moves(c.move) : c.raw ?? 'a move'}${c.gimmick === 'tera' ? ' (Terastallize)' : c.gimmick === 'mega' ? ' (Mega Evolve)' : ''}`;
  if (c.kind === 'switch') return `switch to ${c.target?.slot ? `party #${c.target.slot}` : c.target?.species ? n.species(c.target.species) : c.target?.name}`;
  if (c.kind === 'item') return `use ${c.item ? n.items(c.item) : 'an item'}`;
  return 'run';
}

export function failedLines(rows, { lang = 'ko', en = null } = {}) {
  const n = createNamer({ lang, en });
  return rows.flatMap(row => row.turns.map((result, i) => ({ result, command: row.block.turns[i]?.me }))
    .filter(({ result, command }) => result.state === 'rejected' && command)
    .map(({ result, command }) => `Command: ${commandText(command, n)}. But it failed! (${(WHY[result.reason] ?? (() => 'the battle could not take it'))(command, n)})`));
}

export const failedOoc = lines => `(OOC: No battle turn was played.\n${lines.join('\n')}\nNarrate only that the command didn't go through, and stop there.)`;

const STATUS = { '': '', par: ' par', brn: ' brn', slp: ' slp', frz: ' frz', psn: ' psn', tox: ' tox', fnt: ' fainted' };
const hpOf = mon => (mon.maxhp ? Math.max(mon.hp > 0 ? 1 : 0, Math.round(mon.hp / mon.maxhp * 100)) : 0);
const monText = (mon, n) => `${n.species(mon.species)}${mon.name && mon.name !== mon.species ? ` "${mon.name}"` : ''} Lv${mon.level} HP ${hpOf(mon)}%${STATUS[mon.status] ?? ''}`;

export function battleStatusLines(result, n) {
  const [mine, theirs] = ['p1', 'p2'].map(id => result?.sides?.find(side => side.id === id));
  if (!mine || !theirs) return [];
  const out = [];
  const me = mine.team.find(m => m.active), foe = theirs.team.find(m => m.active);
  if (me) out.push(`[Me: ${monText(me, n)} | ${me.moves.map(m => `${n.moves(m.id)} (${m.pp}/${m.maxpp})`).join(', ')}]`);
  if (foe) out.push(`[Foe: ${monText(foe, n)} | ${foe.moves.map(m => n.moves(m.id)).join(', ')}]`);
  const bench = side => side.team.filter(m => !m.active).map(m => monText(m, n)).join(', ');
  if (mine.team.length > 1) out.push(`[My bench: ${bench(mine)}]`);
  if (theirs.team.length > 1) out.push(`[Foe bench: ${bench(theirs)}]`);
  return out;
}

export const answeredLine = played => (played
  ? 'The command in this message has already been played above, so no <pkb-act> block is needed. Narrate the battle up to its result and no further.'
  : 'The command in this message is played out separately, so no <pkb-act> block is needed. Narrate the battle up to the command being given and no further.');

export const ACT_PROMPT = true;

export const ACT_RULES = `- While a battle is in progress, the user's words in battle are commands - attempts, not results. When the user gives a command, end the response with:
<pkb-act>
turn: me <move> | foe <move>
</pkb-act>
  One line per turn. Each turn has one action for each side, even when the user asks for the same move twice. "me" is required; leave "foe" out to let the opponent decide.
  Actions: a move (its official English name, from the [Me] line), "switch <Pokémon>", "item <item>", "run". The foe uses only its own moves (the [Foe] line).
  Write only the command (e.g. Pikachu is told to use Thunderbolt) - never its result (damage, hits, fainting). The next battle log tells you what happened.
  Write the block only when the user gave a command.`;

export function auxRequest({ status, recent, input }) {
  const history = recent.map(m => `${m.role === 'user' ? 'User' : 'Story'}: ${m.text}`).join('\n\n');
  return [
    { role: 'system', content: 'You turn a user\'s words in a Pokémon battle story into battle commands. You never write story.' },
    { role: 'user', content: `Battle now:\n${status.join('\n')}\n\nRecent story:\n${history || '(none)'}\n\nThe user now writes:\n${input}\n\n`
      + 'If the user gives a command to their Pokémon, answer with only this block, one line per turn (a move by its official English name from the [Me] line, "switch <Pokémon>", "item <item>" or "run"):\n'
      + '<pkb-act>\nturn: me <action>\n</pkb-act>\nIf the user gives no command, or you cannot tell which move they mean, answer with only: none' },
  ];
}
