/* verdict — 比べた結論 (v88). One event's media table (js/coverage.js, the build's rule-made case.coverage) and its 偏り度 (js/bias.js) read down to one card:
 * where the outlets agree, where they split, how firm each split is, and what the reading cannot tell. No DOM in verdictOf.
 *
 * The line it keeps: it counts what is on the page and never judges. Nothing is made up (no number that is not a count of outlets, rows or terms of this event),
 * nothing says which side is right, nothing says an outlet "did not report" (the table says only what is not in the headline and summary). AI is not used.
 *
 *   verdictOf(cov, bias)   -> null | { agree, split, strength, bias, limits, counts, headline }
 *     agree   [{ label, hv, cm }]                      a row that both sides carry, and that at least 3/4 of the outlets compared carry (3 outlets at least)
 *     split   [{ label, kind, a, b, lvl, text }]       a row one side carries far more than the other (a gap of half the outlets compared or more), and the build's
 *                                                       own findings of the kinds 言い方 / 数 / 見出しの最初の語 / 初報; a = the side that carries it more
 *     lvl     'strong' | 'mid' | 'weak'                the smaller of (outlets that carry it on the side that does) and (outlets compared on the other side): 3 or more strong, 2 mid, 1 weak (shown with the counts, never alone)
 *   createVerdict({ h }) -> { node(v) }
 */
import { KIND_JA, SIDE_JA, TERM_KINDS, unlabel, findingsOf } from './coverage.js';
import { HEAD } from './heads.js';

export const MIN_AGREE = 3;
export const AGREE_SHARE = 0.75;
export const SPLIT_GAP = 0.5;
export const LVL_JA = { strong: '強め', mid: '中', weak: '弱め' };
export const SHOW_AGREE = 4;
export const SHOW_SPLIT = 4;
const FIND_SPLIT = ['word_choice', 'num_diff', 'lead_differs', 'first_gap'];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const homeOf = (o) => (o.side === 'intl' ? 'intl' : 'home');
export const SIDE_NAME = { home: '国内', intl: '海外' };

const lvlOf = (thin) => (thin >= 3 ? 'strong' : thin === 2 ? 'mid' : 'weak');
const rowLabel = (r) => (TERM_KINDS.includes(r.k) ? `${KIND_JA[r.k]}：${r.t}` : r.t);

