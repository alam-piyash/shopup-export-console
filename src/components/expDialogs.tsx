import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { EXP_DOCS, rpc, useRefresh, useTrades } from "@/lib/api";
import { money, errMsg } from "@/lib/format";
import { EXP_FIELDS, fieldValue, isRequired, missingFields, type ExpField } from "@/lib/expFields";
import type { Exp } from "@/lib/types";
import { Button, Chip, Field, Input, Modal, cn } from "./ui";
import { TradePicker } from "./pickers";

type Values = Record<string, string>;

function TypeSwitch({ duplicate, onChange, lockAdvance }: { duplicate: boolean; onChange: (d: boolean) => void; lockAdvance?: boolean }) {
  const opts = [
    { d: false, label: "Advance EXP", sub: "11 fields now, the rest later" },
    { d: true, label: "Duplicate EXP", sub: "All 23 fields" },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-raised p-1">
      {opts.map((o) => (
        <button
          key={o.label}
          type="button"
          disabled={lockAdvance && !o.d}
          onClick={() => onChange(o.d)}
          className={cn(
            "rounded-lg px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40",
            duplicate === o.d ? "bg-surface shadow-sm ring-1 ring-line" : "text-mut hover:text-fg",
          )}
        >
          <div className="text-[0.8438rem] font-medium">{o.label}</div>
          <div className="text-[0.7188rem] text-mut">{o.sub}</div>
        </button>
      ))}
    </div>
  );
}

function FieldInput({ f, value, onChange, locked, required, placeholder }: { f: ExpField; value: string; onChange: (v: string) => void; locked?: boolean; required?: boolean; placeholder?: string }) {
  return (
    <Field
      label={
        <span className="inline-flex items-center gap-1.5">
          {f.label}
          {required && <span className="text-accent">*</span>}
          {f.hint === "USD" && <span className="text-[0.7188rem] font-normal text-mut">(USD)</span>}
          {locked && <Lock className="size-3 text-mut" aria-label="Locked" />}
        </span>
      }
      hint={f.hint && f.hint !== "USD" ? f.hint : undefined}
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

/** The template fields in two groups. Locked keys are read-only; amount can be hidden (edit uses Change amount). */
function ExpFieldsForm({ values, onChange, duplicate, lockedKeys = [], hideAmount, defaults }: { values: Values; onChange: (v: Values) => void; duplicate: boolean; lockedKeys?: string[]; hideAmount?: boolean; defaults?: Values }) {
  const group = (stage: ExpField["stage"], title: string, sub: string) => (
    <section className="flex flex-col gap-3">
      <div>
        <div className="text-[0.8438rem] font-semibold">{title}</div>
        <div className="text-[0.75rem] text-mut">{sub}</div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {EXP_FIELDS.filter((f) => f.stage === stage && !(hideAmount && f.key === "amount")).map((f) => (
          <FieldInput
            key={f.key}
            f={f}
            value={values[f.key] ?? ""}
            onChange={(v) => onChange({ ...values, [f.key]: v })}
            locked={lockedKeys.includes(f.key)}
            required={isRequired(f, duplicate) && !(defaults?.[f.key])}
            placeholder={defaults?.[f.key] || undefined}
          />
        ))}
      </div>
    </section>
  );
  return (
    <div className="flex flex-col gap-5">
      {group("advance", "Advance EXP fields", "Needed when the EXP is created. The fields with a lock cannot change once saved.")}
      {group("duplicate", "Duplicate EXP fields", duplicate ? "All needed for a Duplicate EXP." : "Fill now or later, when the shipment details come in.")}
      {group("extra", "Other", "Optional, used on generated documents.")}
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
  const [duplicate, setDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = Number(values.amount || 0);
  const over = n > available + 0.0001;
  const missing = missingFields(values, duplicate);
  const valid = !!tradeId && n > 0 && !over && missing.length === 0;
  const defaults: Values = { lc_contract: trade?.sales_contract_no ?? "", importer: trade?.importer_name ?? "" };
  async function submit() {
    setBusy(true);
    try {
      const { amount, ...fields } = clean(values);
      const id = await rpc<string>("create_exp", { p_trade: tradeId, p_amount: Number(amount), p_advance: !duplicate, p_fields: fields });
      toast.success("EXP added");
      refresh();
      onOpenChange(false);
      setValues({ exp_year: String(new Date().getFullYear()), unit_iso: "KGM", incoterm: "CFR" });
      setDuplicate(false);
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
      description="Fields follow the EXP template. No approval needed. For many EXPs at once, use Import on the EXPs page."
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
        <TypeSwitch duplicate={duplicate} onChange={setDuplicate} />
        <div className="rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[0.8125rem]">
          Available on this contract <span className="num font-medium">{money(available)}</span>
          {n > 0 && <> · after this EXP <span className={cn("num font-medium", over && "text-bad")}>{money(available - n)}</span></>}
          {tolerance ? <span className="text-mut"> · Tolerance {Number(tolerance)}%: new EXPs go up to the contract amount; a higher shipped value goes through Change amount.</span> : null}
        </div>
        <ExpFieldsForm values={values} onChange={setValues} duplicate={duplicate} defaults={defaults} />
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
  const [duplicate, setDuplicate] = useState(exp.type === "regular");
  const [busy, setBusy] = useState(false);
  const lockedKeys = EXP_FIELDS.filter((f) => f.locked && initial[f.key]).map((f) => f.key);
  const missing = missingFields({ ...values, amount: String(exp.amount) }, duplicate, []);
  const becomingDuplicate = duplicate && exp.type === "advance";
  const valid = !becomingDuplicate || missing.length === 0;
  async function submit() {
    setBusy(true);
    try {
      const changed = Object.fromEntries(EXP_FIELDS.filter((f) => f.key !== "amount" && (values[f.key] ?? "").trim() !== (initial[f.key] ?? "")).map((f) => [f.key, (values[f.key] ?? "").trim()]));
      if (becomingDuplicate) changed.type = "duplicate";
      await rpc("update_exp", { p_id: exp.id, p_amount: null, p_fields: changed });
      toast.success(becomingDuplicate ? "EXP is now a Duplicate EXP" : "EXP updated");
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
          {becomingDuplicate && missing.length > 0 && <span className="mr-auto self-center text-[0.75rem] text-mut">For a Duplicate EXP, still needed: {missing.join(", ")}</span>}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} loading={busy} onClick={submit}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <TypeSwitch duplicate={duplicate} onChange={setDuplicate} lockAdvance={exp.type === "regular"} />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[0.8125rem]">
          <span className="text-mut">Amount Inv</span>
          <span className="num font-medium">
            {money(exp.amount)}
            {exp.issued_amount !== undefined && Number(exp.issued_amount) !== Number(exp.amount) && <span className="ml-2 font-normal text-mut">issued {money(exp.issued_amount)}</span>}
          </span>
        </div>
        <ExpFieldsForm values={values} onChange={setValues} duplicate={duplicate} lockedKeys={lockedKeys} hideAmount />
      </div>
    </Modal>
  );
}
