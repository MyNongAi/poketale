import { esc, FONT, noteRule } from './card.mjs';
import { say } from './screen-text.mjs';
import { checkLang } from '../director/lang.js';
import { STATS } from '../engine/mon.mjs';
import { BOX_SIZE } from './rules.mjs';
import storyNames from '../data/story-names.json' with { type: 'json' };
import { customText } from './custom-items.mjs';

const LETTER_BATCHIM = { L: 'l', R: 'l', M: true, N: true };
function batchim(word) {
  const text = String(word ?? '').trim().replace(/[)\]"'’”」』>]+$/u, '');
  const abbr = /[가-힣0-9]([A-Z]{1,3})$/.exec(text);
  if (abbr) return LETTER_BATCHIM[abbr[1].slice(-1)] ?? false;
  const c = text.slice(-1);
  if (!c) return null;
  const code = c.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const last = (code - 0xac00) % 28;
    return last === 0 ? false : last === 8 ? 'l' : true;
  }
  if (/[0-9]/.test(c)) return '1780'.includes(c) ? (c === '0' ? true : 'l') : '36'.includes(c) ? true : false;
  return null;
}

export function josa(word, pair) {
  const [a, b] = pair.split('/');
  const has = batchim(word);
  if (has === null) return `${word}${a === '으로' ? '(으)로' : `${a}(${b})`}`;
  if (a === '으로') return `${word}${has === true ? a : b}`;
  return `${word}${has ? a : b}`;
}

// In Korean the word with its particle (josa), in a language without particles the word as is
export const withParticle = (lang, word, pair) => (lang === 'ko' ? josa(word, pair) : word);

const quoted = (lang, name, [a, b]) => (lang === 'ko' ? `"${name}"${batchim(name) === true ? a : b}` : `"${name}"`);

export const statName = (stat, lang) => (STAT_KEYS.has(stat) ? say(lang, `stat.${stat}`) : stat);
const STAT_KEYS = new Set([...STATS, 'accuracy']);

// Words joined into one list in lang (A/B / A, B)
export const listOf = (words, lang) => words.join(say(lang, 'diary.listSep'));
const statList = (list, lang) => (list?.length === STATS.length ? say(lang, 'diary.allStats') : listOf((list ?? []).map(s => statName(s, lang)), lang));

const NATURE_KO = Object.fromEntries(Object.entries(storyNames.natures).filter(([k]) => /[가-힣]/.test(k)).map(([ko, en]) => [en, ko]));

export const natureName = (nature, lang) => (checkLang(lang) === 'ko' ? NATURE_KO[nature] ?? nature : nature);

export const moneyText = (amount, lang) => say(lang, 'money', { n: amount });
const count = (n, lang) => Number(n).toLocaleString(lang);

function nameKit(lang, names) {
  const sp = species => names.species(species);
  return {
    sp,

    item: (id, event) => customText(event, id) ?? names.item(id),
    move: id => names.move(id),
    ability: id => names.ability(id),
    mon: who => (who?.name ? who.name : who?.species ? sp(who.species) : who?.ref ?? say(lang, 'diary.mon')),

    p: (word, pair) => withParticle(lang, word, pair),
  };
}

function effectLine(event, lang, k) {
  const t = (key, values) => say(lang, key, values);
  if (event.kind === 'heal') {
    if (event.revivedAll) return t('diary.fx.revivedAll');
    if (event.revived) return t('diary.fx.revived');
    if (event.cured) return t('diary.fx.cured');
    if (event.hpFrom != null && event.hpTo != null && event.hpFrom !== event.hpTo) return `HP ${event.hpFrom}% → ${event.hpTo}%`;
    return '';
  }
  if (event.kind === 'level') return `Lv${event.from} → ${event.to}`;
  if (event.kind === 'evolve') return t('diary.fx.evolve', { species: k.p(k.sp(event.species), '으로/로') });
  if (event.kind === 'teach') return t('diary.fx.teach', { move: k.move(event.move) });

  if (event.kind === 'evs') return t('diary.fx.evs', { stat: statName(event.stat, lang), n: event.to - event.from });
  if (event.kind === 'exp') return `${t('diary.fx.exp', { n: count(event.amount, lang) })}${event.to > event.from ? `, Lv${event.from} → ${event.to}` : ''}`;
  if (event.kind === 'ability') return t('diary.fx.ability', { from: k.ability(event.from), to: k.ability(event.to) });
  if (event.kind === 'nature') return t('diary.fx.nature', { nature: natureName(event.nature, lang) });
  if (event.kind === 'hypertrain') return t('diary.fx.hyper', { stats: statList(event.stats, lang) });
  if (event.kind === 'ppup') return t('diary.fx.ppUp', { move: k.move(event.move), from: event.from ?? '?', to: event.to ?? '?' });
  return '';
}

