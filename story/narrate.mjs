import { toID } from '../engine/mon.mjs';

const USER = '{{user}}';

const SIDE = { p1: 'mine', p2: 'theirs' };

export function readLog(log, { from = 0, to = log?.length ?? 0 } = {}) {
  const mons = new Map();
  const turns = [{ turn: 0, events: [] }];
  const summary = { sent: { mine: [], theirs: [] }, fainted: [], winner: null, caught: null, ran: false, turns: 0 };
  const players = { mine: null, theirs: null };
  let split = 0;
  let recent = null, recentLive = false;
  let weather = null;
  const lines = log ?? [];
  const end = Math.min(to, lines.length);
  const who = ident => {
    const key = ident.replace(/^(p\d)[a-z]?:\s*/, '$1: ');
    if (!mons.has(key)) mons.set(key, { side: SIDE[key.slice(0, 2)], ident: key.slice(4), species: key.slice(4), hp: null, maxhp: null });
    return mons.get(key);
  };
  const ref = mon => ({ species: mon.species, nick: nickOf(mon), side: mon.side });
  const setHp = (mon, text) => {
    const [hp, maxhp] = String(text).split(' ')[0].split('/').map(Number);
    const before = mon.maxhp ? mon.hp / mon.maxhp : null;
    if (Number.isFinite(hp)) mon.hp = hp;
    if (Number.isFinite(maxhp)) mon.maxhp = maxhp;
    if (String(text).startsWith('0')) mon.hp = 0;
    return before;
  };
  const pct = mon => (mon.maxhp ? Math.round(mon.hp / mon.maxhp * 100) : 0);

  for (let i = 0; i < end; i++) {
    const line = lines[i];
    if (split === 1) { split = 0; continue; }
    if (split === 2) split = 1;
    const [, cmd, ...args] = line.split('|');
    if (cmd === 'split') { split = 2; continue; }
    const live = i >= from;

    const push = (event, mark = true) => {
      if (live) turns[turns.length - 1].events.push(event);
      if (mark) { recent = event; recentLive = live; }
    };

    const moveOf = () => {
      if (recent?.type !== 'move') return null;
      if (live && !recentLive) push({ ...recent, cont: true, effects: [] });
      return recent;
    };
    const silent = args.includes('[silent]');
    switch (cmd) {
    case 'player': if (SIDE[args[0]] && args[1]) players[SIDE[args[0]]] = args[1]; break;
    case 'turn': turns.push({ turn: Number(args[0]), events: [] }); summary.turns = Number(args[0]); recent = null; break;
    case 'switch': case 'drag': {
      const mon = who(args[0]);
      mon.species = args[1].split(',')[0];
      setHp(mon, args[2]);
      if (live && !summary.sent[mon.side].some(m => m.species === mon.species && m.nick === nickOf(mon))) summary.sent[mon.side].push(ref(mon));
      push({ type: 'switch', mon: ref(mon), hp: pct(mon) });
      break;
    }
    case 'move': {
      const mon = who(args[0]);
      const target = args[2] ? who(args[2]) : null;
      push({ type: 'move', mon: ref(mon), move: args[1], target: target && target !== mon ? ref(target) : null, miss: args.includes('[miss]'), effects: [] });
      break;
    }
    case '-damage': case '-heal': {
      const mon = who(args[0]);
      const before = setHp(mon, args[1]);
      const from = fromOf(args);
      const delta = before === null ? 0 : Math.round(mon.hp / mon.maxhp * 100 - before * 100);
      const prev = from ? null : moveOf();
      const entry = { mon: ref(mon), delta, before: before === null ? null : Math.round(before * 100), hp: pct(mon), from };
      if (prev) prev.effects.push({ kind: 'hp', ...entry });
      else push({ type: cmd === '-damage' ? 'damage' : 'heal', ...entry });
      break;
    }
    case '-supereffective': case '-resisted': case '-crit': case '-immune': case '-miss': {
      const prev = moveOf();
      const tag = { '-supereffective': 'super effective', '-resisted': 'not very effective', '-crit': 'critical hit', '-immune': 'no effect', '-miss': 'missed' }[cmd];
      if (prev) prev.effects.push({ kind: 'tag', tag, mon: args[0] ? ref(who(args[0])) : null });
      break;
    }
    case '-status': push({ type: 'status', mon: ref(who(args[0])), status: args[1] }); break;
    case 'faint': {
      const mon = who(args[0]);
      if (live) summary.fainted.push(ref(mon));
      push({ type: 'faint', mon: ref(mon) });
      break;
    }
    case '-story-ball': {
      const mon = who(args[0]);
      push({ type: 'ball', mon: ref(mon), ball: args[2], result: args[4] });
      if (live && args[4] === 'caught') summary.caught = { mon: ref(mon), ball: args[2] };
      break;
    }
    case '-story-item': push({ type: 'item', mon: ref(who(args[0])), item: args[2] }); break;
    case '-story-run': if (live && args[2] === 'escaped') summary.ran = true; push({ type: 'run', result: args[2] }); break;
    case '-story-levelup': push({ type: 'levelup', mon: ref(who(args[0])), level: Number(args[2]) }); break;
    case 'win': if (live) summary.winner = args[0]; break;

    case '-ability': if (!silent) push({ type: 'ability', mon: ref(who(args[0])), ability: args[1], from: fromOf(args) }, false); break;
    case '-item': if (!silent) push({ type: 'helditem', mon: ref(who(args[0])), item: args[1], from: fromOf(args) }, false); break;
    case '-enditem': {
      if (silent) break;
      const from = fromOf(args);
      const how = args.includes('[eat]') ? 'eat' : !from || from.name === 'gem' ? 'used' : 'lost';
      push({ type: 'enditem', mon: ref(who(args[0])), item: args[1], how, from: how === 'lost' && from.kind === 'moves' ? from : null }, false);
      break;
    }
    case '-weather': {

      if (args.includes('[upkeep]')) break;
      const now = args[0] === 'none' ? null : args[0];
      if (now === weather) break;
      const of = args.find(a => a.startsWith('[of]'))?.replace(/^\[of\]\s*/, '');
      push(now ? { type: 'weather', weather: now, from: fromOf(args), of: of ? ref(who(of)) : null } : { type: 'weather', weather: null, ended: weather }, false);
      weather = now;
      break;
    }
    case '-fieldstart': case '-fieldend': {
      if (silent) break;
      const name = String(args[0] ?? '').replace(/^move:\s*/, '');
      if (name) push({ type: 'field', field: name, ended: cmd === '-fieldend' }, false);
      break;
    }
    default: break;
    }
  }
  return { turns: turns.filter(t => t.events.length), summary, players };
}

