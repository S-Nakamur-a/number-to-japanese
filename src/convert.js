// 漢数字・大字は出力しないが入力としては受けるので、対応表は消さないこと。

const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const DAIJI_DIGITS = ['零', '壱', '弐', '参', '四', '五', '六', '七', '八', '九'];

const BIG_UNITS = [
  { power: 4, kanji: '万' },
  { power: 8, kanji: '億' },
  { power: 12, kanji: '兆' },
  { power: 16, kanji: '京' },
  { power: 20, kanji: '垓' },
  { power: 24, kanji: '𥝱' },
  { power: 28, kanji: '穣' },
  { power: 32, kanji: '溝' },
  { power: 36, kanji: '澗' },
  { power: 40, kanji: '正' },
  { power: 44, kanji: '載' },
  { power: 48, kanji: '極' },
  { power: 52, kanji: '恒河沙' },
  { power: 56, kanji: '阿僧祇' },
  { power: 60, kanji: '那由他' },
  { power: 64, kanji: '不可思議' },
  { power: 68, kanji: '無量大数' },
];

const NAMED_LIMIT = 10n ** 72n; // 無量大数(10^68) × 9999 の次
const ENGLISH_WORDS = ['', 'thousand', 'million', 'billion', 'trillion'];
const ENGLISH_LIMIT_DIGITS = 15; // trillion より上に読める語がない

const PARSE_DIGITS = new Map();
KANJI_DIGITS.forEach((c, v) => PARSE_DIGITS.set(c, v));
DAIJI_DIGITS.forEach((c, v) => PARSE_DIGITS.set(c, v));

const PARSE_SMALL = new Map([
  ['十', 1], ['拾', 1], ['百', 2], ['佰', 2], ['千', 3], ['仟', 3], ['阡', 3],
]);

const PARSE_BIG = new Map([
  ...BIG_UNITS.map((u) => [u.kanji, u.power]),
  ['萬', 4], ['秭', 24], ['杼', 24],
]);

const PARSE_LATIN = new Map([
  ['k', 3], ['K', 3], ['M', 6], ['m', 6], ['B', 9], ['b', 9], ['G', 9], ['g', 9], ['T', 12],
]);

const LATIN_LABEL = { 3: '千', 6: '100万', 9: '10億', 12: '1兆' };

const MAX_FRACTION_DIGITS = 100;
const MAX_EXPONENT = 5000;

const DASHES = new Set(['-', '−', '－', '‐', '‑', '–', '—', '―']);
const DROPPED = new Set([',', '，', '､', '、', '_', ' ', '　', '\t', ' ']);

const WIDE = new Map();
for (let i = 0; i < 10; i++) WIDE.set(String.fromCharCode(0xff10 + i), String(i));
for (let i = 0; i < 26; i++) {
  WIDE.set(String.fromCharCode(0xff21 + i), String.fromCharCode(65 + i));
  WIDE.set(String.fromCharCode(0xff41 + i), String.fromCharCode(97 + i));
}
WIDE.set('．', '.');
WIDE.set('＋', '+');

/**
 * map[i] は text[i] が元入力の何文字目か。エラー位置を元入力の上で示すために要る。
 * NFKC を一括で当てないのは ㈱→(株) で長さが変わり対応が壊れるため。
 */
function normalize(input) {
  let text = '';
  const map = [];
  let at = 0;
  for (const ch of input) {
    const start = at;
    at += ch.length;
    if (DROPPED.has(ch)) continue;
    let out = ch;
    if (DASHES.has(ch)) out = '-';
    else if (ch === 'ー' && text === '') out = '-'; // 長音符は先頭のときだけマイナスの打ち間違いとみなす
    else if (WIDE.has(ch)) out = WIDE.get(ch);
    if (out === 'E') out = 'e';
    text += out;
    // コードポイント単位だと 𥝱 (U+25771) で以降が1つずれる
    for (let i = 0; i < out.length; i++) map.push(start);
  }
  map.push(input.length);
  return { text, map };
}

const isDigit = (c) => c >= '0' && c <= '9';
const isJapaneseChar = (ch) => /[぀-ヿ㐀-鿿豈-﫿]|[\ud840-\ud87f]/.test(ch);

const decMulPow = (d, p) => ({ u: d.u, e: d.e + p });

function decAdd(a, b) {
  if (a.u === 0n) return b;
  if (b.u === 0n) return a;
  const e = Math.min(a.e, b.e);
  return { u: a.u * 10n ** BigInt(a.e - e) + b.u * 10n ** BigInt(b.e - e), e };
}

