import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { EXP_DOCS, rpc, useRefresh, useTrades } from "@/lib/api";
import { money, errMsg } from "@/lib/format";
import { EXP_FIELDS, EXP_GROUPS, fieldValue, isRequired, missingFields, type ExpField } from "@/lib/expFields";
import type { Exp } from "@/lib/types";
import { Button, Chip, Field, Input, Modal, cn } from "./ui";
import { TradePicker } from "./pickers";

type Values = Record<string, string>;
/** Filled from the trade when left empty. */
const AUTO_KEYS = ["lc_contract", "importer"];

/** One EXP; the type only decides which fields are required now. */
function TypeSwitch({ regular, onChange, lockAdvance }: { regular: boolean; onChange: (r: boolean) => void; lockAdvance?: boolean }) {
  const opts = [
    { r: false, label: "Advance", sub: "Shipment details come later" },
    { r: true, label: "Regular", sub: "All details known now" },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="lbl">EXP type</div>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-raised p-1 sm:max-w-md">
        {opts.map((o) => (
          <button
            key={o.label}
            type="button"
            disabled={lockAdvance && !o.r}
            onClick={() => onChange(o.r)}
            aria-pressed={regular === o.r}
            className={cn(
              "rounded-lg px-3 py-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40",
              regular === o.r ? "bg-surface shadow-sm ring-1 ring-line" : "text-mut hover:text-fg",
            )}
          >
            <div className="text-[0.8438rem] font-medium">{o.label}</div>
            <div className="text-[0.7188rem] text-mut">{o.sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function FieldInput({ f, value, onChange, locked, required, later, placeholder }: { f: ExpField; value: string; onChange: (v: string) => void; locked?: boolean; required?: boolean; later?: boolean; placeholder?: string }) {
  const unit = f.hint === "USD" || f.hint === "KG" ? f.hint : undefined;
  return (
    <Field
      label={
        <span className="inline-flex items-center gap-1.5">
          {f.label}
          {required && <span className="text-accent">*</span>}
          {unit && <span className="text-[0.7188rem] font-normal text-mut">({unit})</span>}
          {later && <span className="text-[0.6875rem] font-normal text-mut">for Regular</span>}
          {locked && <Lock className="size-3 text-mut" aria-label="Locked" />}
        </span>
      }
      hint={f.hint && !unit ? f.hint : undefined}
    >
      <Input
        type={f.kind === "date" ? "date" : f.kind === "number" || f.kind === "year" ? "number" : "text"}
        inputMode={f.kind === "number" ? "decimal" : f.kind === "year" ? "numeric" : undefined}
        step={f.kind === "number" ? "any" : undefined}
        value={value}
        placeholder={placeholder ?? f.placeholder}
        disabled={locked}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** All EXP fields grouped by meaning. Required markers follow the type. Locked keys are read-only. */
function ExpFieldsForm({ values, onChange, regular, lockedKeys = [], hideAmount, defaults }: { values: Values; onChange: (v: Values) => void; regular: boolean; lockedKeys?: string[]; hideAmount?: boolean; defaults?: Values }) {
  return (
    <div className="flex flex-col gap-5">
      {EXP_GROUPS.map((g) => {
        const fields = EXP_FIELDS.filter((f) => f.group === g.key && !(hideAmount && f.key === "amount"));
        const need = (f: ExpField) => isRequired(f, regular) && !defaults?.[f.key] && !(defaults && AUTO_KEYS.includes(f.key));
        const req = fields.filter(need);
        const done = req.filter((f) => (values[f.key] ?? "").trim()).length;
        return (
          <section key={g.key} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5">
              <div className="text-[0.8438rem] font-semibold">{g.title}</div>
              {req.length > 0 && <div className={cn("num text-[0.7188rem]", done === req.length ? "text-ok" : "text-mut")}>{done}/{req.length} required</div>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {fields.map((f) => (
                <FieldInput
                  key={f.key}
                  f={f}
                  value={values[f.key] ?? ""}
                  onChange={(v) => onChange({ ...values, [f.key]: v })}
                  locked={lockedKeys.includes(f.key)}
                  required={need(f)}
                  later={!regular && f.stage === "regular"}
                  placeholder={defaults?.[f.key] || undefined}
                />
              ))}
            </div>
          </section>
        );
      })}
      <p className="text-[0.75rem] text-mut">* required for this type. Fields with a lock cannot change once saved.</p>
    </div>
  );
}

const clean = (v: Values) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()]).filter(([, x]) => x !== ""));

export function AddExpDialog({ open, onOpenChange, tradeId: fixedTradeId, available: fixedAvailable, tolerance: fixedTolerance }: { open: boolean; onOpenChange: (o: boolean) => void; tradeId?: string; available?: number; tolerance?: number | string | null }) {
  const refresh = useRefresh();
  const { data: allTrades } = useTrades();
  const [pick, setPick] = useState("");
  const activeTrades = (allTrades ?? [])
    .filter((t) => t.status === "active" && t.contract_signed !== false)
    .map((t) => ({ ...t, left: Number(t.contract_amount) - Number(t.exp_issued ?? 0) }));
  const tradeId = fixedTradeId ?? pick;
  const trade = (allTrades ?? []).find((t) => t.id === tradeId);
  const available = fixedTradeId ? fixedAvailable ?? 0 : activeTrades.find((t) => t.id === pick)?.left ?? 0;
  const tolerance = fixedTradeId ? fixedTolerance : trade?.tolerance_pct;
  const navigate = useNavigate();
  const [values, setValues] = useState<Values>({ exp_year: String(new Date().getFullYear()), unit_iso: "KGM", incoterm: "CFR" });
  const [regular, setRegular] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = Number(values.amount || 0);
  const over = n > available + 0.0001;
  const missing = missingFields(values, regular);
  const valid = !!tradeId && n > 0 && !over && missing.length === 0;
  const defaults: Values = { lc_contract: trade?.sales_contract_no ?? "", importer: trade?.importer_name ?? "" };
  async function submit() {
    setBusy(true);
    try {
      const { amount, ...fields } = clean(values);
      const id = await rpc<string>("create_exp", { p_trade: tradeId, p_amount: Number(amount), p_advance: !regular, p_fields: fields });
      toast.success("EXP added");
      refresh();
      onOpenChange(false);
      setValues({ exp_year: String(new Date().getFullYear()), unit_iso: "KGM", incoterm: "CFR" });
      setRegular(false);
      setPick("");
      navigate(`/exps/${id}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      xwide
      title="Add EXP"
      description="Same EXP for both types. Advance needs 11 fields now and the rest later; Regular needs all 23. For many EXPs at once, use Import."
      footer={
        <>
          {missing.length > 0 && <span className="mr-auto self-center text-[0.75rem] text-mut">Still needed: {missing.join(", ")}</span>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid} loading={busy} onClick={submit}>Add EXP</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {!fixedTradeId && (
          <Field label="Trade / sales contract" required hint={activeTrades.length ? "Only approved trades with a signed contract are listed." : "No active trades yet."}>
            <TradePicker trades={activeTrades} value={pick} onChange={setPick} extra={(t) => `left ${money(t.left)}`} />
          </Field>
        )}
        <TypeSwitch regular={regular} onChange={setRegular} />
        <div className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[0.8125rem]">
          Available on this contract <span className="num font-medium">{money(available)}</span>
          {n > 0 && <> · after this EXP <span className={cn("num font-medium", over && "text-bad")}>{money(available - n)}</span></>}
          {tolerance ? <span className="text-mut"> · Tolerance {Number(tolerance)}%: new EXPs go up to the contract amount; a higher shipped value goes through Change amount.</span> : null}
        </div>
        <ExpFieldsForm values={values} onChange={setValues} regular={regular} defaults={defaults} />
        <div>
          <div className="lbl mb-2">Documents tracked for this EXP</div>
          <div className="flex flex-wrap gap-1.5">{EXP_DOCS.map((d) => <Chip key={d} label={d} tone="gray" dot={false} />)}</div>
        </div>
      </div>
    </Modal>
  );
}

export function EditExpDialog({ exp, onClose }: { exp: Exp; available?: number; onClose: () => void }) {
  const refresh = useRefresh();
  const initial: Values = Object.fromEntries(EXP_FIELDS.map((f) => [f.key, fieldValue(exp, f.key)]));
  const [values, setValues] = useState<Values>(initial);
  const [regular, setRegular] = useState(exp.type === "regular");
  const [busy, setBusy] = useState(false);
  const lockedKeys = EXP_FIELDS.filter((f) => f.locked && initial[f.key]).map((f) => f.key);
  const missing = missingFields({ ...values, amount: String(exp.amount) }, regular, []);
  const becomingRegular = regular && exp.type === "advance";
  const valid = !becomingRegular || missing.length === 0;
  async function submit() {
    setBusy(true);
    try {
      const changed = Object.fromEntries(EXP_FIELDS.filter((f) => f.key !== "amount" && (values[f.key] ?? "").trim() !== (initial[f.key] ?? "")).map((f) => [f.key, (values[f.key] ?? "").trim()]));
      if (becomingRegular) changed.type = "regular";
      await rpc("update_exp", { p_id: exp.id, p_amount: null, p_fields: changed });
      toast.success(becomingRegular ? "EXP is now a Regular EXP" : "EXP updated");
      refresh();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      xwide
      title={<span className="code-id">Edit {exp.code}</span>}
      description="Fill in or correct the EXP fields. Locked fields cannot change. Amount Inv changes through Change amount (reason, document and admin approval)."
      footer={
        <>
          {becomingRegular && missing.length > 0 && <span className="mr-auto self-center text-[0.75rem] text-mut">For a Regular EXP, still needed: {missing.join(", ")}</span>}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} loading={busy} onClick={submit}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <TypeSwitch regular={regular} onChange={setRegular} lockAdvance={exp.type === "regular"} />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[0.8125rem]">
          <span className="text-mut">Amount Inv</span>
          <span className="num font-medium">
            {money(exp.amount)}
            {exp.issued_amount !== undefined && Number(exp.issued_amount) !== Number(exp.amount) && <span className="ml-2 font-normal text-mut">issued {money(exp.issued_amount)}</span>}
          </span>
        </div>
        <ExpFieldsForm values={values} onChange={setValues} regular={regular} lockedKeys={lockedKeys} hideAmount />
      </div>
    </Modal>
  );
}
