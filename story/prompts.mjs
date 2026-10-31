import { createNamer } from './ai-names.mjs';
import { outcomeOf } from './outcome.mjs';
import { STATS } from '../engine/mon.mjs';
import { keyLines, summaryLine, turnSpan } from './narrate.mjs';
import { customText } from './custom-items.mjs';

export const OUTCOME_EN = { win: 'Win', lose: 'Loss', forfeit: 'Forfeit (loss)', run: 'Ran away', capture: 'Caught', stop: 'Stopped' };

export const outcomeText = outcome => OUTCOME_EN[outcome] ?? outcome;

const speciesOf = battle => battle?.team?.[0]?.species ?? 'Pokémon';
const trainerOf = battle => battle?.name || battle?.trainerClass || 'Trainer';

// Wild opponents as the story names them: one, or two in a wild double battle
const wildText = (battle, namer, { level = false, article = '' } = {}) => (battle?.team?.length ? battle.team : [{ species: speciesOf(battle) }]).slice(0, 2)
  .map(mon => `${article}${article ? 'wild' : 'Wild'} ${namer.species(mon.species)}${level && mon.level ? ` Lv${mon.level}` : ''}`).join(' & ');

export function resultLine({ outcome, battle, caught = null, evolutions = [], lang = 'ko', en = null }) {
  const namer = createNamer({ lang, en });
  const opponent = battle?.wild ? wildText(battle, namer, { level: true }) : trainerOf(battle);
  const parts = [`Opponent: ${opponent}`, `Outcome: ${outcomeText(outcome)}`];
  if (caught?.species) parts.push(`Caught: ${namer.species(caught.species)} → ${caught.storage ? 'Storage' : 'Party'}`);
  const evolved = (evolutions ?? []).filter(e => e?.evolved === true);
  if (evolved.length) parts.push(`Evolved: ${evolved.map(e => `${namer.species(e.from)} → ${namer.species(e.to)}`).join(', ')}`);
  return `[Battle Result | ${parts.join(' | ')}]`;
}

export const RESULT_LINE_RE = /\[Battle (?:Result \||result:)[^\]\n]*\]/;

const turnsText = span => (span.fromTurn === span.toTurn ? `turn ${span.fromTurn}` : `turns ${span.fromTurn}–${span.toTurn}`);

export function storyOoc(format, { battle, result = null, ended = false, first = true, read, screen = [], lang = 'ko', en = null }) {
  const namer = createNamer({ lang, en });
  const opponent = battle?.wild ? wildText(battle, namer, { article: 'the ' }) : trainerOf(battle);
  const summary = format === 'summary';
  const span = turnSpan(read);
  const outcome = ended ? ` Result: ${outcomeText(outcomeOf(result))}.` : '';
  const sides = { theirs: trainerOf(battle), wild: !!battle?.wild, ...(battle?.ally ? { ally: battle.ally } : {}) };
  const below = summary ? '' : ' below';
  const facts = (summary ? '. Fill in the details yourself, keeping to these facts' : ', keeping to the facts')
    + (ended ? '.' : ", and stop there. The battle isn't over yet.");
  const resume = 'Continue from your last narration';
  let head;
  if (ended && first) head = `Narrate the battle against ${opponent}${below} as story${facts}${outcome}`;
  else if (ended) {
    head = span
      ? `${resume}: narrate ${turnsText(span)} of the battle against ${opponent}${below}${facts}${outcome}`
      : `${resume} and narrate how the battle against ${opponent} ends.${outcome}`;
  } else {
    const what = span ? turnsText(span) : 'the battle so far';
    const narrate = first ? `Narrate ${what}${below} as story` : `${resume}: narrate ${what}${below}`;
    head = `The battle against ${opponent} is still going on. ${narrate}${facts}`;
  }
  const body = summary ? summaryLine(read, namer, { evolutions: ended ? result?.evolutions : [], sides })
    : format === 'log' ? (screen ?? []).join('\n') : keyLines(read, namer, sides).join('\n');
  return body ? `(OOC: ${head}\n${body})` : `(OOC: ${head})`;
}

// My side's name: inserted literally (the host replaces it with the persona name when sending to the AI)
export const USER = '{{user}}';

const STAT_EN = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const signed = n => `${n > 0 ? '+' : ''}${n}`;