export const boxOf = (state, position) => {
  const index = Math.floor(position / BOX_SIZE);
  return { n: index + 1, name: state?.boxNames?.[index] || '' };
};

// Default name of box n (from 1) in lang
export const boxLabel = (n, lang) => say(lang, 'box.default', { n });
const boxSent = (box, lang) => (box?.n
  ? say(lang, 'diary.toBox', { box: withParticle(lang, box.name ? `"${box.name}"` : boxLabel(box.n, lang), '으로/로') })
  : box ? say(lang, 'diary.toAnyBox') : '');

export function diaryLine(event, lang, names) {
  const t = (key, values) => say(lang, key, values);
  const k = nameKit(lang, names);
  const { p, item, move } = k;
  const who = k.mon(event?.who);
  switch (event?.kind) {
    case 'battle': return battleLine(event, lang, k);
    case 'line': return event.text;
    case 'add': {
      const name = event.who?.name ? t('diary.nicknamed', { name: event.who.name, species: k.sp(event.who.species) }) : k.sp(event.who?.species);
      return t('diary.add', { mon: p(`${name} Lv${event.level}`, '을/를'), box: boxSent(event.box, lang) });
    }
    case 'level': return `${who} Lv${event.from ?? '?'} → ${event.to ?? (event.delta ? `+${event.delta}` : '?')}`;
    case 'heal': {
      if (event.all) return t(event.revivedAll ? 'diary.revivedAll' : 'diary.healAll');
      if (event.revived) return t('diary.revived', { who: p(who, '이/가') });
      if (event.cured) return t('diary.cured', { who });
      if (event.hpFrom != null && event.hpTo != null) return `${who} HP ${event.hpFrom}% → ${event.hpTo}%`;
      return t('diary.healed', { who: p(who, '이/가') });
    }
    case 'item': return event.delta > 0 ? t('diary.itemGot', { item: item(event.item, event), n: event.delta })
      : t(event.toss ? 'diary.itemTossed' : 'diary.itemLost', { item: item(event.item, event), n: -event.delta });
    case 'use': {
      const effect = (event.effects ?? []).map(e => effectLine(e, lang, k)).filter(Boolean).join(', ');
      const used = event.who ? t('diary.useOn', { who, item: p(item(event.item), '을/를') }) : t('diary.use', { item: p(item(event.item), '을/를') });
      return `${used}${effect ? ` (${effect})` : ''}`;
    }
    case 'swap': {
      const [a, b] = event.at ?? [];
      if (a?.party && b?.party) return t('diary.order', { a: p(k.mon(event.a), '과/와'), b: k.mon(event.b) });
      return t('diary.swapBox', { a: p(k.mon(event.a), '과/와'), b: p(k.mon(event.b), '을/를') });
    }
    case 'release': return t('diary.release', { who: p(who, '을/를') });
    case 'deposit': return t('diary.deposit', { who: p(who, '을/를') });
    case 'withdraw': return t('diary.withdraw', { who: p(who, '을/를') });
    case 'nickname': return t('diary.nickname', { species: k.sp(event.who?.species) || who, name: quoted(lang, event.name, ['이라는', '라는']) });
    case 'hold':
      if (event.item) return t('diary.give', { who, item: p(item(event.item, event), '을/를') });
      return event.prev ? t('diary.take', { who, item: p(item(event.prev, event), '을/를') }) : t('diary.takeAny', { who });
    case 'evolve': return t('diary.evolve', { who: p(who, '이/가'), species: p(k.sp(event.species), '으로/로') });
    case 'teach':
      if (event.forget) return t('diary.forgetLearn', { who: p(who, '이/가'), old: p(move(event.forget), '을/를'), move: p(move(event.move), '을/를') });
      return event.learned ? t('diary.learned', { who: p(who, '이/가'), move: p(move(event.move), '을/를') })
        : t('diary.canLearn', { who: p(who, '은/는'), move: p(move(event.move), '을/를') });

    case 'skipmove': return t('diary.skipMove', { who: p(who, '은/는'), move: p(move(event.move), '을/를') });
    case 'noevolve': return t('diary.noEvolve', { who });
    case 'pp': return t('diary.pp', { who });
    case 'boxname': return event.name ? t('diary.boxName', { box: boxLabel(event.box + 1, lang), name: quoted(lang, event.name, ['으로', '로']) })
      : t('diary.boxNameReset', { box: boxLabel(event.box + 1, lang) });
    case 'money': return event.delta > 0 ? t('diary.moneyGot', { money: p(moneyText(event.delta, lang), '을/를') })
      : t('diary.moneySpent', { money: p(moneyText(-event.delta, lang), '을/를') });

    case 'evs': case 'exp': case 'ability': case 'nature': case 'hypertrain': case 'ppup': return `${who}: ${effectLine(event, lang, k)}`;
    default: return event?.op ? `(${event.op})` : null;
  }
}

