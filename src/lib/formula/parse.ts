import { FormulaError, tokenize, type Token } from "./tokenize";

export type Node =
  | { k: "num"; v: number; pos: number }
  | { k: "str"; v: string; pos: number }
  | { k: "bool"; v: boolean; pos: number }
  | { k: "prop"; name: string; pos: number }
  | { k: "call"; fn: string; args: Node[]; pos: number }
  | { k: "bin"; op: string; a: Node; b: Node; pos: number }
  | { k: "un"; op: "-" | "not"; a: Node; pos: number };

export const MAX_DEPTH = 50;

// Binding power: or < and < comparison < + - < * / % < ^ (right) < unary
const INFIX: Record<string, [number, number]> = {
  or: [1, 2],
  and: [3, 4],
  "==": [5, 6],
  "!=": [5, 6],
  "<": [5, 6],
  "<=": [5, 6],
  ">": [5, 6],
  ">=": [5, 6],
  "+": [7, 8],
  "-": [7, 8],
  "*": [9, 10],
  "/": [9, 10],
  "%": [9, 10],
  "^": [12, 11],
};

/** Parse a formula into a syntax tree (Pratt parser). Throws FormulaError with a position. */
export function parse(src: string): Node {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i]!;
  const next = () => toks[i++]!;
  const opOf = (t: Token) => (t.t === "op" ? t.v : t.t === "id" && (t.v === "and" || t.v === "or") ? t.v : null);

  const expr = (minBp: number, depth: number): Node => {
    if (depth > MAX_DEPTH) throw new FormulaError("This formula is nested too deeply.", peek().pos);
    let left = prefix(depth);
    for (;;) {
      const t = peek();
      const op = opOf(t);
      if (!op || !(op in INFIX)) break;
      const [l, r] = INFIX[op]!;
      if (l < minBp) break;
      next();
      const right = expr(r, depth + 1);
      left = { k: "bin", op, a: left, b: right, pos: t.pos };
    }
    return left;
  };

  const prefix = (depth: number): Node => {
    const t = next();
    if (t.t === "num") return { k: "num", v: t.v, pos: t.pos };
    if (t.t === "str") return { k: "str", v: t.v, pos: t.pos };
    if (t.t === "op" && t.v === "(") {
      const e = expr(0, depth + 1);
      expect(")", "Missing closing “)”.");
      return e;
    }
    if (t.t === "op" && t.v === "-") return { k: "un", op: "-", a: expr(13, depth + 1), pos: t.pos };
    if ((t.t === "op" && t.v === "!") || (t.t === "id" && t.v === "not")) return { k: "un", op: "not", a: expr(5, depth + 1), pos: t.pos };
    if (t.t === "id") {
      if (t.v === "true" || t.v === "false") return { k: "bool", v: t.v === "true", pos: t.pos };
      const p = peek();
      if (p.t !== "op" || p.v !== "(") throw new FormulaError(`Unknown name “${t.v}”. Use prop("${t.v}") for a property.`, t.pos);
      next();
      const args: Node[] = [];
      if (!(peek().t === "op" && (peek() as { v: string }).v === ")")) {
        for (;;) {
          args.push(expr(0, depth + 1));
          const s = peek();
          if (s.t === "op" && s.v === ",") {
            next();
            continue;
          }
          break;
        }
      }
      expect(")", `Missing “)” after the arguments of ${t.v}().`);
      if (t.v === "prop") {
        const a = args[0];
        if (args.length !== 1 || a?.k !== "str") throw new FormulaError('prop() takes a property name in quotes, e.g. prop("Price").', t.pos);
        return { k: "prop", name: a.v, pos: t.pos };
      }
      return { k: "call", fn: t.v, args, pos: t.pos };
    }
    if (t.t === "eof") throw new FormulaError("The formula ends too early.", t.pos);
    throw new FormulaError(`Unexpected “${t.t === "op" ? t.v : "token"}”.`, t.pos);
  };

  const expect = (v: string, msg: string) => {
    const t = next();
    if (t.t !== "op" || t.v !== v) throw new FormulaError(msg, t.pos);
  };

  const root = expr(0, 0);
  const end = peek();
  if (end.t !== "eof") throw new FormulaError("Unexpected text after the end of the formula.", end.pos);
  return root;
}

/** Property names a formula reads. */
export function referencedProps(n: Node, out = new Set<string>()): Set<string> {
  if (n.k === "prop") out.add(n.name);
  else if (n.k === "call") n.args.forEach((a) => referencedProps(a, out));
  else if (n.k === "bin") {
    referencedProps(n.a, out);
    referencedProps(n.b, out);
  } else if (n.k === "un") referencedProps(n.a, out);
  return out;
}

/** Whether it uses now() / today() (its result changes over time). */
export function isVolatile(n: Node): boolean {
  if (n.k === "call") return n.fn === "now" || n.fn === "today" || n.args.some(isVolatile);
  if (n.k === "bin") return isVolatile(n.a) || isVolatile(n.b);
  if (n.k === "un") return isVolatile(n.a);
  return false;
}
