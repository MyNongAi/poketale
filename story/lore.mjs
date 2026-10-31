import { hashKey } from './blocks.mjs';
import { hpPercentOf, trainersOf } from './state.mjs';
import { createNamer } from './ai-names.mjs';
import { outcomeText } from './prompts.mjs';
import { COMPAT_VAR } from './compat.mjs';
import { customText } from './custom-items.mjs';
import { battleStatusLines, ACT_RULES, ACT_PROMPT } from './act-prompts.mjs';

export const BATTLE_ENTRY = `@@depth 0

## Battle Block
Battles are played out separately from the story. Whenever a battle is about to begin, such as a Trainer challenging {{user}} or a wild Pokémon attacking, output exactly one Battle Block at the end of that response, even if no Pokémon has been sent out yet. The response can end at that moment.

### Format
\`\`\`
<pkb-battle>
opponent: wild|trainer
name: name
gender: male|female
look: boy|girl|young man|young woman|middle-aged man|middle-aged woman|old man|old woman
class: class
rank: normal|boss
place: place
time: day|night
format: single|double
pokemon: Species Lv{n} | field value | …
ally: name
ally pokemon: Species Lv{n} | field value | …
</pkb-battle>
\`\`\`

### Field Descriptions
- name, gender, look, class: Trainer only. name includes the title, in the story's language (e.g., Gym Leader Brock); look is the trainer's apparent age; class is the trainer class (e.g., gym leader, rival, hiker).
- Give every Trainer a personal name, even minor ones (e.g., Bug Catcher Tim).
- rank: boss for Gym Leaders, Elite Four members, Champions, and other climactic battles; otherwise normal.
- place: One of: town, plains, grass, tall grass, metropolis, forest, sea, swamp, beach, lake, seabed, mountain, badlands, cave, desert, ice cave, meadow, power plant, volcano, graveyard, dojo, factory, ruins, wasteland, abyss, space, construction site, jungle, fairy cave, temple, slum, snowy forest, island, laboratory.
- format: Trainer only. double when the battle is a Double Battle, where each side has two Pokémon out at once (e.g., a Double Battle challenge, twins, or two opposing Trainers teaming up); otherwise single, or leave it out.
- pokemon: One line per Pokémon in sending-out order; 1 for a wild Pokémon (2 when two wild Pokémon attack together), up to 6 for a Trainer. Species and level are required. Optional fields: ability, moves, item, nature, gender, shiny, tera, nickname (in the story's language), hp (e.g., 60%), status (par, brn, slp, frz, psn, tox). Anything left out is filled in automatically.
- Two opposing Trainers battling together: put both names in name (e.g., Twins Amy & May) and list all their Pokémon as pokemon lines.
- ally, ally pokemon: Trainer battles only, when another Trainer fights on {{user}}'s side (a Tag Battle). ally is that Trainer's name; each ally pokemon line is one of the ally's Pokémon, with the same fields as pokemon. A Tag Battle is a Double Battle: {{user}} and the ally each send out one Pokémon. Never list {{user}}'s own Pokémon.
- Use official English names for species, moves, items, abilities, and natures.

### Battle Results
- A [Battle Result | …] line is the outcome of the battle. Continue the story from it.
- If the story ends a battle before it finishes, output <pkb-end>result: win|loss|stopped</pkb-end> at the end of the response.

### Example
\`\`\`
<pkb-battle>
opponent: trainer
name: Hiker Jun
gender: male
look: middle-aged man
class: hiker
rank: normal
place: mountain
time: day
pokemon: Geodude Lv12
pokemon: Onix Lv14 | moves Tackle, Rock Tomb | item Hard Stone
</pkb-battle>
\`\`\`
A Tag Battle with an ally against two Trainers:
\`\`\`
<pkb-battle>
opponent: trainer
name: Grunts Ken & Jo
gender: male
look: young man
class: team grunt
rank: normal
place: forest
time: night
format: double
pokemon: Zubat Lv11
pokemon: Koffing Lv12
ally: Ranger Mia
ally pokemon: Pikachu Lv12 | moves Thunder Shock, Quick Attack
</pkb-battle>
\`\`\``;