export function resultEvents(meta, state = null) {
  if (!meta?.outcome) return [];
  const caught = meta.caught ?? null;

  const wild = meta.wild ?? String(meta.title ?? '').startsWith('야생');
  const events = [{ kind: 'battle', outcome: meta.outcome, title: meta.title ?? '', wild, caught, box: caught?.storage ? boxOf(state, caught.storage - 1) : null }];
  for (const e of meta.evolved ?? []) events.push({ kind: 'evolve', who: { species: e.from, name: '' }, species: e.to });
  return events;
}

function battleLine(event, lang, k) {
  const t = (key, values) => say(lang, key, values);
  const title = event.title || t('diary.foe');
  switch (event.outcome) {
    case 'win': return event.wild ? t('diary.beatWild', { title: k.p(title, '을/를') }) : t('diary.beat', { title });
    case 'lose': return t('diary.lost', { title });
    case 'forfeit': return t('diary.forfeit', { title });
    case 'run': return t('diary.ran', { title });
    case 'capture': {
      const mon = event.caught?.species ? k.sp(event.caught.species) : title.replace(/^야생\s*/, '');
      return t('diary.caught', { mon: k.p(mon, '을/를'), box: boxSent(event.box, lang) });
    }
    default: return null;
  }
}

const ICON_BOOK = '<svg viewBox="0 0 18 18" aria-hidden="true"><rect x="4" y="1.8" width="11.5" height="14.4" rx="1.6" fill="#fdf8e8" stroke="currentColor" stroke-width="1.5"/>'
  + '<path d="M7 2v14" stroke="#d8434d" stroke-width="1.2"/><path d="M9 6h4.5M9 9h4.5M9 12h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
  + '<path d="M2.3 5h3.2M2.3 9h3.2M2.3 13h3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const LINE = 22;