// Nickname: when the log name differs from the species name (including the forme prefix)
const plain = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function nickOf(mon) {
  const name = plain(mon.ident), species = plain(mon.species), base = plain(String(mon.species).split('-')[0]);
  return name && name !== species && name !== base ? mon.ident : null;
}

function fromOf(args) {
  const raw = args.find(a => a.startsWith('[from]'));
  if (!raw) return null;
  const text = raw.replace(/^\[from\]\s*/, '');
  const m = /^(item|ability|move):\s*(.+)$/i.exec(text);
  if (m) return { kind: { item: 'items', ability: 'abilities', move: 'moves' }[m[1].toLowerCase()], name: m[2] };
  return { kind: null, name: text };
}

export const hasEvents = read => read.turns.some(t => t.events.length);

const STATUS_EN = { par: 'was paralyzed', brn: 'was burned', slp: 'fell asleep', frz: 'was frozen', psn: 'was poisoned', tox: 'was badly poisoned' };

// Weather: start and end sentences. Unknown weather by its name
const WEATHER_EN = {
  SunnyDay: ['The sunlight turned harsh', 'The harsh sunlight faded'],
  DesolateLand: ['The sunlight turned extremely harsh', 'The extremely harsh sunlight faded'],
  RainDance: ['It started to rain', 'The rain stopped'],
  PrimordialSea: ['A heavy rain began to fall', 'The heavy rain lifted'],
  Sandstorm: ['A sandstorm kicked up', 'The sandstorm subsided'],
  Hail: ['It started to hail', 'The hail stopped'],
  Snowscape: ['It started to snow', 'The snow stopped'],
  DeltaStream: ['Mysterious strong winds began to blow', 'The mysterious strong winds dissipated'],
};
const FROM_EN = { psn: 'poison', tox: 'poison', brn: 'burn', recoil: 'recoil', confusion: 'confusion' };

export function monText(mon, namer) {
  if (!mon) return 'Pokémon';
  if (!mon.nick) return namer.species(mon.species);
  return namer.seen('nick', mon.nick) ? mon.nick : `${mon.nick} the ${namer.species(mon.species)}`;
}

function fromText(from, namer) {
  if (!from) return '';
  if (from.kind) return ` from ${namer[from.kind](from.name)}`;
  return ` from ${FROM_EN[toID(from.name)] ?? from.name}`;
}

// HP before -> after: "Geodude HP 100% -> 0%" (only the after value if the before value is unknown)
const hpText = (name, x) => `${name} HP ${x.before === null || x.before === undefined ? '' : `${x.before}% → `}${x.hp}%`;

function sidesOf(read, sides = {}) {
  return { mine: USER, theirs: sides.theirs || read.players?.theirs || 'Opponent', wild: !!sides.wild,
    ally: sides.ally ? { name: sides.ally.name || 'Ally', species: new Set((sides.ally.team ?? []).map(m => toID(m.species))) } : null };
}

// A Pokemon on the player's side that the tag battle ally sent out (by species: the battle block's ally pokemon lines)
const isAlly = (mon, sides) => mon?.side === 'mine' && !!sides.ally?.species.has(toID(mon.species));

function sentOutText(side, mons, sides) {
  if (side === 'theirs' && sides.wild) return `Wild ${mons} appeared`;
  return `${side === 'theirs' ? sides.theirs : sides.mine} sent out ${mons}`;
}

