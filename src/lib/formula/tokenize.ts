/** Formula tokens. Friendly symbols (× ÷ − ≤ ≥ ≠) are accepted as their ASCII operators. */
export type Token =
  | { t: "num"; v: number; pos: number }
  | { t: "str"; v: string; pos: number }
  | { t: "id"; v: string; pos: number }
  | { t: "op"; v: string; pos: number }
  | { t: "eof"; pos: number };

export class FormulaError extends Error {
  constructor(
    message: string,
    public pos: number,
  ) {
    super(message);
    this.name = "FormulaError";
  }
}

export const MAX_FORMULA_LENGTH = 1000;

const ALIASES: Record<string, string> = { "×": "*", "÷": "/", "−": "-", "≤": "<=", "≥": ">=", "≠": "!=", "&&": "and", "||": "or" };
const TWO = ["==", "!=", "<=", ">=", "&&", "||"];
const ONE = "+-*/%^()<>,!×÷−≤≥≠";

export function tokenize(src: string): Token[] {
  if (src.length > MAX_FORMULA_LENGTH) throw new FormulaError(`Formulas can be up to ${MAX_FORMULA_LENGTH} characters.`, MAX_FORMULA_LENGTH);
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c) && /[0-9]/.test(c === "." ? (src[i + 1] ?? "") : c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "“" || c === "”") {
      const start = i;
      let v = "";
      i++;
      while (i < src.length && src[i] !== '"' && src[i] !== "”" && src[i] !== "“") {
        if (src[i] === "\\" && i + 1 < src.length) {
          const n = src[i + 1]!;
          v += n === "n" ? "\n" : n === "t" ? "\t" : n;
          i += 2;
        } else v += src[i++];
      }
      if (i >= src.length) throw new FormulaError("Missing closing quote.", start);
      i++;
      out.push({ t: "str", v, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO.includes(two)) {
      out.push({ t: "op", v: ALIASES[two] ?? two, pos: i });
      i += 2;
      continue;
    }
    if (ONE.includes(c)) {
      out.push({ t: "op", v: ALIASES[c] ?? c, pos: i });
      i++;
      continue;
    }
    throw new FormulaError(`Unexpected “${c}”.`, i);
  }
  out.push({ t: "eof", pos: src.length });
  return out;
}