export const DIARY_CSS = [
  `.x-risu-pkb-log{display:block;margin:6px 0 2px;padding:0;max-width:470px;font-family:${FONT};font-weight:700;text-align:left;}`,
  `.x-risu-pkb-logi{box-sizing:border-box;vertical-align:top;position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:25px;margin:0;padding:0;list-style:none;cursor:pointer;border:2px solid #315a77;border-radius:7px;background:#fff;box-shadow:0 2.5px 0 #23435f;color:#315a77;user-select:none;}`,
  `.x-risu-pkb-logi::-webkit-details-marker{display:none;}`,
  `.x-risu-pkb-logi::marker{content:"";}`,
  `.x-risu-pkb-logi:active{transform:translateY(1.5px);box-shadow:0 1px 0 #23435f;}`,
  `.x-risu-pkb-logi svg{display:block;width:17px;height:17px;}`,
  `.x-risu-pkb-log[open] .x-risu-pkb-logi{background:#fbf0cf;}`,
  `.x-risu-pkb-bang{position:absolute;top:-7px;right:-8px;width:15px;height:15px;border:1.5px solid #fff;border-radius:50%;background:#d8434d;color:#fff;font:700 10px/12px sans-serif;text-align:center;box-shadow:0 1px 0 #8e2835;}`,
  `.x-risu-pkb-paper{box-sizing:border-box;margin:7px 0 4px;padding:3px 12px 4px 34px;border:1px solid #e2d4a8;border-radius:3px 9px 9px 3px;`
    + `background-color:#fdf8e6;background-image:linear-gradient(to right,transparent 23px,#e59a9a 23px,#e59a9a 24.5px,transparent 24.5px),`
    + `repeating-linear-gradient(to bottom,transparent 0,transparent ${LINE - 1}px,#cbd9e6 ${LINE - 1}px,#cbd9e6 ${LINE}px);`
    + `background-position:0 0,0 3px;box-shadow:0 2px 0 #dccb98,inset 3px 0 0 rgba(160,130,70,.08);color:#3d3527;font-size:13px;line-height:${LINE}px;}`,
  `.x-risu-pkb-pl{overflow-wrap:anywhere;}`,
  `.x-risu-pkb-pe{color:#c2303b;overflow-wrap:anywhere;}`,
  `.x-risu-pkb-paper:empty{min-height:${LINE + 9}px;}`,

  `.x-risu-pkb-logrow{position:relative;display:flow-root;max-width:470px;}`,
  `.x-risu-pkb-fgs:only-child:not(:empty){padding-top:31px;}`,
  `.x-risu-pkb-fgs:only-child .x-risu-pkb-fg{left:0;}`,
  `.x-risu-pkb-btn.x-risu-pkb-fg{box-sizing:border-box;vertical-align:top;position:absolute;top:6px;left:34px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:25px;margin:0;padding:0;border:2px solid #315a77;border-radius:7px;background:#fff;box-shadow:0 2.5px 0 #23435f;color:#315a77;cursor:pointer;}`,
  `.x-risu-pkb-btn.x-risu-pkb-fg:hover{filter:none;background:#fff4f4;}`,
  `.x-risu-pkb-btn.x-risu-pkb-fg:active{transform:translateY(1.5px);box-shadow:0 1px 0 #23435f;}`,
  `.x-risu-pkb-btn.x-risu-pkb-fg svg{display:block;width:17px;height:17px;}`,
  `.x-risu-pkb-btn.x-risu-pkb-fg.x-risu-pkb-busy{cursor:default;background:#eef4f9;transform:none;box-shadow:0 2.5px 0 #23435f;}`,
  `.x-risu-pkb-fg.x-risu-pkb-busy svg{animation:x-risu-pkbforge 0.9s ease-in-out infinite;}`,
  `@keyframes x-risu-pkbforge{0%,100%{transform:rotate(0deg);} 50%{transform:rotate(-24deg);} }`,
  `.x-risu-pkb-fgask{position:absolute;top:6px;left:68px;display:flex;align-items:center;gap:5px;width:max-content;max-width:calc(100% - 68px);min-height:25px;padding:2px 4px 2px 7px;box-sizing:border-box;border:1.5px solid #315a77;border-radius:7px;background:#fff;color:#23435f;font-family:${FONT};font-size:11px;line-height:1.3;box-shadow:0 2px 0 #23435f;animation:x-risu-pkbask .15s ease-out;}`,
  `.x-risu-pkb-fgask>span{min-width:0;overflow-wrap:anywhere;}`,
  `.x-risu-pkb-fgask .x-risu-pkb-fgok{display:inline-flex;flex:none;align-items:center;justify-content:center;width:23px;height:21px;padding:0;border:1.5px solid #315a77;border-radius:5px;background:#eef4f9;color:#23435f;font:700 14px/1 sans-serif;box-shadow:0 1px 0 #23435f;}`,
  `.x-risu-pkb-fgs:only-child .x-risu-pkb-fgask{left:34px;max-width:calc(100% - 34px);}`,
  `@keyframes x-risu-pkbask{from{opacity:0;transform:translateX(-4px);}to{opacity:1;transform:none;}}`,
  noteRule('.x-risu-pkb-fgnote', 'info'),
  `.x-risu-pkb-fgnote{display:block;box-sizing:border-box;max-width:470px;margin:5px 0 4px;font-size:11.5px;text-align:left;}`,
  `.x-risu-pkb-fgsub{display:block;font-size:10px;opacity:.85;}`,
].join(' ');

// The notebook icon and its paper (closed). rows = the lines' HTML, bad = whether some could not be applied
function logHtml(rows, bad, lang) {
  const bang = bad ? '<span class="x-risu-pkb-bang">!</span>' : '';
  const label = esc(say(lang, bad ? 'diary.logBad' : 'diary.log'));
  return `<details class="x-risu-pkb-log${bad ? ' x-risu-pkb-logbad' : ''}">`
    + `<summary class="x-risu-pkb-logi" title="${label}" aria-label="${label}">${ICON_BOOK}${bang}</summary>`
    + `<div class="x-risu-pkb-paper">${rows}</div></details>`;
}