export const CHANGE_ENTRY = `@@depth 0

## Pokémon Changes
{{user}}'s Pokémon, storage, and bag are tracked automatically and shown below. When the story changes them outside battle, output one Change Block at the end of the response.

### Current Party
{{getvar::pkb_party}}

### Current Storage
{{getvar::pkb_storage}}

### Current Bag
{{getvar::pkb_bag}}

### Format
\`\`\`
<pkb-change>
add: Species Lv{n} | nickname name | box | ot name
level: #N +{levels}
heal: all | #N | #N 50% | #N status | #N revive
item: Item +{n} | Item -{n}
release: #N
deposit: #N
withdraw: box N
nickname: #N name
hold: #N Item | #N none
evolve: #N Species
teach: #N Move | #N Move forget Move
</pkb-change>
\`\`\`

### Field Descriptions
- Output only the lines that apply, one change per line.
- #N is the number in Current Party; box N is the number in Current Storage.
- HP is a percentage of max HP; 0% means fainted. Status is Normal, Paralyzed, Burned, Asleep, Frozen, Poisoned, Badly Poisoned, or Fainted.
- add: A new Pokémon joins {{user}}; it goes to storage when the party is full or with box. Its ability, moves, and other details are filled in automatically.
  ot is the original trainer's name, only when {{user}} receives a Pokémon someone else raised (e.g., a trade).
- heal: Restores HP fully or by a percentage, cures status only, or revives a fainted Pokémon (e.g., a Pokémon Center visit → heal: all).
- teach: Adds a move; with forget, it replaces that move. Without forget, {{user}} chooses later which move to forget.
- Use official English names for species, moves, and items. Write nicknames in the story's language.
- Changes listed in <pkb-log> are already applied, including any that {{user}}'s message also describes.
- Do not output a Change Block while a battle is in progress.

### Example
After a time skip with level gains and a capture:
\`\`\`
<pkb-change>
level: #1 +3
add: Pidgey Lv7
</pkb-change>
\`\`\``;

// One "### name" section of an entry text, heading included, up to the next "### " heading
const section = (text, name) => {
  const start = text.indexOf(`### ${name}\n`);
  const next = text.indexOf('\n### ', start + 1);
  return text.slice(start, next < 0 ? undefined : next).trim();
};

export const BATTLE_BLOCK_PART = ['Format', 'Field Descriptions', 'Example'].map(name => section(BATTLE_ENTRY, name)).join('\n\n');

const PREFIX = '포켓몬 배틀 · ';
const TRAINER_PREFIX = `${PREFIX}지난 배틀 · `;
const comment = (name, content) => `${PREFIX}${name} (판 ${hashKey(content).slice(0, 6)})`;

const LORE_INSERT_ORDER = 935;
export const LORE_ENTRIES = [
  { name: '배틀 블록', content: BATTLE_ENTRY },
  { name: '포켓몬 변경', content: CHANGE_ENTRY },
].map(e => ({ ...e, comment: comment(e.name, e.content) }));

const isOurs = entry => typeof entry?.comment === 'string' && entry.comment.startsWith(PREFIX);
const isTrainer = entry => isOurs(entry) && entry.comment.startsWith(TRAINER_PREFIX);
const isFixed = entry => isOurs(entry) && !isTrainer(entry);

const newUuid = () => globalThis.crypto.randomUUID();

export function setLore(chat, on, { newId = newUuid } = {}) {
  if (loreInLine(chat, on)) return false;
  const before = chat.localLore ?? [];
  chat.localLore = on ? [...before.filter(entry => !isFixed(entry)), ...LORE_ENTRIES.map((e, i) => ({ key: '', secondkey: '', insertorder: LORE_INSERT_ORDER - i, comment: e.comment, mode: 'normal',
    alwaysActive: true, selective: false, useRegex: false, id: newId(), content: e.content }))] : before.filter(entry => !isOurs(entry));

  // Compatibility-mode marker: entries wrapped in the bot card (story/compat.mjs) are dropped in this chat
  chat.scriptstate ??= {};
  if (on) chat.scriptstate[COMPAT_KEY] = '1';
  else { delete chat.scriptstate[COMPAT_KEY]; writeVars(chat, null); }
  return true;
}
const COMPAT_KEY = `$${COMPAT_VAR}`;
const compatOn = chat => chat?.scriptstate?.[COMPAT_KEY] === '1';
export const hasLore = chat => (chat?.localLore ?? []).some(isOurs);

export const loreInLine = (chat, on) => (on ? loreUpToDate(chat)
  : !hasLore(chat) && !(COMPAT_KEY in (chat?.scriptstate ?? {})) && !Object.values(VARS).some(name => name in (chat?.scriptstate ?? {})));

export function loreUpToDate(chat) {
  const ours = (chat?.localLore ?? []).filter(isFixed);
  return compatOn(chat) && ours.length === LORE_ENTRIES.length && LORE_ENTRIES.every((e, i) => ours[i]?.comment === e.comment && ours[i]?.content === e.content && ours[i]?.insertorder === LORE_INSERT_ORDER - i);
}

