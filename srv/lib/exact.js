// Exact rational arithmetic for quantities and money (no binary floating point).

const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };

export class Exact {
  constructor(num, den = 1n) {
    if (den === 0n) throw new RangeError('division by zero');
    if (den < 0n) { num = -num; den = -den; }
    const g = gcd(num, den) || 1n;
    this.num = num / g;
    this.den = den / g;
  }

  /** Parses a plain decimal string or number such as "42", "-3", "0.35". Rejects exponents and NaN. */
  static of(value) {
    if (value instanceof Exact) return value;
    const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
    const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) throw new TypeError(`not a plain decimal: ${JSON.stringify(value)}`);
    const [, sign, int, frac = ''] = match;
    const num = BigInt(int + frac) * (sign === '-' ? -1n : 1n);
    return new Exact(num, 10n ** BigInt(frac.length));
  }

  add(o) { o = Exact.of(o); return new Exact(this.num * o.den + o.num * this.den, this.den * o.den); }
  sub(o) { o = Exact.of(o); return new Exact(this.num * o.den - o.num * this.den, this.den * o.den); }
  mul(o) { o = Exact.of(o); return new Exact(this.num * o.num, this.den * o.den); }
  div(o) { o = Exact.of(o); return new Exact(this.num * o.den, this.den * o.num); }
  cmp(o) { o = Exact.of(o); const d = this.num * o.den - o.num * this.den; return d > 0n ? 1 : d < 0n ? -1 : 0; }
  isZero() { return this.num === 0n; }
  isInteger() { return this.den === 1n; }
  abs() { return new Exact(this.num < 0n ? -this.num : this.num, this.den); }

  /** Fixed-point string, rounded half away from zero. */
  toFixed(scale) {
    const factor = 10n ** BigInt(scale);
    const neg = this.num < 0n;
    const n = (neg ? -this.num : this.num) * factor;
    let q = n / this.den;
    if ((n % this.den) * 2n >= this.den) q += 1n;
    const digits = q.toString().padStart(scale + 1, '0');
    const text = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
    return neg && q !== 0n ? `-${text}` : text;
  }

  /** Shortest exact decimal string; throws for non-terminating fractions. */
  toPlain() {
    let den = this.den, scale = 0;
    while (den % 10n === 0n) { den /= 10n; scale++; }
    while (den % 2n === 0n || den % 5n === 0n) { den = den % 2n === 0n ? den / 2n : den / 5n; scale++; }
    if (den !== 1n) throw new RangeError('non-terminating decimal');
    return this.toFixed(scale).replace(/^(-?\d+)\.(\d*?)0+$/, (m, i, f) => f ? `${i}.${f}` : i);
  }
}
