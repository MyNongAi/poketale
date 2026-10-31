// from pokerogue locales/{ko,en}/*.json @ 7d7da4a8 (AGPL-3.0-only)
// Modified for PokeTale on 2026-10-30. See view/LICENSE-NOTE.md.

import { readFile, writeFile } from 'node:fs/promises';
import { LANGS } from '../director/lang.js';

const PR = new URL('../vendor/pokerogue/', import.meta.url);
const load = async path => JSON.parse(await readFile(new URL(path, PR), 'utf8'));

const keys = {

  battle: ['singleWildAppeared', 'pokemonCaught', 'pokemonBrokeFree', 'noPokeballTrainer', 'noPokeballForce', 'noPokeballMulti', 'regainHealth', 'ppHealBerry'],

  'party-ui-handler': ['anyEffect', 'hasEnergy'],
  'status-effect': ['poison.heal', 'toxic.heal', 'paralysis.heal', 'sleep.heal', 'freeze.heal', 'burn.heal'],
};
const counts = [];
for (const lang of LANGS) {
  const text = { _source: `from pokerogue locales/${lang} @ 7d7da4a8 (AGPL-3.0-only); locales @ 485b48eb` };
  for (const [file, selected] of Object.entries(keys)) {
    const source = await load(`locales/${lang}/${file}.json`);
    for (const key of selected) {
      const value = key.split('.').reduce((object, part) => object?.[part], source);
      if (typeof value !== 'string') throw new Error(`Missing locale key: ${lang}/${file}.${key}`);
      text[`${file}.${key}`] = value;
    }
  }
  await writeFile(new URL(`../director/text-bag-${lang}.json`, import.meta.url), JSON.stringify(text, null, 2) + '\n');
  counts.push(`${Object.keys(text).length - 1}개 -> director/text-bag-${lang}.json`);
}

const ITEM_FRAMES = {
  potion: 'potion', superpotion: 'super_potion', hyperpotion: 'hyper_potion', maxpotion: 'max_potion', fullrestore: 'full_restore',
  antidote: 'wl_antidote', burnheal: 'wl_burn_heal', iceheal: 'wl_ice_heal', awakening: 'wl_awakening', paralyzeheal: 'wl_paralyze_heal',
  fullheal: 'full_heal', revive: 'revive', maxrevive: 'max_revive',
  ether: 'ether', maxether: 'max_ether', elixir: 'elixir', maxelixir: 'max_elixir',
  xattack: 'x_attack', xdefense: 'x_defense', xspatk: 'x_sp_atk', xspdef: 'x_sp_def', xspeed: 'x_speed', xaccuracy: 'x_accuracy',
  direhit: 'dire_hit',

  freshwater: 'berry_juice_good', sodapop: 'berry_juice_good', lemonade: 'berry_juice_good', moomoomilk: 'berry_juice_good',
  sweetheart: 'love_sweet', energypowder: 'silver_powder', energyroot: 'big_root', healpowder: 'silver_powder', revivalherb: 'white_herb',
  lavacookie: 'old_gateau', oldgateau: 'old_gateau', casteliacone: 'old_gateau', ragecandybar: 'old_gateau', lumiosegalette: 'old_gateau', shaloursable: 'old_gateau',
  bigmalasada: 'old_gateau', pewtercrunchies: 'old_gateau',

  hpup: 'hp_up', protein: 'protein', iron: 'iron', calcium: 'calcium', zinc: 'zinc', carbos: 'carbos', ppup: 'pp_up', ppmax: 'pp_max',
  rarecandy: 'rare_candy', abilitycapsule: 'ability_capsule', luckyegg: 'lucky_egg', amuletcoin: 'amulet_coin', soothebell: 'soothe_bell',
  linkingcord: 'linking_cord', everstone: 'everstone', sacredash: 'sacred_ash',
  repel: 'repel', superrepel: 'super_repel', maxrepel: 'max_repel', nugget: 'nugget', bignugget: 'big_nugget', relicgold: 'relic_gold',
  bigmushroom: 'big_mushroom',
  teraorb: 'tera_orb', expshare: 'exp_share',

  lonelymint: 'mint_atk', adamantmint: 'mint_atk', naughtymint: 'mint_atk', bravemint: 'mint_atk',
  boldmint: 'mint_def', impishmint: 'mint_def', laxmint: 'mint_def', relaxedmint: 'mint_def',
  modestmint: 'mint_spatk', mildmint: 'mint_spatk', rashmint: 'mint_spatk', quietmint: 'mint_spatk',
  calmmint: 'mint_spdef', gentlemint: 'mint_spdef', carefulmint: 'mint_spdef', sassymint: 'mint_spdef',
  timidmint: 'mint_spd', hastymint: 'mint_spd', jollymint: 'mint_spd', naivemint: 'mint_spd', seriousmint: 'mint_neutral',

  // TMs: one per move type (the panel looks up tm_<type> by the move's type)
  ...Object.fromEntries(['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock',
    'ghost', 'dragon', 'dark', 'steel', 'fairy'].map(type => [`tm_${type}`, `tm_${type}`])),
};
const items = await load('assets/images/items.json');
const byName = new Map(items.textures[0].frames.map(f => [f.filename, f]));
const frames = {};
for (const [id, name] of Object.entries(ITEM_FRAMES)) {
  const f = byName.get(name);
  if (!f) throw new Error(`items.json 에 프레임이 없습니다: ${name}`);
  frames[id] = { ...f, filename: id };
}
const atlas = (image, size, list) => ({ textures: [{ image, format: 'RGBA8888', size, scale: 1, frames: list }] });
const particles = await load('assets/images/effects/pb_particles.json');
const out = {
  _source: 'from pokerogue assets/images/items.json, effects/pb_particles.json @ 37789817 (tools/build-bag-data.mjs)',
  items: atlas('items.png', items.textures[0].size, Object.values(frames)),
  pb_particles: particles,
};
await writeFile(new URL('../data/bag-icons.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`가방 문구 ${counts.join(', ')}, 도구 아이콘 ${Object.keys(frames).length}개 -> data/bag-icons.json`);
