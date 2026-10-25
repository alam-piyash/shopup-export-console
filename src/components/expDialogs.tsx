import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { EXP_DOCS, rpc, useRefresh } from "@/lib/api";
import { bdt, errMsg, rateHint } from "@/lib/format";
import type { Exp } from "@/lib/types";
import { Button, Chip, Field, Grid, Input, Modal, Switch, cn } from "./ui";

type ShipFields = { shipment_id: string; exp_no: string; awb_no: string; flight_no: string; shipment_date: string };
const SHIP: { key: keyof ShipFields; label: string; type?: string }[] = [
  { key: "shipment_id", label: "Shipment ID" },
  { key: "exp_no", label: "EXP number (bank)" },
  { key: "awb_no", label: "AWB number" },
  { key: "flight_no", label: "Flight number" },
  { key: "shipment_date", label: "Shipment date", type: "date" },
];
const emptyShip = (): ShipFields => ({ shipment_id: "", exp_no: "", awb_no: "", flight_no: "", shipment_date: "" });

function ShipmentInputs({ value, onChange, advance }: { value: ShipFields; onChange: (v: ShipFields) => void; advance: boolean }) {
  return (
    <Grid>
      {SHIP.map((f) => (
        <Field key={f.key} label={<>{f.label} {f.key === "shipment_id" && !advance ? <span className="text-accent">*</span> : <span className="text-[0.75rem] font-normal text-mut">(optional)</span>}</>}>
          <Input type={f.type ?? "text"} value={value[f.key]} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} />
        </Field>
      ))}
    </Grid>
  );
}

export function AddExpDialog({ open, onOpenChange, tradeId, available, tolerance }: { open: boolean; onOpenChange: (o: boolean) => void; tradeId: string; available: number; tolerance?: number | string | null }) {
  const refresh = useRefresh();
  const navigate = useNavigate();
  const [amount, setAmount] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [ship, setShip] = useState<ShipFields>(emptyShip());
  const [advance, setAdvance] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = Number(amount || 0);
  const over = n > available + 0.0001;
  const valid = n > 0 && !over && (advance || ship.shipment_id.trim());
  async function submit() {
    setBusy(true);
    try {
      const id = await rpc<string>("create_exp", { p_trade: tradeId, p_amount: n, p_advance: advance, p_fields: { ...ship, amount_usd: amountUsd || null } });
      toast.success("EXP added");
      refresh();
      onOpenChange(false);
      setAmount(""); setAmountUsd(""); setShip(emptyShip()); setAdvance(false);
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
      wide
      title="Add EXP"
      description="One EXP per shipment. No approval needed."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!valid} loading={busy} onClick={submit}>Add EXP</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Grid>
          <Field
            label="Amount (BDT)"
            required
            error={over}
            hint={
              <>
                Available <span className="num">{bdt(available)}</span>
                {n > 0 && <> · after this EXP <span className="num">{bdt(available - n)}</span></>}
                {over && " · exceeds the contract amount"}
              </>
            }
          >
            <Input inputMode="decimal" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus />
          </Field>
          <Field label="Amount (USD, optional)" hint={rateHint(amount, amountUsd)}>
            <Input inputMode="decimal" type="number" step="0.01" value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} placeholder="0" />
          </Field>
        </Grid>
        {tolerance ? <p className="-mt-2 text-[0.75rem] text-mut">Contract tolerance {Number(tolerance)}% more or less at seller's option. Hint only, the limit stays the contract amount.</p> : null}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-bg p-3.5">
          <div>
            <div className="text-[0.8438rem] font-medium">Advance EXP</div>
            <div className="text-[0.75rem] text-mut">Shipment details and documents are added later.</div>
          </div>
          <Switch checked={advance} onChange={setAdvance} label="Advance EXP" />
        </div>
        <ShipmentInputs value={ship} onChange={setShip} advance={advance} />
        <div>
          <div className="lbl mb-2">Documents tracked for this EXP</div>
          <div className="flex flex-wrap gap-1.5">
            {EXP_DOCS.map((d) => <Chip key={d} label={d} tone="gray" dot={false} />)}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function EditExpDialog({ exp, available, onClose }: { exp: Exp; available: number; onClose: () => void }) {
  const refresh = useRefresh();
  const [amount, setAmount] = useState(String(exp.amount ?? ""));
  const [amountUsd, setAmountUsd] = useState(exp.amount_usd == null ? "" : String(exp.amount_usd));
  const [ship, setShip] = useState<ShipFields>({
    shipment_id: exp.shipment_id ?? "",
    exp_no: exp.exp_no ?? "",
    awb_no: exp.awb_no ?? "",
    flight_no: exp.flight_no ?? "",
    shipment_date: exp.shipment_date ?? "",
  });
  const [busy, setBusy] = useState(false);
  const locked = exp.status === "closed" || exp.trade_status !== "active";
  const n = Number(amount || 0);
  const room = available + Number(exp.amount);
  const over = !locked && n > room + 0.0001;
  async function submit() {
    setBusy(true);
    try {
      await rpc("update_exp", { p_id: exp.id, p_amount: n, p_fields: { ...ship, amount_usd: amountUsd || null } });
      toast.success("EXP updated");
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
      wide
      title={<span className="num">Edit {exp.code}</span>}
      description={locked ? "Amount is locked. You can still update the shipment details." : "Change the amount or fill in shipment details."}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={n <= 0 || !!over} loading={busy} onClick={submit}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Grid>
          <Field label="Amount (BDT)" error={over} hint={!locked ? <>Maximum for this EXP <span className={cn("num", over && "text-bad")}>{bdt(room)}</span></> : "Locked"}>
            <Input type="number" inputMode="decimal" step="0.01" value={amount} disabled={locked} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Amount (USD, optional)" hint={rateHint(amount, amountUsd)}>
            <Input type="number" inputMode="decimal" step="0.01" value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} />
          </Field>
        </Grid>
        <ShipmentInputs value={ship} onChange={setShip} advance={exp.type === "advance"} />
      </div>
    </Modal>
  );
}