export function renderDiary({ events = [], errors = [], forge = null }, lang, names) {
  const lines = events.map(e => diaryLine(e, lang, names)).filter(Boolean);
  const bad = errors.filter(e => e != null && e !== '').map(String);
  const rows = lines.map(l => `<div class="x-risu-pkb-pl">${esc(l)}</div>`).join('')
    + bad.map(e => `<div class="x-risu-pkb-pe">! ${esc(e)}</div>`).join('');
  const log = rows ? logHtml(rows, bad.length > 0, lang) : '';
  if (!forge || forge.buttonsOff) return log ? `\n\n${log}\n\n` : '';
  if (forge.pending) return '\n\n<div class="x-risu-pkb-logrow">' + log + '<div class="x-risu-pkb-fgs x-risu-pkbfi-{{chat_index}}"></div></div>\n\n';
  const slot = `<div class="x-risu-pkb-fgs x-risu-pkbf-${forge.key}">${renderForge(forge, lang)}</div>`;
  return `\n\n<div class="x-risu-pkb-logrow">${log}{{#if {{equal::{{chat_index}}::${forge.at}}}}}${slot}{{/if}}</div>\n\n`;
}

const COMMAND_WHY = new Set(['noMove', 'noPp', 'disabled', 'noSwitch', 'trapped', 'noItem', 'cantUse', 'cantRun', 'double']);

function commandWords(c, lang, names) {
  if (!c) return '';
  const t = (key, values) => say(lang, key, values);
  const k = nameKit(lang, names);
  const target = to => (to?.slot ? t('diary.cmd.slot', { n: to.slot }) : to?.species ? k.sp(to.species) : to?.name ?? '');
  if (c.kind === 'move') {
    const move = c.move ? k.move(c.move) : c.raw ?? '';
    return c.gimmick ? t(`diary.cmd.${c.gimmick}`, { move }) : move;
  }
  if (c.kind === 'switch') return t('diary.cmd.switch', { target: target(c.target) });
  if (c.kind === 'item') {
    const item = c.item ? k.item(c.item) : t('diary.cmd.anyItem');
    return c.target ? t('diary.cmd.itemOn', { item, target: target(c.target) }) : item;
  }
  if (c.kind === 'run') return t('diary.cmd.run');
  return '';
}

export function commandLines(turns, results, lang, names) {
  const out = { plain: [], errors: [] };
  turns.forEach((turn, i) => {
    const result = results?.[i];
    if (result?.state !== 'done' && result?.state !== 'rejected') return;
    const me = commandWords(turn.me, lang, names);
    const line = turn.foe ? say(lang, 'diary.cmd.lineFoe', { me, foe: commandWords(turn.foe, lang, names) }) : say(lang, 'diary.cmd.line', { me });
    if (result.state === 'done') out.plain.push(line);
    else out.errors.push(say(lang, 'diary.cmd.rejected', { line, why: say(lang, `diary.cmd.why.${COMMAND_WHY.has(result.reason) ? result.reason : 'other'}`) }));
  });
  return out;
}

const ICON_SWORD = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M15.6 2.4 14.9 5.2 7.6 12.5 5.5 10.4 12.8 3.1z" fill="#e3ebf2" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'
  + '<path d="M4.3 9.5 8.5 13.7" stroke="#d8434d" stroke-width="2.1" stroke-linecap="round"/><path d="M6.3 11.7 3.3 14.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  + '<circle cx="2.7" cy="15.3" r="1.2" fill="currentColor"/></svg>';

export function renderForge({ key, on = false, busy = false, ask = false }, lang) {
  if (!on && !busy) return '';
  const t = name => esc(say(lang, name));
  const label = t(busy ? 'forge.busy' : 'forge.label');
  const button = `<button type="button" class="x-risu-pkb-btn x-risu-pkb-fg${busy ? ' x-risu-pkb-busy' : ''} x-risu-pkbk-${key} x-risu-pkba-forge x-risu-pkbi-{{chat_index}}"`
    + ` title="${label}" aria-label="${label}" aria-expanded="${ask && !busy}"${busy ? ' disabled' : ''}>${ICON_SWORD}</button>`;
  const lines = busy ? `<div class="x-risu-pkb-fgnote">${t('forge.busy')}<span class="x-risu-pkb-fgsub">${t('forge.hold')}</span></div>` : '';
  const confirm = ask && !busy ? `<span class="x-risu-pkb-fgask" role="group" aria-label="${t('forge.confirm')}"><span>${t('forge.ask')}</span><button type="button" class="x-risu-pkb-btn x-risu-pkb-fgok x-risu-pkbk-${key} x-risu-pkba-forgeok x-risu-pkbi-{{chat_index}}" title="${t('forge.confirm')}" aria-label="${t('forge.confirm')}">✓</button></span>` : '';
  return button + confirm + lines;
}
