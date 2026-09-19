import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, formatMixed, formatGrouped, formatEnglish } from '../src/convert.js';

const value = (input) => {
  const r = parse(input);
  assert.ok(r.ok, `parse failed: ${input} -> ${r.code}`);
  return r.value;
};

const table = (name, cases, run) =>
  test(name, () => {
    for (const [input, expected] of cases) {
      assert.equal(run(value(input)), expected, input);
    }
  });

table('単位混じり', [
  ['0', '0'],
  ['10', '10'],
  ['1000', '1000'],
  ['10000', '1万'],
  ['10001', '1万1'],
  ['5000000', '500万'],
  ['10000000', '1000万'],
  ['99999999', '9999万9999'],
  ['100000000', '1億'],
  ['100000001', '1億1'],
  ['100010000', '1億1万'],
  ['123456789', '1億2345万6789'],
  ['-99', '-99'],
  ['12345.6', '1万2345.6'],
  ['1e12', '1兆'],
  ['1e16', '1京'],
  ['1e68', '1無量大数'],
], formatMixed);

test('無量大数を超えると命数法では表せない', () => {
  const v = value('1e72');
  assert.equal(formatMixed(v), null);
  assert.equal(formatGrouped(v), '1' + ',000'.repeat(24));
});

table('3桁区切り', [
  ['123456789', '123,456,789'],
  ['99999999', '99,999,999'],
  ['1000', '1,000'],
  ['999', '999'],
  ['-1234.5', '-1,234.5'],
  ['0', '0'],
], formatGrouped);

table('英語: 日本語の4桁と同じ形を3桁で出す。丸めない', [
  ['999', '999'],
  ['9999', '9,999'],
  ['10000', '10 thousand'],
  ['12345', '12 thousand 345'],
  ['5000000', '5 million'],
  ['99999999', '99 million 999 thousand 999'],
  ['100000001', '100 million 1'],
  ['123456789', '123 million 456 thousand 789'],
  ['2000000000', '2 billion'],
  ['1e12', '1 trillion'],
  ['999000000000000', '999 trillion'],
  ['-123456789', '-123 million 456 thousand 789'],
  ['12345.6', '12 thousand 345.6'],
], formatEnglish);

table('英語: trillion を超えたら指数表記。丸めたときだけ ≈ を付ける', [
  ['1e15', '1 × 10^15'],
  ['1.5e16', '1.5 × 10^16'],
  ['12345678901234567', '≈ 1.23 × 10^16'],
  ['1e68', '1 × 10^68'],
], formatEnglish);

table('入力の正規化', [
  ['99,999,999', '9999万9999'],
  ['9999,9999', '9999万9999'],
  ['１２３４', '1234'],
  ['１，２３４', '1234'],
  ['1e8', '1億'],
  ['1.2E+8', '1億2000万'],
  ['−99', '-99'],
  ['－99', '-99'],
  ['ー99', '-99'],
  ['マイナス九十九', '-99'],
  [' 1 234 ', '1234'],
], formatMixed);

table('単位付き入力', [
  ['5百万', '500万'],
  ['1.2億', '1億2000万'],
  ['3.5兆', '3兆5000億'],
  ['1万2千', '1万2000'],
  ['5M', '500万'],
  ['2B', '20億'],
  ['1.5k', '1500'],
], formatMixed);

table('漢数字・大字の逆変換', [
  ['五百万', '500万'],
  ['千二百三十四', '1234'],
  ['一億二千三百四十五万六千七百八十九', '1億2345万6789'],
  ['壱萬', '1万'],
  ['参百弐拾', '320'],
  ['十', '10'],
  ['百', '100'],
  ['二十', '20'],
  ['〇', '0'],
  ['零', '0'],
  ['万', '1万'],
], formatMixed);

test('位取りのない漢数字は警告つきで受ける', () => {
  const r = parse('一二三');
  assert.ok(r.ok);
  assert.equal(formatMixed(r.value), '123');
  assert.equal(r.warnings[0].code, 'POSITIONAL_KANJI');
});

