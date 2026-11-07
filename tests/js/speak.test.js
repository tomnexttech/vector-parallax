import test from 'node:test';
import assert from 'node:assert/strict';
import { hasJa, voiceFor, readLines, createReader, PER } from '../../js/speak.js';

const V = [{ lang: 'en-US', name: 'e', localService: true }, { lang: 'ja-JP', name: 'j1', localService: false }, { lang: 'ja_JP', name: 'j2', localService: true }];
const ev = { key: 'k1', members: [] };
const sides = () => ({
  jp: [{ outlet: 'NHK', title: '日本の見出し' }, { media: '読売新聞', outlet: 'Google ニュース', title: '二つ目' }],
  intl: [{ outlet: 'Reuters', title: 'An English headline' }],
  gov: [],
});

test('a Japanese voice decides the button; the voice on the device comes first', () => {
  assert.equal(hasJa(V), true);
  assert.equal(hasJa([{ lang: 'en-GB' }]), false);
  assert.equal(hasJa(null), false);
  assert.equal(voiceFor(V, 'ja').name, 'j2');
  assert.equal(voiceFor(V, 'en').name, 'e');
  assert.equal(voiceFor(V, 'fr'), null);
});

test('the lines: the AI summary said as the AI, then each side with reports, its count and headlines', () => {
  const l = readLines(ev, { sides, point: () => ({ text: '要点の文', ai: true }) });
  assert.deepEqual(l.slice(0, 2), [{ text: 'AI のまとめ', lang: 'ja' }, { text: '要点の文', lang: 'ja' }]);
  assert.deepEqual(l[2], { text: '国内の報道、2件', lang: 'ja' });
  assert.ok(l.some((x) => x.text === '読売新聞'));
  assert.ok(l.some((x) => x.text === 'An English headline' && x.lang === 'en'));
  assert.ok(!l.some((x) => /官公庁/.test(x.text)), 'a side without reports is not read');
  const p = readLines(ev, { sides, point: () => ({ text: '公表の見出し', outlet: 'NHK', ai: false }) });
  assert.deepEqual(p[0], { text: 'NHKの見出し', lang: 'ja' });
  assert.deepEqual(readLines(null, { sides }), []);
});

test('at most PER headlines of a side', () => {
  const many = () => ({ jp: Array.from({ length: 9 }, (_, i) => ({ outlet: 'O' + i, title: '見出し' + i })), intl: [], gov: [] });
  const l = readLines(ev, { sides: many, point: () => null });
  assert.equal(l.filter((x) => /^見出し/.test(x.text)).length, PER);
});

test('the reader: hidden without speech or a Japanese voice; one reading at a time; the same key stops it', () => {
  assert.equal(createReader(null).can(), false);
  const spoken = []; let cancels = 0;
  class U { constructor(t) { this.text = t; } }
  const win = { SpeechSynthesisUtterance: U, speechSynthesis: { getVoices: () => V, addEventListener() {}, speak: (u) => spoken.push(u), cancel: () => { cancels++; } } };
  const r = createReader(win); let changes = 0; r.onChange(() => { changes++; });
  assert.equal(r.can(), true);
  assert.equal(r.toggle('k1', [{ text: '一', lang: 'ja' }, { text: 'two', lang: 'en' }]), true);
  assert.equal(r.key(), 'k1');
  assert.equal(spoken.length, 2);
  assert.equal(spoken[0].voice.name, 'j2');
  assert.equal(spoken[1].voice.name, 'e');
  spoken[1].onend();
  assert.equal(r.key(), null, 'the end of the last line ends the reading');
  r.toggle('k1', [{ text: '一', lang: 'ja' }]);
  assert.equal(r.toggle('k1', []), false);
  assert.equal(r.key(), null);
  assert.ok(cancels >= 2 && changes >= 3);
  const none = createReader({ SpeechSynthesisUtterance: U, speechSynthesis: { getVoices: () => [{ lang: 'en-US' }], addEventListener() {}, speak() {}, cancel() {} } });
  assert.equal(none.can(), false);
  assert.equal(none.toggle('k', [{ text: 'x', lang: 'en' }]), false);
});