export function logLine(event, namer = createNamer({ lang: 'en' })) {
  const monEn = w => (w?.name ? w.name : w?.species ? namer.species(w.species) : w?.ref ?? 'Pokémon');

  const itemEn = id => customText(event, id) ?? namer.items(id);
  const effectEn = e => {
    if (e.kind === 'heal') {
      if (e.revivedAll) return 'revived all fainted';
      if (e.revived) return 'revived';
      if (e.cured) return 'status healed';
      if (e.hpFrom != null && e.hpTo != null && e.hpFrom !== e.hpTo) return `HP ${e.hpFrom}% → ${e.hpTo}%`;
      return '';
    }
    if (e.kind === 'level') return `Lv${e.from} → ${e.to}`;
    if (e.kind === 'evolve') return `evolved into ${namer.species(e.species)}`;
    if (e.kind === 'teach') return `learned ${namer.moves(e.move)}`;

    // Out-of-battle items
    if (e.kind === 'evs') return `${STAT_EN[e.stat] ?? e.stat} EVs +${e.to - e.from}`;
    if (e.kind === 'exp') return `+${e.amount} EXP${e.to > e.from ? `, Lv${e.from} → ${e.to}` : ''}`;
    if (e.kind === 'ability') return `ability ${namer.abilities(e.from)} → ${namer.abilities(e.to)}`;
    if (e.kind === 'nature') return `stats now grow as ${e.nature} nature`;
    if (e.kind === 'hypertrain') return `hyper trained ${(e.stats ?? []).length === STATS.length ? 'all stats' : (e.stats ?? []).map(s => STAT_EN[s] ?? s).join('/')}`;
    if (e.kind === 'ppup') return `${namer.moves(e.move)} max PP ${e.from ?? '?'} → ${e.to ?? '?'}`;
    return '';
  };
  switch (event?.kind) {
    case 'use': {
      const item = namer.items(event.item);
      const who = event.who ? ` on ${monEn(event.who)}` : '';
      const effect = (event.effects ?? []).map(effectEn).filter(Boolean).join(', ');
      return `${USER} used ${item}${who}${effect ? `: ${effect}` : ''}`;
    }
    case 'swap': {
      const [a, b] = event.at ?? [];
      if (a?.party && b?.party) return `${USER} swapped party #${a.party} and #${b.party}`;
      return `${USER} swapped ${monEn(event.a)} ${a?.party ? '(party)' : '(box)'} with ${monEn(event.b)} ${b?.party ? '(party)' : '(box)'}`;
    }
    case 'hold': return event.item ? `${USER} gave ${itemEn(event.item)} to ${monEn(event.who)}` : `${USER} took ${itemEn(event.prev)} from ${monEn(event.who)}`;
    case 'deposit': return `${USER} moved ${monEn(event.who)} to the box`;
    case 'withdraw': return `${USER} moved ${monEn(event.who)} to the party`;
    case 'release': return `${USER} released ${monEn(event.who)}`;
    case 'nickname': return `${USER} nicknamed ${event.who?.species ? namer.species(event.who.species) : monEn(event.who)} "${event.name}"`;
    case 'teach': {
      const who = monEn(event.who), move = namer.moves(event.move);
      if (event.forget) return `${who} learned ${move} (forgot ${namer.moves(event.forget)})`;
      return event.learned ? `${who} learned ${move}` : `${who} can learn ${move}`;
    }
    case 'evolve': return `${monEn(event.who)} evolved into ${namer.species(event.species)}`;
    case 'level': return `${monEn(event.who)} Lv${event.from ?? '?'} → ${event.to ?? '?'}`;
    case 'heal': {
      if (event.all) return event.revivedAll ? 'All fainted Pokémon revived' : 'Party healed';
      const effect = effectEn(event);
      return `${monEn(event.who)} healed${effect ? `: ${effect}` : ''}`;
    }
    case 'evs': case 'exp': case 'ability': case 'nature': case 'hypertrain': case 'ppup': return `${monEn(event.who)}: ${effectEn(event)}`;
    case 'item': return `${itemEn(event.item)} ${signed(event.delta)}`;
    case 'add': return `${USER} got ${namer.species(event.who?.species)} Lv${event.level}${event.box ? ', sent to storage' : ''}`;
    default: return null;
  }
}

export function pkbLog(events, { lang = 'ko', en = null } = {}) {
  const namer = createNamer({ lang, en });
  const parts = (events ?? []).map(e => logLine(e, namer)).filter(Boolean);
  if (!parts.length) return '';
  return `<pkb-log>${parts.join('. ')}.</pkb-log>`;
}