export function verdictOf(cov, bias, rawFindings) {
  if (!isObj(cov) || !Array.isArray(cov.outlets) || cov.outlets.length < 2 || !Array.isArray(cov.rows)) return null;
  const sideOfOutlet = cov.outlets.map(homeOf);
  const outlets = { home: sideOfOutlet.filter((s) => s === 'home').length, intl: sideOfOutlet.filter((s) => s === 'intl').length };
  if (!outlets.home || !outlets.intl) return null;   // one side only: there is nothing to set against (js/bias.js ONE_SIDED says so)
  const agree = [], split = [];
  let na = 0;
  for (const r of cov.rows) {
    const c = { home: { hv: 0, cm: 0 }, intl: { hv: 0, cm: 0 } };
    r.c.forEach((x, i) => { const s = c[sideOfOutlet[i]]; if (!s) return; if (x === null) { na++; return; } s.cm++; if (x) s.hv++; });
    if (!c.home.cm || !c.intl.cm) continue;
    const hv = c.home.hv + c.intl.hv, cm = c.home.cm + c.intl.cm;
    const sh = { home: c.home.hv / c.home.cm, intl: c.intl.hv / c.intl.cm };
    if (c.home.hv >= 1 && c.intl.hv >= 1 && hv >= MIN_AGREE && hv / cm >= AGREE_SHARE) { agree.push({ label: rowLabel(r), kind: r.k, hv, cm }); continue; }
    if (Math.abs(sh.home - sh.intl) >= SPLIT_GAP) {
      const hi = sh.home > sh.intl ? 'home' : 'intl', lo = hi === 'home' ? 'intl' : 'home';
      split.push({ label: rowLabel(r), kind: 'row', a: { side: hi, hv: c[hi].hv, cm: c[hi].cm }, b: { side: lo, hv: c[lo].hv, cm: c[lo].cm }, lvl: lvlOf(Math.min(c[hi].hv, c[lo].cm)), gap: Math.abs(sh.home - sh.intl) });
    }
  }
  const finds = Array.isArray(rawFindings) ? rawFindings : Array.isArray(cov.findings) ? cov.findings : [];
  for (const f of finds) {
    if (!isObj(f) || !FIND_SPLIT.includes(f.kind) || !Array.isArray(f.outlets) || !Array.isArray(f.others)) continue;
    const text = unlabel(f);
    if (!text) continue;
    split.push({ label: HEAD[`find.${{ word_choice: 'word', num_diff: 'num', lead_differs: 'lead', first_gap: 'first' }[f.kind]}`] || '', kind: f.kind, text, a: { n: f.outlets.length }, b: { n: f.others.length }, lvl: lvlOf(Math.min(f.outlets.length, f.others.length)), gap: 0 });
  }
  const order = { strong: 0, mid: 1, weak: 2 };
  split.sort((x, y) => order[x.lvl] - order[y.lvl] || y.gap - x.gap);
  agree.sort((x, y) => y.hv / y.cm - x.hv / x.cm || y.hv - x.hv);
  const strength = { strong: 0, mid: 0, weak: 0 };
  for (const s of split) strength[s.lvl]++;
  const descLess = cov.outlets.filter((o) => o.desc === false).length;
  const b = isObj(bias) && bias.ok ? { score: bias.score, measured: bias.terms.length, total: bias.terms.length + (Array.isArray(bias.skipped) ? bias.skipped.length : 0) }
    : { score: null, reason: isObj(bias) && typeof bias.reason === 'string' ? bias.reason : '' };
  const limits = [];
  limits.push(`照合したのは ${outlets.home + outlets.intl} 社（国内 ${outlets.home}・海外 ${outlets.intl}）。材料は見出しと要旨だけで、本文は読んでいません`);
  const thin = ['home', 'intl'].filter((k) => outlets[k] <= 2);
  if (thin.length) limits.push(`${thin.map((k) => SIDE_NAME[k]).join('と')}は ${thin.length === 2 ? '各' : ''}${Math.max(...thin.map((k) => outlets[k]))} 社以下で、その側の言い方を代表するには少ない件数です`);
  if (descLess) limits.push(`要旨が取れず見出しだけの媒体が ${descLess} 社あります`);
  if (na) limits.push(`言語が違って照合しなかった欄が ${na} 欄あります`);
  if (b.score != null && b.total > b.measured) limits.push(`偏り度は ${b.total} 項目のうち ${b.measured} 項目で測っています`);
  limits.push('偏り度は報じ方の偏りを数えた値で、内容が正しいかどうかは測っていません');
  const sentence = split.length
    ? `割れている点が ${split.length} 件。根拠の強さは 強め ${strength.strong}・中 ${strength.mid}・弱め ${strength.weak} です${strength.strong + strength.mid === 0 ? '。どれも少ない側が 1 社の比べなので、傾向とは言えません' : ''}`
    : '見出しと要旨の範囲では、割れている点は見つかりませんでした';
  return { agree, split, strength, bias: b, limits, counts: { ...outlets, na }, headline: `一致している点が ${agree.length} 件。${sentence}` };
}