function scanNumber(text, j) {
  const start = j;
  let mant = '';
  let exp = 0;
  let sawDigit = false;
  while (isDigit(text[j])) {
    mant += text[j];
    j++;
    sawDigit = true;
  }
  if (text[j] === '.') {
    j++;
    let f = '';
    while (isDigit(text[j])) {
      f += text[j];
      j++;
    }
    mant += f;
    exp -= f.length;
    sawDigit = sawDigit || f.length > 0;
  }
  if (!sawDigit) return null;
  if (text[j] === '.') return { bad: 'MULTIPLE_DECIMAL_POINT', start: j, end: j + 1 };
  if (text[j] === 'e') {
    let k = j + 1;
    let es = 1;
    if (text[k] === '+' || text[k] === '-') {
      if (text[k] === '-') es = -1;
      k++;
    }
    let ed = '';
    while (isDigit(text[k])) {
      ed += text[k];
      k++;
    }
    if (!ed) return { bad: 'BAD_EXPONENT', start: j, end: k };
    const size = ed.replace(/^0+/, '');
    if (size.length > 6 || Number(size) > MAX_EXPONENT) return { bad: 'OVERFLOW', start: j, end: k };
    exp += es * Number(ed);
    j = k;
  }
  return { dec: { u: BigInt(mant), e: exp }, start, end: j };
}

const MESSAGES = {
  EMPTY: '数を入力してください',
  INVALID_CHAR: (s) => `「${s}」が読めません`,
  UNIT_ORDER: (s) => `「${s}」の位の順序が不正です`,
  MULTIPLE_DECIMAL_POINT: '小数点が複数あります',
  MULTIPLE_SIGN: '符号が複数あります',
  BAD_EXPONENT: '指数の指定が不完全です',
  OVERFLOW: '大きすぎて扱えません',
};

export function parse(input) {
  const { text, map } = normalize(input);
  const warnings = [];
  const span = (from, to) => ({ start: map[from], end: map[Math.min(to, map.length - 1)] });
  const fail = (code, from, to) => {
    const raw = input.slice(map[from], map[Math.min(to, map.length - 1)]);
    const message = MESSAGES[code];
    return { ok: false, code, message: typeof message === 'function' ? message(raw) : message, span: span(from, to), input };
  };
  const warn = (code, message, from, to) => {
    if (warnings.some((w) => w.code === code)) return;
    warnings.push({ code, message, span: from === undefined ? undefined : span(from, to) });
  };

  if (text === '') return fail('EMPTY', 0, 0);

  let j = 0;
  let sign = 1;
  let signs = 0;
  for (;;) {
    if (text[j] === '-' || text[j] === '+') {
      if (text[j] === '-') sign = -sign;
      signs++;
      j++;
    } else if (text.startsWith('マイナス', j)) {
      sign = -sign;
      signs++;
      j += 4;
    } else break;
  }
  if (signs > 1) return fail('MULTIPLE_SIGN', 0, j);

  let result = { u: 0n, e: 0 };
  let group = { u: 0n, e: 0 };
  let pending = null;
  let pendingIsKanji = false;
  let prevSmall = Infinity;
  let prevBig = Infinity;
  let sawAny = false;

  const flushGroup = () => decAdd(group, pending ?? { u: 0n, e: 0 });

  while (j < text.length) {
    const ch = text[j];

    if (isDigit(ch) || ch === '.') {
      const n = scanNumber(text, j);
      if (!n) return fail('INVALID_CHAR', j, j + 1);
      if (n.bad) return fail(n.bad, n.start, n.end);
      if (pending !== null) return fail('INVALID_CHAR', n.start, n.end);
      pending = n.dec;
      pendingIsKanji = false;
      sawAny = true;
      j = n.end;
      continue;
    }

    if (PARSE_DIGITS.has(ch)) {
      const v = BigInt(PARSE_DIGITS.get(ch));
      if (pending !== null) {
        if (!pendingIsKanji) return fail('INVALID_CHAR', j, j + 1);
        warn('POSITIONAL_KANJI', '位取りのない漢数字として解釈しました', j, j + 1);
        pending = decAdd(decMulPow(pending, 1), { u: v, e: 0 });
      } else {
        pending = { u: v, e: 0 };
      }
      pendingIsKanji = true;
      sawAny = true;
      j++;
      continue;
    }

    const big = matchBigUnit(text, j);
    if (big) {
      if (big.power >= prevBig) return fail('UNIT_ORDER', j, big.end);
      const coefficient = pending === null && group.u === 0n ? { u: 1n, e: 0 } : flushGroup();
      result = decAdd(result, decMulPow(coefficient, big.power));
      group = { u: 0n, e: 0 };
      pending = null;
      pendingIsKanji = false;
      prevSmall = Infinity;
      prevBig = big.power;
      sawAny = true;
      j = big.end;
      continue;
    }

    const small = PARSE_SMALL.get(ch);
    if (small !== undefined) {
      if (small >= prevSmall) return fail('UNIT_ORDER', j, j + 1);
      group = decAdd(group, decMulPow(pending ?? { u: 1n, e: 0 }, small));
      pending = null;
      pendingIsKanji = false;
      prevSmall = small;
      sawAny = true;
      j++;
      continue;
    }

    const latin = PARSE_LATIN.get(ch);
    if (latin !== undefined && sawAny) {
      if (latin >= prevBig) return fail('UNIT_ORDER', j, j + 1);
      // 大単位と違って暗黙の1を持たない
      if (pending === null && group.u === 0n) return fail('INVALID_CHAR', j, j + 1);
      warn('SUFFIX_ASSUMED', `${ch} は ${LATIN_LABEL[latin]} として解釈しました`, j, j + 1);
      result = decAdd(result, decMulPow(flushGroup(), latin));
      group = { u: 0n, e: 0 };
      pending = null;
      prevSmall = Infinity;
      prevBig = latin;
      j++;
      continue;
    }

    // ラテン字は k/M/B/G/T が意味を持つので、和字と違って黙って捨てずエラーにする。
    if (sawAny && isJapaneseChar(ch)) {
      warn('TRAILING_UNIT_IGNORED', `「${input.slice(map[j])}」を単位とみなして無視しました`, j, text.length);
      break;
    }
    return fail('INVALID_CHAR', j, j + 1);
  }

  if (!sawAny) return fail('INVALID_CHAR', 0, text.length);

  result = decAdd(result, flushGroup());
  const value = toJNum(result, sign, warn);
  if (value === null) return fail('OVERFLOW', 0, text.length);
  return { ok: true, value, warnings };
}

