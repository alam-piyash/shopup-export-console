import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FilePen, Lock, Undo2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { actionLabel, actionTone, useActivity, useIsAdmin, useMe, useProfiles, useTrade, useTradeActions } from "@/lib/api";
import { money, moneyShort, daysUntil, errMsg, fmtDate, fmtDateTime, pct, usd } from "@/lib/format";
import type { Amendment, Attachment, Exp, TradeItem } from "@/lib/types";
import { ApproveReject, Button, Chip, Confirm, Empty, Kpi, KpiGrid, LoadingRows, Money, Panel, Progress, Row, Tabs, cn } from "@/components/ui";
import { EntityDocList } from "@/components/entityDocs";
import { ContractVersions, FollowupsPanel } from "@/components/contractPanel";

type Tab = "exps" | "contract" | "amendments" | "activity";

function useContractExtra(tradeId: string) {
  return useQuery({
    queryKey: ["trade", tradeId, "contract"],
    queryFn: async () => {
      const [{ data: revs, error }, { data: items, error: ie }] = await Promise.all([
        supabase.from("trade_amendments").select("*").eq("trade_id", tradeId).order("amendment_no", { ascending: false }),
        supabase.from("trade_items").select("*").eq("trade_id", tradeId).order("sort_order"),
      ]);
      if (error) throw error;
      if (ie) throw ie;
      const ids = [tradeId, ...(revs ?? []).map((r) => r.id)];
      const { data: files, error: fe } = await supabase.from("attachments").select("*").in("entity_id", ids);
      if (fe) throw fe;
      return { revs: revs as Amendment[], files: files as Attachment[], items: items as TradeItem[] };
    },
  });
}