export function createVerdict({ h }) {
  const frac = (x) => h('span', { class: 'vd-fr' }, h('b', { class: 'num', text: String(x.hv) }), h('span', { class: 'num', text: ` / ${x.cm} 社` }));
  const biasBox = (b) => (b.score == null
    ? h('div', { class: 'vd-bias off' }, h('span', { class: 'vd-bk', text: '偏り度' }), h('span', { class: 'vd-bn', text: '—' }), h('span', { class: 'vd-bs', text: b.reason || '測れません' }))
    : h('div', { class: 'vd-bias', role: 'img', 'aria-label': `偏り度 ${b.score}（0 から 100）` }, h('span', { class: 'vd-bk', text: '偏り度' }),
      h('span', { class: 'vd-bn num', 'aria-hidden': 'true', text: String(b.score) }),
      h('span', { class: 'vd-bar', 'aria-hidden': 'true', style: `--p:${b.score}%` }),
      h('span', { class: 'vd-bs', text: `0〜100・${b.total} 項目のうち ${b.measured} を測定` })));
  const tile = (k, n, cls) => h('div', { class: `vd-t ${cls}` }, h('b', { class: 'num', text: String(n) }), h('span', { text: k }));
  const lvl = (l) => h('span', { class: `vd-l ${l}`, title: '割れを支える媒体の数で数えた強さ' }, h('i', { 'aria-hidden': 'true' }), `根拠 ${LVL_JA[l]}`);
  const splitItem = (s) => h('li', { class: 'vd-s', data: { lvl: s.lvl } },
    h('div', { class: 'vd-sh' }, h('span', { class: 'vd-sn', text: s.label }), lvl(s.lvl)),
    s.kind === 'row'
      ? h('div', { class: 'vd-sw' }, [s.a, s.b].map((x) => h('span', { class: 'vd-sd', data: { side: x.side === 'intl' ? 'intl' : 'jp' } }, h('i', { 'aria-hidden': 'true' }), h('span', { class: 'vd-sk', text: SIDE_NAME[x.side] }), frac(x))))
      : h('p', { class: 'vd-st', text: s.text }));
  return {
    node(v) {
      if (!v) return null;
      const ag = v.agree.slice(0, SHOW_AGREE), sp = v.split.slice(0, SHOW_SPLIT);
      return h('section', { class: 'dcard vd', 'aria-label': HEAD['cmp.verdict'] },
        h('h3', { class: 'en-sub vd-h' }, HEAD['cmp.verdict'], h('span', { class: 'vd-note', text: '規則で数えた結果' })),
        h('p', { class: 'vd-lead', text: v.headline }),
        h('div', { class: 'vd-top' }, tile('一致', v.agree.length, 'ag'), tile('割れ', v.split.length, 'sp'), biasBox(v.bias)),
        h('div', { class: 'vd-cols' },
          h('div', { class: 'vd-c' }, h('h4', { class: 'vd-ch', text: '一致している点' }),
            ag.length ? h('ul', { class: 'vd-ul' }, ag.map((a) => h('li', { class: 'vd-a' }, h('span', { class: 'vd-an', text: a.label }), frac(a))))
              : h('p', { class: 'vd-none', text: '両側が揃って載せている点は、この材料にはありません' }),
            v.agree.length > ag.length ? h('p', { class: 'vd-more', text: `ほか ${v.agree.length - ag.length} 件` }) : null),
          h('div', { class: 'vd-c' }, h('h4', { class: 'vd-ch', text: '割れている点' }),
            sp.length ? h('ul', { class: 'vd-ul' }, sp.map(splitItem)) : h('p', { class: 'vd-none', text: '割れている点は見つかりませんでした' }),
            v.split.length > sp.length ? h('p', { class: 'vd-more', text: `ほか ${v.split.length - sp.length} 件` }) : null)),
        h('details', { class: 'vd-lim' }, h('summary', {}, h('span', { text: '数え方と限界' }), h('span', { class: 'vd-lc num', text: String(v.limits.length) })),
          h('ul', { class: 'vd-lu' }, v.limits.map((t) => h('li', { text: t })), h('li', { text: `一致は両側に出ていて照合した媒体の 3/4 以上、割れは両側の割合の差が 1/2 以上。根拠は、載せた側で載せた社数と、もう一方で照合した社数の小さい方が 3 社以上で強め、2 社で中、1 社で弱め（言い方・数・初報の違いは、比べた二つの側の社数の小さい方）` }))));
    },
  };
}