function eventText(e, namer, sides) {
  const mon = m => monText(m, namer);
  switch (e.type) {
  case 'switch': return isAlly(e.mon, sides) ? `${sides.ally.name} sent out ${mon(e.mon)}` : sentOutText(e.mon.side, mon(e.mon), sides);
  case 'move': {

    const head = e.cont ? `${mon(e.mon)}'s ${namer.moves(e.move)}` : `${mon(e.mon)} used ${namer.moves(e.move)}`;
    if (e.miss) return `${head} → missed`;

    const parts = [
      ...e.effects.filter(x => x.kind === 'hp').map(x => hpText(mon(x.mon), x)),
      ...e.effects.filter(x => x.kind === 'tag').map(x => (x.tag === 'no effect' && x.mon ? `no effect on ${mon(x.mon)}` : x.tag)),
    ];
    return parts.length ? `${head} → ${parts.join(', ')}` : head;
  }
  case 'damage': case 'heal': return `${hpText(mon(e.mon), e)}${fromText(e.from, namer)}`;
  case 'status': return `${mon(e.mon)} ${STATUS_EN[e.status] ?? `got ${e.status}`}`;
  case 'faint': return `${mon(e.mon)} fainted`;
  case 'ball': return `${namer.items(e.ball)} thrown at ${mon(e.mon)} → ${e.result === 'caught' ? 'caught' : e.result === 'blocked' ? 'blocked' : 'broke free'}`;
  case 'item': return `${e.mon.side === 'theirs' ? sides.theirs : sides.mine} used ${namer.items(e.item)} on ${mon(e.mon)}`;
  case 'run': return e.result === 'escaped' ? 'Got away safely' : 'Could not get away';
  case 'levelup': return `${mon(e.mon)} grew to Lv${e.level}`;

  case 'ability': return `${mon(e.mon)}'s ${namer.abilities(e.ability)} activated${fromText(e.from, namer)}`;
  case 'helditem': return e.from?.kind === 'moves' ? `${mon(e.mon)} obtained ${namer.items(e.item)}${fromText(e.from, namer)}` : `${mon(e.mon)} is holding ${namer.items(e.item)}${fromText(e.from, namer)}`;
  case 'enditem':
    if (e.how === 'eat') return `${mon(e.mon)} ate its ${namer.items(e.item)}`;
    if (e.how === 'lost') return `${mon(e.mon)} lost its ${namer.items(e.item)}${fromText(e.from, namer)}`;
    return `${mon(e.mon)}'s ${namer.items(e.item)} was used up`;
  case 'weather':
    if (!e.weather) return WEATHER_EN[e.ended]?.[1] ?? 'The weather cleared';

    return `${WEATHER_EN[e.weather]?.[0] ?? `The weather became ${e.weather}`}${e.of && e.from?.kind ? ` from ${mon(e.of)}'s ${namer[e.from.kind](e.from.name)}` : fromText(e.from, namer)}`;
  case 'field': return `${namer.moves(e.field)} ${e.ended ? 'ended' : 'started'}`;
  default: return '';
  }
}

export function keyLines(read, namer, sides = {}) {
  const who = sidesOf(read, sides);
  const byTurn = new Map();
  for (const t of read.turns) {
    const turn = Math.max(1, t.turn);
    byTurn.set(turn, [...(byTurn.get(turn) ?? []), ...t.events]);
  }
  return [...byTurn].map(([turn, events]) => {
    const sentences = events.map(e => eventText(e, namer, who)).filter(Boolean);
    return `Turn ${turn}: ${sentences.join('. ')}${sentences.length ? '.' : ''}`;
  });
}

export function turnSpan(read) {
  const list = read.turns.map(t => Math.max(1, t.turn));
  return list.length ? { fromTurn: Math.min(...list), toTurn: Math.max(...list) } : null;
}

export function summaryLine(read, namer, { evolutions = [], sides = {} } = {}) {
  const s = read.summary;
  const who = sidesOf(read, sides);
  const list = mons => mons.map(m => monText(m, namer)).join(', ') || '-';
  const parts = [];
  for (const side of ['mine', 'theirs']) {
    const own = s.sent[side].filter(m => !isAlly(m, who)), ally = s.sent[side].filter(m => isAlly(m, who));
    if (own.length) parts.push(`${sentOutText(side, list(own), who)}.`);
    if (ally.length) parts.push(`${who.ally.name} sent out ${list(ally)}.`);
  }
  if (s.fainted.length) parts.push(`Fainted: ${list(s.fainted)}.`);
  if (s.caught) parts.push(`Caught: ${monText(s.caught.mon, namer)} with ${namer.items(s.caught.ball)}.`);
  else if (s.ran) parts.push('Ran away.');
  const evolved = evolutions.filter(e => e?.evolved === true);
  if (evolved.length) parts.push(`Evolved: ${evolved.map(e => `${namer.species(e.from)} → ${namer.species(e.to)}`).join(', ')}.`);
  return parts.join(' ');
}
