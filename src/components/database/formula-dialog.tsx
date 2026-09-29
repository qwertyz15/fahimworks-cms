"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Sigma } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { PropertyDef } from "@/lib/db-properties";
import { FUNCTIONS, evaluate, formatValue, quoteName, type FType } from "@/lib/formula/engine";
import { FormulaError, MAX_FORMULA_LENGTH } from "@/lib/formula/tokenize";
import { formulaInput, planFormulas } from "@/lib/formula/plan";
import { TYPE_ICONS } from "./property-menu";
import { useRelated } from "./relation-editor";
import type { Row } from "./types";

const TYPE_NAMES: Record<FType, string> = { number: "Number", text: "Text", boolean: "True / false", date: "Date", list: "List", any: "Mixed" };

/** Write a formula: live result on a sample row, the result type, errors at their position. */
export function FormulaDialog({
  def,
  props,
  sample,
  onSave,
  onClose,
}: {
  def: PropertyDef;
  props: PropertyDef[];
  /** A row to preview the result on. */
  sample: Row | null;
  /** Resolves true when saved (the server checks it again). */
  onSave: (expression: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [expr, setExpr] = useState(def.config.formula?.expression ?? "");
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const { related } = useRelated();

  const check = useMemo(() => {
    const defs = props.map((p) => (p.id === def.id ? { ...p, config: { ...p.config, formula: { expression: expr } } } : p));
    const plan = planFormulas(defs);
    const compiled = plan.compiled.get(def.id);
    const cycle = plan.cyclic.get(def.id);
    if (cycle) return { issue: { message: `Circular reference: ${cycle}`, pos: 0 }, type: null, preview: null };
    if (!compiled || !expr.trim()) return { issue: null, type: null, preview: null };
    if (compiled.issues.length) return { issue: compiled.issues[0]!, type: null, preview: null };
    let preview: { value: string } | { error: string } | null = null;
    if (sample && compiled.ast) {
      const titles = new Map(Object.entries(related).map(([id, p]) => [id, p.title]));
      try {
        const v = evaluate(compiled.ast, {
          today: new Date().toISOString().slice(0, 10),
          time: new Date().toISOString().slice(11, 16),
          getProp: (name) => {
            const d = plan.byName.get(name);
            return d ? formulaInput(d, sample, sample.values[d.id], titles) : null;
          },
        });
        preview = { value: v === null ? "(empty)" : formatValue(v) };
      } catch (err) {
        preview = { error: err instanceof FormulaError ? err.message : "Could not calculate." };
      }
    }
    return { issue: null, type: compiled.type, preview };
  }, [expr, props, def.id, sample, related]);

  const insert = (text: string) => {
    const el = box.current;
    const start = el?.selectionStart ?? expr.length;
    const end = el?.selectionEnd ?? expr.length;
    const next = (expr.slice(0, start) + text + expr.slice(end)).slice(0, MAX_FORMULA_LENGTH);
    setExpr(next);
    requestAnimationFrame(() => {
      el?.focus();
      const at = start + text.length;
      el?.setSelectionRange(at, at);
    });
  };

  const save = async () => {
    setBusy(true);
    const ok = await onSave(expr);
    setBusy(false);
    if (ok) onClose();
  };

  const others = props.filter((p) => p.id !== def.id);
  const fn = help ? FUNCTIONS[help] : null;
  const issue = check.issue;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Formula · ${def.name}`}
      description='Use prop("Name") for a property, e.g. prop("Quantity") * prop("Price").'
      className="max-w-3xl"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={busy} disabled={!!issue} onClick={() => void save()}>
            Save formula
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <textarea
          ref={box}
          autoFocus
          value={expr}
          maxLength={MAX_FORMULA_LENGTH}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !issue) {
              e.preventDefault();
              void save();
            }
          }}
          rows={3}
          spellCheck={false}
          aria-label="Formula"
          aria-invalid={!!issue}
          className={cn("w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-[13px] outline-none focus:border-ring", issue && "border-destructive")}
        />
        <div className="min-h-10 rounded-md bg-muted/50 px-3 py-2 text-[13px]" aria-live="polite" data-testid="formula-status">
          {issue ? (
            <div className="space-y-1 text-destructive" role="alert">
              <p className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 shrink-0" /> {issue.message}
              </p>
              {expr && (
                <pre className="overflow-x-auto font-mono text-xs whitespace-pre text-muted-foreground" data-testid="formula-error-at">
                  {expr.slice(Math.max(0, issue.pos - 40), issue.pos)}
                  <mark className="rounded-sm bg-destructive/20 text-destructive underline decoration-wavy">{expr.slice(issue.pos, issue.pos + 1) || " "}</mark>
                  {expr.slice(issue.pos + 1, issue.pos + 40)}
                </pre>
              )}
            </div>
          ) : check.type ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="rounded bg-background px-1.5 py-px text-xs font-medium" data-testid="formula-type">
                {TYPE_NAMES[check.type]}
              </span>
              {check.preview && "value" in check.preview && (
                <span className="min-w-0 truncate" data-testid="formula-preview">
                  <span className="text-muted-foreground">{sample?.title || "Untitled"} → </span>
                  <span className="font-medium">{check.preview.value}</span>
                </span>
              )}
              {check.preview && "error" in check.preview && <span className="text-amber-600 dark:text-amber-400">{check.preview.error}</span>}
              {!sample && <span className="text-muted-foreground">Add a row to preview the result.</span>}
            </div>
          ) : (
            <span className="text-muted-foreground">Type a formula, or pick a property or function below.</span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.2fr]">
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Properties</p>
            <div className="max-h-56 overflow-y-auto">
              {others.map((p) => {
                const Icon = TYPE_ICONS[p.type];
                return (
                  <button key={p.id} type="button" onClick={() => insert(`prop(${quoteName(p.name)})`)} className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[13px] hover:bg-muted">
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" /> <span className="truncate">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Functions</p>
            <div className="max-h-56 overflow-y-auto">
              {Object.keys(FUNCTIONS).map((name) => (
                <button
                  key={name}
                  type="button"
                  onMouseEnter={() => setHelp(name)}
                  onFocus={() => setHelp(name)}
                  onClick={() => insert(`${name}(${FUNCTIONS[name]!.args.length ? "" : ")"}`)}
                  className={cn("flex w-full items-center gap-1.5 rounded px-2 py-1 text-left font-mono text-[12px] hover:bg-muted", help === name && "bg-muted")}
                >
                  <Sigma className="size-3 shrink-0 text-muted-foreground" /> {name}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-md border p-3 text-[13px]">
            {fn && help ? (
              <>
                <p className="font-mono text-xs font-semibold">{help}()</p>
                <p className="mt-1 text-muted-foreground">{fn.help}</p>
                <p className="mt-2 text-[11px] font-medium text-muted-foreground">Example</p>
                <code className="mt-0.5 block rounded bg-muted px-2 py-1 font-mono text-xs break-all">{fn.example}</code>
              </>
            ) : (
              <div className="space-y-1.5 text-muted-foreground">
                <p>
                  Operators: <code className="font-mono text-xs">+ - * / % ^</code>, <code className="font-mono text-xs">== != &lt; &gt; &lt;= &gt;=</code>, <code className="font-mono text-xs">and or not</code>.
                </p>
                <p>
                  Text goes in quotes: <code className="font-mono text-xs">&quot;Done&quot;</code>. <code className="font-mono text-xs">+</code> also joins text.
                </p>
                <p>Hover a function to see how to use it.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