function matchBigUnit(text, j) {
  for (let len = 4; len >= 1; len--) {
    const sub = text.substr(j, len);
    if (PARSE_BIG.has(sub)) return { power: PARSE_BIG.get(sub), end: j + len };
  }
  return null;
}

function toJNum(dec, sign, warn) {
  const { u, e } = dec;
  if (u === 0n) return { sign: 1, int: 0n, frac: '' };
  let int;
  let frac = '';
  if (e >= 0) {
    if (e + u.toString().length > MAX_EXPONENT) return null;
    int = u * 10n ** BigInt(e);
  } else {
    let s = u.toString();
    const k = -e;
    if (s.length <= k) s = '0'.repeat(k - s.length + 1) + s;
    int = BigInt(s.slice(0, s.length - k));
    frac = s.slice(s.length - k);
  }
  let truncated = false;
  if (frac.length > MAX_FRACTION_DIGITS) {
    warn('FRACTION_TRUNCATED', `小数第${MAX_FRACTION_DIGITS}位で打ち切りました`);
    frac = frac.slice(0, MAX_FRACTION_DIGITS);
    truncated = true;
  }
  // 値が 0 なら小数の桁は情報を持たない
  if (int === 0n && !/[1-9]/.test(frac)) return { sign: 1, int: 0n, frac: truncated ? '' : frac };
  return { sign, int, frac };
}

function split(n, per) {
  if (n === 0n) return [0];
  const chunk = BigInt(10 ** per);
  const out = [];
  let rest = n;
  while (rest > 0n) {
    out.push(Number(rest % chunk));
    rest /= chunk;
  }
  return out;
}

const withSign = (v, body) => (v.sign < 0 ? '-' : '') + body;
const withFraction = (v, body) => body + (v.frac ? '.' + v.frac : '');

export function formatMixed(v) {
  if (v.int >= NAMED_LIMIT) return null;
  const groups = split(v.int, 4);
  let body = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    // 10000.5 を「1万.5」と出すと 1.5万 と読み違える
    if (groups[i] === 0 && !(i === 0 && v.frac)) continue;
    body += String(groups[i]) + (i === 0 ? '' : BIG_UNITS[i - 1].kanji);
  }
  return withSign(v, withFraction(v, body || '0'));
}

export function formatGrouped(v) {
  const s = v.int.toString();
  let body = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) body += ',';
    body += s[i];
  }
  return withSign(v, withFraction(v, body));
}

export function formatEnglish(v) {
  const digits = v.int.toString();
  if (digits.length > ENGLISH_LIMIT_DIGITS) {
    const mantissa = (digits[0] + '.' + digits.slice(1, 3)).replace(/\.?0+$/, '');
    const exact = !/[1-9]/.test(digits.slice(3)) && !v.frac;
    return (exact ? '' : '≈ ') + withSign(v, `${mantissa} × 10^${digits.length - 1}`);
  }
  if (v.int < 10000n) return formatGrouped(v); // 万を使わない大きさなら英語でも語を使わない

  const groups = split(v.int, 3);
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0 && !(i === 0 && v.frac)) continue;
    parts.push(`${groups[i]}${i === 0 ? '' : ' ' + ENGLISH_WORDS[i]}`);
  }
  return withSign(v, withFraction(v, parts.join(' ')));
}

export function formatAll(v) {
  return { mixed: formatMixed(v), grouped: formatGrouped(v), english: formatEnglish(v) };
}

/** UI が万・億・兆を強調表示するのに使う。 */
export const BIG_UNIT_RE = new RegExp(
  `(${BIG_UNITS.map((u) => u.kanji).sort((a, b) => b.length - a.length).join('|')})`,
  'g',
);