test('末尾の和字は単位とみなして無視する', () => {
  const r = parse('5円');
  assert.ok(r.ok);
  assert.equal(formatMixed(r.value), '5');
  assert.equal(r.warnings[0].code, 'TRAILING_UNIT_IGNORED');
});

test('ラテン接尾辞は解釈したことを警告で伝える', () => {
  const r = parse('5M');
  assert.ok(r.ok);
  assert.equal(r.warnings[0].code, 'SUFFIX_ASSUMED');
});

test('エラーの位置は正規化後ではなく元入力の位置を指す', () => {
  const r = parse('１，２３４X');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'INVALID_CHAR');
  assert.deepEqual(r.span, { start: 5, end: 6 });
  assert.equal('１，２３４X'.slice(r.span.start, r.span.end), 'X');
});

test('サロゲートペアを跨いでもエラー位置がずれない', () => {
  for (const [input, bad] of [['1𥝱X', 'X'], ['𥝱ab', 'a'], ['𥝱𥝱𥝱X', '𥝱']]) {
    const r = parse(input);
    assert.equal(r.ok, false, input);
    assert.equal(input.slice(r.span.start, r.span.end), bad, input);
  }
});

table('指数の先頭ゼロは桁数に数えない', [
  ['1e00000008', '1億'],
  ['1e0008', '1億'],
], formatMixed);

test('掛ける相手のないラテン接尾辞は解釈せずエラーにする', () => {
  for (const input of ['5万k', '5億M']) {
    const r = parse(input);
    assert.equal(r.ok, false, input);
    assert.equal(r.code, 'INVALID_CHAR', input);
  }
});

table('小数があるとき一の位の群は 0 でも出す', [
  ['10000.5', '1万0.5'],
  ['10000', '1万'],
], formatMixed);

test('打ち切って値が 0 になったら小数の桁は残さない', () => {
  const v = value('1e-5000');
  assert.equal(v.int, 0n);
  assert.equal(formatMixed(v), '0');
});

test('エラーコード', () => {
  const cases = [
    ['', 'EMPTY'],
    ['abc', 'INVALID_CHAR'],
    ['5X8', 'INVALID_CHAR'],
    ['1万2億', 'UNIT_ORDER'],
    ['十百', 'UNIT_ORDER'],
    ['1.2.3', 'MULTIPLE_DECIMAL_POINT'],
    ['--1', 'MULTIPLE_SIGN'],
    ['1e', 'BAD_EXPONENT'],
    ['1e999999999', 'OVERFLOW'],
  ];
  for (const [input, code] of cases) {
    const r = parse(input);
    assert.equal(r.ok, false, input);
    assert.equal(r.code, code, input);
  }
});

test('ゼロに負符号は残さない', () => {
  const v = value('-0');
  assert.equal(v.sign, 1);
  assert.equal(formatMixed(v), '0');
});

test('小数は100桁で打ち切る', () => {
  const r = parse('0.' + '1'.repeat(120));
  assert.ok(r.ok);
  assert.equal(r.value.frac.length, 100);
  assert.equal(r.warnings[0].code, 'FRACTION_TRUNCATED');
});

test('出力した表記は自分で読み戻せる', () => {
  const inputs = [
    '0', '1', '9', '10', '100', '1000', '9999', '10000', '10001', '10010', '10100', '11000',
    '99999', '100000', '1000000', '5000000', '10000000', '99999999', '100000000', '100000001',
    '100010000', '123456789', '21000', '1e12', '1e16', '1e20', '1e24', '1e68', '-99', '-123456789',
  ];
  for (const input of inputs) {
    const v = value(input);
    for (const format of [formatMixed, formatGrouped]) {
      const text = format(v);
      if (text === null) continue;
      const back = parse(text);
      assert.ok(back.ok, `${input} -> ${text} -> ${back.code}`);
      assert.equal(back.value.int, v.int, `${input} -> ${text}`);
      assert.equal(back.value.sign, v.sign, `${input} -> ${text}`);
    }
  }
});