export default function TradeDetail() {
  const { tradeId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "exps";
  const setTab = (t: Tab) => setParams(t === "exps" ? {} : { tab: t }, { replace: true });
  const { data, isLoading, error } = useTrade(tradeId);
  const extra = useContractExtra(tradeId);
  const isAdmin = useIsAdmin();
  const actions = useTradeActions();
  const [closing, setClosing] = useState(false);

  if (isLoading) return <LoadingRows rows={6} />;
  if (error || !data) return <Empty title="Trade not found" body={error ? errMsg(error) : undefined} />;
  const { trade: t, exps } = data;
  const contract = Number(t.contract_amount);
  const issued = Number(t.exp_issued);
  const available = contract - issued;
  const canClose = isAdmin && t.status === "active" && exps.length > 0 && exps.every((e) => e.status === "closed");
  const exp = daysUntil(t.expiry_date);
  const needsSigned = t.contract_signed === false;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="code-id text-[0.8125rem] text-mut">{t.code} · SC {t.sales_contract_no}</span>
            <Chip status={t.status} />
            {t.is_demo && <Chip label="Demo" tone="gray" dot={false} />}
            {t.latest_amendment_no ? <Chip label={`Amendment ${t.latest_amendment_no}`} tone="info" dot={false} /> : null}
            {t.status === "active" && exp !== null && exp <= 30 && <Chip tone={exp < 0 ? "bad" : "warn"} label={exp < 0 ? "Contract expired" : `Expires in ${exp}d`} dot={false} />}
          </div>
          <h1 className="h1 mt-2">{t.importer_name}</h1>
          <p className="mt-1 text-mut">{t.importer_country} · {t.products}</p>
          {t.status === "rejected" && t.rejection_reason && <p className="mt-2 text-[0.8125rem] text-bad">Rejected: {t.rejection_reason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && t.status === "pending_approval" && (
            <ApproveReject size="md" label={t.code} onApprove={() => actions.approveTrade(t.id)} onReject={(r) => actions.rejectTrade(t.id, r)} />
          )}
          {canClose && <Button variant="outline" onClick={() => setClosing(true)}><Lock /> Close trade</Button>}
          {t.status === "active" ? (
            <Link to={`/trades/${tradeId}/revise`} className="btn btn-outline"><FilePen /> Revise contract</Link>
          ) : (
            <Button variant="outline" disabled title="Only active trades without a pending amendment can be revised"><FilePen /> Revise contract</Button>
          )}
        </div>
      </div>

      {t.status === "pending_approval" && <div className="banner chip-warn">This trade is awaiting admin approval. EXPs, collections and incentives open once it is approved.</div>}
      {needsSigned && !["rejected", "closed"].includes(t.status) && (
        <div className="banner chip-warn flex-wrap items-center justify-between">
          <span>No signed sales contract yet. Upload the signed copy and mark it signed before adding EXPs.</span>
          <Button size="sm" variant="outline" onClick={() => setTab("contract")}>Open sales contract</Button>
        </div>
      )}
      {t.status === "revision_pending" && (
        <div className="banner chip-info flex-wrap items-center justify-between">
          <span>A contract amendment is awaiting admin approval. Amounts change only after approval.</span>
          <Button size="sm" variant="outline" onClick={() => setTab("amendments")}>View amendment</Button>
        </div>
      )}

      <KpiGrid>
        <Kpi label="Contract" value={moneyShort(contract)} usdValue={t.contract_amount_usd} sub={money(contract)} />
        <Kpi label="EXP issued" value={moneyShort(issued)} usdValue={t.exp_issued_usd} sub={<div className="flex items-center gap-2"><Progress value={pct(issued, contract)} /><span className="num">{pct(issued, contract)}%</span></div>} />
        <Kpi label="Collected" value={moneyShort(t.collected)} usdValue={t.collected_usd} sub={<div className="flex items-center gap-2"><Progress tone="ok" value={pct(t.collected, issued)} /><span className="num">{pct(t.collected, issued)}%</span></div>} />
        <Kpi label="Available to issue" value={moneyShort(available)} sub={t.tolerance_pct ? `Amount changes allowed up to ${Number(t.tolerance_pct)}% over` : "Left to issue as EXPs"} />
      </KpiGrid>

      <div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "exps", label: <>EXPs <span className="num text-mut">{exps.length}</span></> },
            { value: "contract", label: "Sales contract" },
            { value: "amendments", label: <>Amendments {extra.data?.revs.length ? <span className="num text-mut">{extra.data.revs.length}</span> : null}{t.pending_revision_id && <span className="size-1.5 rounded-full bg-info" />}</> },
            { value: "activity", label: "Activity" },
          ]}
        />
        <div className="mt-5">
          {tab === "exps" && (
            <div className="flex flex-col gap-5">
              <ExpSummary exps={exps} contract={contract} tradeId={tradeId} active={t.status === "active" && !needsSigned} />
              {(t.status === "active" || t.status === "revision_pending") && <FollowupsPanel trade={t} exps={exps} />}
            </div>
          )}
          {tab === "contract" && <ContractTab tradeId={tradeId} />}
          {tab === "amendments" && <AmendmentsTab tradeId={tradeId} />}
          {tab === "activity" && <ActivityTab tradeId={tradeId} />}
        </div>
      </div>

      <Confirm open={closing} onOpenChange={setClosing} title={`Close ${t.code}?`} body="All EXPs are closed. Closing the trade marks the contract as complete. Collections and incentives on its EXPs still work." confirmLabel="Close trade" onConfirm={() => actions.closeTrade(t.id)} />
    </>
  );
}