export function pastBattleLine(trainer, { lang = 'ko', en = null } = {}) {
  const namer = createNamer({ lang, en });
  const team = trainer.team.map(mon => `${namer.species(mon.species)} Lv${mon.level}`).join(', ');
  return `[Last Battle | Opponent: ${trainer.name} | Outcome: ${outcomeText(trainer.outcome)} | Team: ${team}]`;
}

// The lorebook key field is split by commas - commas inside a name become spaces
const loreKey = name => name.replaceAll(',', ' ').replace(/\s+/g, ' ').trim();

export function trainerLore(state, { lang = 'ko', en = null } = {}) {
  return Object.values(trainersOf(state)).map(trainer => {
    const content = pastBattleLine(trainer, { lang, en });
    return { key: [...new Set([trainer.personal, trainer.name].map(loreKey))].join(','), secondkey: '', insertorder: LORE_INSERT_ORDER - LORE_ENTRIES.length,
      comment: comment(`지난 배틀 · ${trainer.name}`, content), mode: 'normal', alwaysActive: false, selective: false, useRegex: false, content };
  });
}

export function writeTrainerLore(chat, entries, { newId = newUuid } = {}) {
  const before = chat.localLore ?? [];
  const now = before.filter(isTrainer);
  const want = entries ?? [];
  const same = now.length === want.length && want.every((e, i) => ['key', 'comment', 'content', 'insertorder'].every(k => now[i][k] === e[k]));
  if (same) return false;
  chat.localLore = [...before.filter(entry => !isTrainer(entry)), ...want.map(e => ({ ...e, id: newId() }))];
  return true;
}

export const VARS = { party: '$pkb_party', storage: '$pkb_storage', bag: '$pkb_bag' };
const STATUS_EN = { '': 'Normal', par: 'Paralyzed', brn: 'Burned', slp: 'Asleep', frz: 'Frozen', psn: 'Poisoned', tox: 'Badly Poisoned', fnt: 'Fainted' };

export function varTexts(state, { sim, battle = null, lang = 'ko', en = null } = {}) {
  const namer = createNamer({ lang, en });
  const item = id => customText(state, id) ?? namer.items(id);
  const party = [];
  if (battle) {
    const opponent = battle.wild ? `Wild ${namer.species(battle.species)}${battle.level ? ` Lv${battle.level}` : ''}` : battle.opponent || 'Trainer';
    if (battle.pending) party.push(`[Battle Pending | Opponent: ${opponent}]`);
    else {
      party.push(`[Battle In Progress | Opponent: ${opponent}${Number.isInteger(battle.turn) && battle.turn > 0 ? ` | Turn: ${battle.turn}` : ''}]`);

      if (battle.status && ACT_PROMPT) party.push(...battleStatusLines(battle.status, namer), ACT_RULES);
    }
  }
  (state?.party ?? []).forEach((mon, i) => {
    const hp = sim ? hpPercentOf(sim, mon) : mon.hp === 0 ? 0 : 100;
    const status = hp === 0 ? 'Fainted' : STATUS_EN[mon.status || ''] ?? 'Normal';
    const fields = [`Own Pokémon ${i + 1}`, `Species: ${namer.species(mon.set.species)}`];
    if (mon.set.name) fields.push(`Nickname: ${mon.set.name}`);
    fields.push(`Level: ${mon.set.level}`, `HP: ${hp}%`, `Status: ${status}`);
    if (mon.set.ability) fields.push(`Ability: ${namer.abilities(mon.set.ability)}`);
    fields.push(`Item: ${mon.set.item ? item(mon.set.item) : 'None'}`);
    fields.push(`Moves: ${(mon.set.moves ?? []).map(m => namer.moves(m)).join(', ') || 'None'}`);
    party.push(`[${fields.join(' | ')}]`);
  });
  if (!(state?.party ?? []).length) party.push('[Own Pokémon | None]');
  const storage = (state?.box ?? []).map((mon, i) => `${i + 1}: ${mon.set.name ? `${mon.set.name} the ` : ''}${namer.species(mon.set.species)}`);
  const items = Object.entries(state?.bag ?? {}).filter(([, n]) => n > 0).map(([id, n]) => `${item(id)} ×${n}`);
  return {
    party: party.join('\n'),
    storage: `[Storage | ${storage.length ? storage.join(' | ') : 'Empty'}]`,
    bag: `[Bag | ${items.length ? items.join(' | ') : 'Empty'}]`,
  };
}

export function writeVars(chat, texts) {
  chat.scriptstate ??= {};
  let changed = false;
  for (const [k, name] of Object.entries(VARS)) {
    const value = texts ? texts[k] : undefined;
    if (value === undefined) { if (name in chat.scriptstate) { delete chat.scriptstate[name]; changed = true; } continue; }
    if (chat.scriptstate[name] !== value) { chat.scriptstate[name] = value; changed = true; }
  }
  return changed;
}
