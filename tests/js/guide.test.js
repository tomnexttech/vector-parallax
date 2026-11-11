import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptOf, cleanScript, numbersIn, createGuide, SILENCE_JA } from '../../js/guide.js';
import { voiceFor } from '../../js/speak.js';
import { readJson } from './helpers.js';

const pick = {
  sid: 's1', tier: 'split', title: { text: 'ヘグセス米国防長官に対する弾劾訴追決議案', ai: true },
  sides: { jp: { n: 6, outlets: 5 }, intl: { n: 3, outlets: 3 }, gov: { n: 0, outlets: 0 } },
  findings: [{ kind: 'only_side', text: '時期は海外 3 社が載せ、国内 5 社の見出しと要旨には出ていない' }, { kind: 'word_choice', text: '職を離れる：「弾劾」8 社・「罷免」1 社' }, { kind: 'first_gap', text: '海外が国内より 1 時間 27 分早く報じた' }],
};

test('the script: the title, the outlets of each side, the first two findings, then the AI point said to be the AI\'s', () => {
  const s = scriptOf(pick, { point: { text: '下院で決議案が出された', ai: true } });
  assert.deepEqual(s.map((l) => l.text), ['AI が付けた見出しです。', 'ヘグセス米国防長官に対する弾劾訴追決議案。', '国内 5 社、海外 3 社。',
    '時期は海外 3 社が載せ、国内 5 社の見出しと要旨には出ていない。', '職を離れる：「弾劾」8 社・「罷免」1 社。', 'AI の要点です。', '下院で決議案が出された。']);
  assert.deepEqual(scriptOf(null), []);
});

test('no number is said that the data does not hold', () => {
  const data = new Set([...numbersIn(pick.title.text), ...Object.values(pick.sides).map((x) => String(x.outlets)), ...pick.findings.flatMap((f) => numbersIn(f.text))]);
  for (const l of scriptOf(pick)) for (const n of numbersIn(l.text)) assert.ok(data.has(n), `${n} in "${l.text}" is not in the data`);
  const one = { ...pick, sides: { jp: { outlets: 2 }, intl: { outlets: 0 }, gov: { outlets: 1 } }, findings: [] };
  assert.deepEqual(scriptOf(one).map((l) => l.text).slice(-1), ['国内 2 社、官公庁 1 か所。']);
});

test('a line with a silence word is not read (the table of the prompt)', () => {
  const words = readJson('data', 'prompt.json').silence_words;
  const ja = Array.isArray(words) ? words : words.ja;
  for (const w of ja) assert.ok(SILENCE_JA.includes(w), `${w} is in the page's table too`);
  const bad = { ...pick, findings: [{ text: '国内は報じなかった' }, { text: '数が違う' }] };
  const s = scriptOf(bad);
  assert.ok(!s.some((l) => l.text.includes('報じなかった')));
  assert.ok(s.some((l) => l.text === '数が違う。'));
  assert.deepEqual(cleanScript([{ text: '黙殺した' }, { text: 'ok' }]).map((l) => l.text), ['ok']);
});

test('the voice: speaks only when asked, a caption per sentence, a pulse per word, stop ends it (the device voice is simulated, no sound)', () => {
  const spoken = [];
  class U { constructor(t) { this.text = t; } }
  const ss = { getVoices: () => [{ lang: 'ja-JP', localService: true }], addEventListener() {}, speak: (u) => spoken.push(u), cancel: () => {} };
  const ev = [];
  const g = createGuide({ win: { speechSynthesis: ss, SpeechSynthesisUtterance: U }, voiceFor, onState: (s) => ev.push(['state', s]), onCaption: (t) => ev.push(['cap', t]), onBoundary: () => ev.push(['pulse']) });
  assert.equal(spoken.length, 0, 'nothing is read by itself');
  assert.equal(g.play('s1', scriptOf(pick)), true);
  assert.equal(spoken.length, 5);
  assert.equal(spoken[0].lang, 'ja-JP');
  spoken[1].onstart(); spoken[1].onboundary(); spoken[1].onboundary();
  assert.deepEqual(ev, [['state', 'speaking'], ['cap', 'ヘグセス米国防長官に対する弾劾訴追決議案。'], ['pulse'], ['pulse']]);
  assert.equal(g.key(), 's1');
  spoken[4].onend();
  assert.equal(g.key(), null);
  assert.deepEqual(ev.slice(-2), [['cap', ''], ['state', 'idle']]);
  g.play('s1', scriptOf(pick)); g.stop();
  assert.equal(g.key(), null);
  assert.equal(createGuide({ win: {} }).can(), false);
  assert.equal(createGuide({ win: {} }).play('x', [{ text: 'a' }]), false);
});