/** Topline of the trade's EXPs: issued, value, Advance and Regular, collected. */
function ExpSummary({ exps, contract, tradeId, active }: { exps: Exp[]; contract: number; tradeId: string; active: boolean }) {
  const sum = (a: Exp[]) => a.reduce((s, e) => s + Number(e.amount || 0), 0);
  const adv = exps.filter((e) => e.type === "advance"), reg = exps.filter((e) => e.type === "regular");
  const col = exps.filter((e) => e.collection_status === "approved"), pend = exps.filter((e) => e.collection_status === "pending_approval");
  const total = sum(exps);
  const cell = (label: string, big: ReactNode, sub: ReactNode) => (
    <div className="min-w-0 px-4 py-3.5">
      <div className="text-[0.75rem] text-mut">{label}</div>
      <div className="num mt-0.5 text-[1.125rem] font-semibold leading-tight">{big}</div>
      <div className="num mt-0.5 truncate text-[0.75rem] text-mut">{sub}</div>
    </div>
  );
  return (
    <section className="card overflow-hidden">
      <div className="head-strip flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <div className="text-[0.9375rem] font-semibold">EXP summary</div>
          <div className="text-[0.75rem] text-mut">{exps.length ? "EXPs are added, corrected and searched on the EXPs page." : active ? "No EXPs yet. Add them on the EXPs page, one by one or from Excel." : "EXPs can be added once the trade is approved and the signed contract is on file."}</div>
        </div>
        {(exps.length > 0 || active) && <Link to={`/exps?trade=${tradeId}`} className="btn btn-outline btn-sm">{exps.length ? `View ${exps.length} EXP${exps.length === 1 ? "" : "s"}` : "Go to EXPs"} <ChevronRight /></Link>}
      </div>
      <div className="grid grid-cols-2 divide-line max-lg:[&>*:nth-child(n+3)]:border-t max-lg:[&>*:nth-child(even)]:border-l lg:grid-cols-5 lg:divide-x">
      {cell("EXPs issued", exps.length, `${exps.filter((e) => e.status === "open").length} open`)}
      {cell("EXP value", money(total), `${contract ? pct(total, contract) : 0}% of contract`)}
      {cell("Advance", adv.length, money(sum(adv)))}
      {cell("Regular", reg.length, money(sum(reg)))}
      {cell("Collected", <span className="text-ok">{money(sum(col))}</span>, `${col.length} of ${exps.length} EXPs${pend.length ? `, ${pend.length} pending approval` : ""} · due ${money(total - sum(col))}`)}
      </div>
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card p-5">
      <div className="lbl mb-3">{title}</div>
      {children}
    </div>
  );
}

