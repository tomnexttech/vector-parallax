// 試験の共通部品。repo の根・fixture・prompt を読む。網には出ない。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const readJson = (...p) => JSON.parse(readFileSync(path.join(ROOT, ...p), 'utf8'));
export const PROMPT = { ...readJson('data', 'prompt.json'), rights_mode: 'strict' };   // 既存の試験は strict（今までの動き）
export const CASES = readJson('tests', 'fixtures', 'validate_cases.json');

export const clone = (x) => JSON.parse(JSON.stringify(x));

/** 要求の user_text から doc を取り出す。 */
export function docOf(userText) {
  const m = /<doc>\n([\s\S]*)\n<\/doc>/.exec(userText);
  if (!m) throw new Error('no <doc> in user_text');
  return JSON.parse(m[1]);
}

/** 要求の rule_groups をそのまま story にした答え（行儀のよい AI）。edit(answer, doc) で壊せる。tests/helpers.py の rules_answer と同じ。 */
export function rulesAnswer(userText, edit) {
  const doc = docOf(userText);
  const blocks = doc.blocks.map((b) => ({
    bid: b.bid,
    stories: b.rule_groups.map((g) => ({
      member_ids: [...g], headline_ja: '試験 題 ' + b.bid, headline_en: 'Test event line ' + b.bid,
      angles: g.map((a) => ({ item_id: a, focus_ja: '試験の焦点' })),
      contrast_ja: '', flags: [], flag_note_ja: '',
    })),
  }));
  const ans = { blocks };
  if (edit) edit(ans, doc);
  return JSON.stringify(ans);
}

/** 偽の provider。answers[i] は i 番目の呼びの答え: { raw } か { err }。呼びは calls に控える。 */
export function fakeProvider(answers, name = 'fake-ai', model = 'fake-1') {
  const calls = [];
  return {
    name, model, calls,
    async call(system, userText, schema, extra) {
      calls.push({ system, userText, schema, extra });
      const a = typeof answers === 'function' ? answers(calls.length - 1, userText) : answers[calls.length - 1];
      if (!a) return { raw: null, err: 'network' };
      return a.err ? { raw: null, err: a.err } : { raw: a.raw, err: '' };
    },
  };
}