function ContractTab({ tradeId }: { tradeId: string }) {
  const { data } = useTrade(tradeId);
  const { data: extra } = useContractExtra(tradeId);
  const profiles = useProfiles().data ?? {};
  const t = data?.trade;
  if (!t) return null;
  const EXTRA_LABEL: Record<string, string> = { signatory_name: "Signatory", signatory_designation: "Signatory designation" };
  const extras = Object.entries((t.contract_extra ?? {}) as Record<string, string>);
  const notify = t.notify_parties ?? [];
  const opt = (v?: string | number | null) => (v === null || v === undefined || v === "" ? <span className="text-mut">Not set</span> : String(v));
  return (
    <div className="flex flex-col gap-5">
      <ContractVersions trade={t} items={extra?.items ?? []} revs={extra?.revs ?? []} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Group title="Sales contract">
          <Row label="SC number" value={<span className="code-id">{t.sales_contract_no}</span>} />
          <Row label="Contract date" value={fmtDate(t.contract_date)} />
          <Row label="Total CFR amount" value={<Money money={t.contract_amount} usd={t.contract_amount_usd} align="end" />} />
          <Row label="Tolerance" value={t.tolerance_pct ? `${Number(t.tolerance_pct)}% more or less at seller's option` : opt(null)} />
          <Row label="Shipping mark" value={opt(t.shipping_mark)} />
          <Row label="Origin" value={opt(t.country_of_origin)} />
          <Row label="Destination" value={opt(t.country_of_destination)} />
          <Row label="Expiry date" value={t.expiry_date ? fmtDate(t.expiry_date) : opt(null)} />
          <Row label="Shipment deadline" value={t.shipment_deadline ? fmtDate(t.shipment_deadline) : opt(t.shipment_timeline)} />
          <Row label="Carriage by" value={opt(t.carriage_by)} />
          <Row label="Departure" value={opt(t.departure_port)} />
          <Row label="Point of entry" value={opt(t.point_of_entry)} />
          {t.payment_terms && <Row label="Terms of delivery and payment" value={t.payment_terms} />}
          {extras.map(([k, v]) => <Row key={k} label={EXTRA_LABEL[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())} value={String(v)} />)}
          <div className="mt-3 text-[0.75rem] text-mut">
            Submitted by {t.is_demo ? "Demo" : profiles[t.created_by] ?? "Unknown"} on {fmtDate(t.created_at)}
            {t.approved_at && ` · ${t.status === "rejected" ? "Rejected" : "Approved"} by ${t.is_demo ? "Demo" : (t.approved_by && profiles[t.approved_by]) ?? "admin"} on ${fmtDate(t.approved_at)}`}
          </div>
        </Group>
        <div className="flex flex-col gap-5">
          <Group title="Exporter">
            <div className="font-medium">{t.exporter}</div>
            {t.exporter_address && <div className="text-[0.8125rem] text-mut">{t.exporter_address}</div>}
            <div className="text-[0.8125rem] text-mut">{[t.exporter_phone, t.exporter_email].filter(Boolean).join(" · ")}</div>
          </Group>
          <Group title="Buyer (consignee)">
            <div className="font-medium">{t.importer_name}</div>
            {t.buyer_address && <div className="text-[0.8125rem] text-mut">{t.buyer_address}</div>}
            <div className="text-[0.8125rem] text-mut">{t.importer_country}</div>
            <Row label="CR number" value={opt(t.buyer_cr_no)} />
            <Row label="VAT registration" value={opt(t.buyer_vat_no)} />
          </Group>
          <Group title="Notify parties">
            {!notify.length ? <p className="text-[0.8125rem] text-mut">None.</p> : (
              <ul className="space-y-2">{notify.map((n, i) => <li key={i} className="text-[0.8125rem]"><span className="font-medium">{n.name}</span> <span className="text-mut">{n.address}</span></li>)}</ul>
            )}
          </Group>
          <Group title="Bank coordinates for receiving TT">
            <Row label="Bank" value={opt(t.bank_name)} />
            <Row label="Branch" value={opt(t.bank_branch)} />
            <Row label="Routing" value={opt(t.bank_routing_no)} />
            <Row label="SWIFT" value={opt(t.bank_swift)} />
            <Row label="Account name" value={opt(t.bank_account_name)} />
            <Row label="Account number" value={opt(t.bank_account_no)} />
          </Group>
        </div>
      </div>
      <Panel title="Items">
        {!extra?.items.length ? <Empty title="No items" /> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="tbl min-w-[42.5rem]">
              <thead><tr>{["Description", "Carton", "HS code", "Incoterm", "Qty (KG)", "Rate / KG", "Total"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {extra.items.map((i) => (
                  <tr key={i.id}>
                    <td className="font-medium">{i.description}</td>
                    <td className="text-mut">{i.carton_size}</td>
                    <td className="code-id">{i.hs_code}</td>
                    <td>{i.incoterm}</td>
                    <td className="num">{Number(i.quantity_kg).toLocaleString("en-US")}</td>
                    <td className="num">{money(i.rate_per_kg)}</td>
                    <td className="num font-medium">{money(i.line_total)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={6} className="lbl">Total CFR amount</td>
                  <td className="num font-semibold">{money(t.contract_amount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function AmendmentsTab({ tradeId }: { tradeId: string }) {
  const { data: extra, isLoading } = useContractExtra(tradeId);
  const profiles = useProfiles().data ?? {};
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const actions = useTradeActions();
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  if (isLoading) return <LoadingRows />;
  if (!extra?.revs.length)
    return <Panel><Empty icon={<FilePen />} title="No amendments yet" body="Use Revise contract on an active trade to request a change. Admins approve before anything changes." /></Panel>;
  return (
    <div className="flex flex-col gap-3">
      {extra.revs.map((r) => {
        const f = extra.files.find((x) => x.entity_id === r.id);
        const changes = (r.exp_changes ?? []).filter((c) => Number(c.old_amount) !== Number(c.new_amount));
        const delta = Number(r.new_amount) - Number(r.old_amount);
        const pending = r.status === "pending_approval";
        return (
          <div key={r.id} className={cn("card p-5", pending && "border-info/50")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Amendment No {r.amendment_no}</span>
                <span className="num text-[0.8125rem] text-mut">{fmtDate(r.amendment_date)}</span>
                <Chip status={r.status} />
                {r.is_demo && <Chip label="Demo" tone="gray" dot={false} />}
              </div>
              <div className="flex flex-wrap gap-2">
                {pending && isAdmin && <ApproveReject label={`amendment ${r.amendment_no}`} onApprove={() => actions.approveAmendment(r.id)} onReject={(reason) => actions.rejectAmendment(r.id, reason)} />}
                {pending && (r.requested_by === me?.id || isAdmin) && (
                  <Button size="sm" variant="ghost" onClick={() => setWithdrawing(r.id)}><Undo2 /> Withdraw</Button>
                )}
              </div>
            </div>
            <p className="mt-2 text-[0.8438rem]">{r.reason}</p>
            <div className="mt-4 overflow-hidden rounded-lg border border-line">
              <table className="tbl text-[0.8125rem]">
                <thead><tr><th>Field</th><th>Previous</th><th>New</th></tr></thead>
                <tbody>
                  <tr>
                    <td>Contract amount</td>
                    <td className="num text-mut">{money(r.old_amount)}</td>
                    <td className="num">
                      {money(r.new_amount)} {delta !== 0 && <span className={cn("ml-1 text-[0.75rem]", delta > 0 ? "text-ok" : "text-bad")}>{delta > 0 ? "+" : ""}{money(delta)}</span>}
                    </td>
                  </tr>
                  {r.new_expiry_date && <tr><td>Expiry date</td><td className="text-mut">{r.old_expiry_date ? fmtDate(r.old_expiry_date) : "Not set"}</td><td>{fmtDate(r.new_expiry_date)}</td></tr>}
                  {r.new_shipment_timeline && <tr><td>Shipment timeline</td><td className="text-mut">{r.old_shipment_timeline || "Not set"}</td><td>{r.new_shipment_timeline}</td></tr>}
                  {r.new_items && <tr><td>Item lines</td><td className="text-mut">{(r.old_items ?? []).length} lines</td><td>{r.new_items.length} lines (replaced)</td></tr>}
                  {changes.map((c) => <tr key={c.code}><td className="num">{c.code}</td><td className="num text-mut">{money(c.old_amount)}</td><td className="num">{money(c.new_amount)}</td></tr>)}
                </tbody>
              </table>
            </div>
            {r.rejection_reason && <p className="mt-3 text-[0.8125rem] text-bad">Rejected: {r.rejection_reason}</p>}
            <div className="mt-4">
              <EntityDocList entityType="trade_amendment" entityId={r.id} folder="trades/amendments" />
              {!f && <p className="text-[0.8125rem] text-mut">No amendment copy.</p>}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span />
              <span className="text-[0.75rem] text-mut">
                {r.is_demo ? "Demo" : profiles[r.requested_by] ?? ""} · {fmtDate(r.created_at)}
                {r.approved_at && ` · ${r.status} ${r.approved_by ? `by ${profiles[r.approved_by] ?? "admin"}` : ""} on ${fmtDate(r.approved_at)}`}
              </span>
            </div>
          </div>
        );
      })}
      <Confirm
        open={!!withdrawing}
        onOpenChange={(o) => !o && setWithdrawing(null)}
        title="Withdraw this amendment?"
        body="The trade goes back to active with its current values. You can submit a new amendment later."
        confirmLabel="Withdraw"
        onConfirm={() => actions.withdrawAmendment(withdrawing!)}
      />
    </div>
  );
}

function ActivityTab({ tradeId }: { tradeId: string }) {
  const profiles = useProfiles().data ?? {};
  const { data, isLoading } = useActivity(200, tradeId);
  if (isLoading) return <LoadingRows />;
  if (!data?.length) return <Panel><Empty title="No activity yet" /></Panel>;
  return (
    <Panel>
      <ol className="p-5">
        {data.map((a, i) => {
          const d = a.details ?? {};
          const bits: string[] = [];
          if (d.code) bits.push(String(d.code));
          if (d.doc) bits.push(String(d.doc));
          if (d.old_amount !== undefined && d.new_amount !== undefined) bits.push(`${money(d.old_amount as number)} to ${money(d.new_amount as number)}`);
          else if (d.amount !== undefined) bits.push(money(d.amount as number));
          return (
            <li key={a.id} className="relative flex gap-3 pb-5 last:pb-0">
              {i < data.length - 1 && <span className="absolute left-[0.3125rem] top-4 h-full w-px bg-line" />}
              <span className={cn("relative mt-1.5 size-[0.6875rem] shrink-0 rounded-full border-2 border-surface", { ok: "bg-ok", bad: "bg-bad", warn: "bg-warn", info: "bg-info", gray: "bg-mut" }[actionTone(a.action)])} />
              <div className="min-w-0 text-[0.8438rem]">
                <span className="font-medium">{a.is_demo ? "Demo" : profiles[a.actor_id ?? ""] ?? "System"}</span>{" "}
                <span className="text-mut">{actionLabel(a.action)}</span> <span className="num">{bits.join(" · ")}</span>
                {d.reason ? <div className="text-[0.7812rem] text-mut">Reason: {String(d.reason)}</div> : null}
                <div className="num text-[0.7188rem] text-mut">{fmtDateTime(a.created_at)}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
