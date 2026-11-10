import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FilePen, FileText, Landmark, Lock, Plane, Undo2, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useIsAdmin, useMe, useProfiles, useTrade, useTradeActions } from "@/lib/api";
import { money, daysUntil, errMsg, fmtDate, pct } from "@/lib/format";
import type { Amendment, Attachment, Exp, Trade, TradeItem } from "@/lib/types";
import { ApproveReject, Button, Chip, Confirm, Empty, LoadingRows, Panel, Progress, Tabs, cn } from "@/components/ui";
import { EntityDocList } from "@/components/entityDocs";
import { ContractVersions } from "@/components/contractPanel";

type Tab = "overview" | "amendments";

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
  const tab: Tab = params.get("tab") === "amendments" ? "amendments" : "overview";
  const setTab = (t: Tab) => setParams(t === "overview" ? {} : { tab: t }, { replace: true });
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
          <Button size="sm" variant="outline" onClick={() => { setTab("overview"); setTimeout(() => document.getElementById("contract-doc")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }}>Open sales contract</Button>
        </div>
      )}
      {t.status === "revision_pending" && (
        <div className="banner chip-info flex-wrap items-center justify-between">
          <span>A contract amendment is awaiting admin approval. Amounts change only after approval.</span>
          <Button size="sm" variant="outline" onClick={() => setTab("amendments")}>View amendment</Button>
        </div>
      )}

      <TradeStrip t={t} exps={exps} contract={contract} issued={issued} available={available} />

      <div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "overview", label: "Overview" },
            { value: "amendments", label: <>Amendments {extra.data?.revs.length ? <span className="num text-mut">{extra.data.revs.length}</span> : null}{t.pending_revision_id && <span className="size-1.5 rounded-full bg-info" />}</> },
          ]}
        />
        <div className="mt-5">
          {tab === "overview" && <ContractTab tradeId={tradeId} />}
          {tab === "amendments" && <AmendmentsTab tradeId={tradeId} />}
        </div>
      </div>

      <Confirm open={closing} onOpenChange={setClosing} title={`Close ${t.code}?`} body="All EXPs are closed. Closing the trade marks the contract as complete. Collections and incentives on its EXPs still work." confirmLabel="Close trade" onConfirm={() => actions.closeTrade(t.id)} />
    </>
  );
}

/** One strip of the numbers that matter: contract, EXPs (Advance and Regular), collected, left to issue. */
function TradeStrip({ t, exps, contract, issued, available }: { t: Trade; exps: Exp[]; contract: number; issued: number; available: number }) {
  const sum = (a: Exp[]) => a.reduce((s, e) => s + Number(e.amount || 0), 0);
  const adv = exps.filter((e) => e.type === "advance"), reg = exps.filter((e) => e.type === "regular");
  const col = exps.filter((e) => e.collection_status === "approved"), pend = exps.filter((e) => e.collection_status === "pending_approval");
  const collected = Number(t.collected ?? sum(col));
  const cell = (label: string, big: ReactNode, sub: ReactNode, extra?: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3.5">
      <div className="text-[0.75rem] text-mut">{label}</div>
      <div className="num text-[1.25rem] font-semibold leading-tight tracking-tight">{big}</div>
      {extra}
      <div className="num truncate text-[0.75rem] text-mut">{sub}</div>
    </div>
  );
  return (
    <section className="card grid grid-cols-2 overflow-hidden divide-line max-lg:[&>*:nth-child(n+3)]:border-t max-lg:[&>*:nth-child(even)]:border-l lg:grid-cols-5 lg:divide-x">
      {cell("Contract", money(contract), t.tolerance_pct ? `Tolerance ${Number(t.tolerance_pct)}%` : `SC ${t.sales_contract_no}`)}
      {cell("EXP issued", money(issued), `${exps.length} EXP${exps.length === 1 ? "" : "s"} · ${pct(issued, contract)}% of contract`, <Progress value={pct(issued, contract)} />)}
      {cell("Advance / Regular", <>{adv.length} <span className="text-mut">/</span> {reg.length}</>, `${money(sum(adv))} / ${money(sum(reg))}`)}
      {cell("Collected", <span className="text-ok">{money(collected)}</span>, `${col.length} of ${exps.length} EXPs${pend.length ? `, ${pend.length} pending` : ""}`, <Progress tone="ok" value={pct(collected, issued)} />)}
      {cell("Left to issue", money(available), `Due for collection ${money(issued - collected)}`)}
    </section>
  );
}

function ContractTab({ tradeId }: { tradeId: string }) {
  const { data } = useTrade(tradeId);
  const { data: extra } = useContractExtra(tradeId);
  const profiles = useProfiles().data ?? {};
  const t = data?.trade;
  if (!t) return null;
  const extras = Object.entries((t.contract_extra ?? {}) as Record<string, string>);
  const notify = t.notify_parties ?? [];
  const opt = (v?: string | number | null) => (v === null || v === undefined || v === "" ? <span className="text-mut">Not set</span> : String(v));
  const F = ({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) => (
    <div className="min-w-0">
      <dt className="text-[0.75rem] text-mut">{label}</dt>
      <dd className={cn("mt-0.5 font-medium [overflow-wrap:anywhere]", mono && "code-id tabular-nums")}>{children}</dd>
    </div>
  );
  const Card = ({ icon, title, sub, children }: { icon: ReactNode; title: string; sub: string; children: ReactNode }) => (
    <section className="card flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-accent/10 text-accent [&_svg]:size-[1.0625rem]">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-[0.9375rem] font-semibold">{title}</h3>
          <p className="text-[0.75rem] text-mut">{sub}</p>
        </div>
      </div>
      {children}
    </section>
  );
  const grid = "grid grid-cols-2 gap-x-5 gap-y-4 px-5 py-4 sm:grid-cols-3";
  const incoterm = (extra?.items ?? []).find((i) => i.incoterm)?.incoterm;
  const party = (role: string, name: ReactNode, lines: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-line px-4 py-3.5">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-mut">{role}</span>
      <span className="font-semibold">{name}</span>
      <span className="text-[0.8125rem] leading-relaxed text-mut">{lines}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="cd-title" className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="cd-title" className="text-[1.125rem] font-semibold">Contract details</h2>
          <span className="text-[0.75rem] text-mut">
            Submitted by {t.is_demo ? "Demo" : profiles[t.created_by] ?? "Unknown"} on {fmtDate(t.created_at)}
            {t.approved_at && ` · ${t.status === "rejected" ? "Rejected" : "Approved"} by ${t.is_demo ? "Demo" : (t.approved_by && profiles[t.approved_by]) ?? "admin"} on ${fmtDate(t.approved_at)}`}
          </span>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card icon={<FileText />} title="Contract" sub="Identity, value and dates">
            <dl className={grid}>
              <F label="SC number" mono>{t.sales_contract_no}</F>
              <F label="Contract date">{fmtDate(t.contract_date)}</F>
              <F label="Total CFR amount" mono>{money(t.contract_amount)}</F>
              <F label="Shipment deadline">{t.shipment_deadline ? fmtDate(t.shipment_deadline) : opt(t.shipment_timeline)}</F>
              <F label="Contract expiry">{t.expiry_date ? fmtDate(t.expiry_date) : opt(null)}</F>
              <F label="Tolerance">{t.tolerance_pct ? `${Number(t.tolerance_pct)}% more or less` : opt(null)}</F>
            </dl>
            {t.payment_terms && <div className="border-t border-line px-5 py-3.5"><F label="Terms of delivery and payment">{t.payment_terms}</F></div>}
          </Card>
          <Card icon={<Plane />} title="Shipping" sub="Route and how goods travel">
            <div className="px-5 pt-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-xl bg-bg px-4 py-3.5">
                <div className="min-w-0">
                  <div className="text-[0.75rem] text-mut">From</div>
                  <div className="font-semibold [overflow-wrap:anywhere]">{t.departure_port || opt(null)}</div>
                  <div className="text-[0.75rem] text-mut">Origin: {t.country_of_origin || "Not set"}</div>
                </div>
                <ArrowRight className="size-5 text-accent" aria-hidden="true" />
                <div className="min-w-0 text-right">
                  <div className="text-[0.75rem] text-mut">To</div>
                  <div className="font-semibold [overflow-wrap:anywhere]">{t.point_of_entry || opt(null)}</div>
                  <div className="text-[0.75rem] text-mut">Destination: {t.country_of_destination || t.importer_country || "Not set"}</div>
                </div>
              </div>
            </div>
            <dl className={grid}>
              <F label="Carriage by">{opt(t.carriage_by)}</F>
              <F label="Shipping mark" mono>{opt(t.shipping_mark)}</F>
              <F label="Incoterm">{opt(incoterm)}</F>
            </dl>
          </Card>
        </div>
        <Card icon={<Users />} title="Parties" sub="Who sells, who buys, who is notified">
          <div className="grid gap-3 px-5 py-4 md:grid-cols-3">
            {party("Exporter", t.exporter, <>{t.exporter_address}{(t.exporter_phone || t.exporter_email) && <><br />{[t.exporter_phone, t.exporter_email].filter(Boolean).join(" · ")}</>}{extras.length > 0 && <><br />Signatory: {extras.map(([, v]) => String(v)).join(", ")}</>}</>)}
            {party("Buyer (consignee)", t.importer_name, <>{[t.buyer_address, t.importer_country].filter(Boolean).join(", ")}{(t.buyer_cr_no || t.buyer_vat_no) && <><br />{[t.buyer_cr_no && `CR ${t.buyer_cr_no}`, t.buyer_vat_no && `VAT ${t.buyer_vat_no}`].filter(Boolean).join(" · ")}</>}</>)}
            {notify.length
              ? party(`Notify part${notify.length === 1 ? "y" : "ies"} (${notify.length})`, notify[0].name, <>{notify[0].address}{notify.slice(1).map((n, i) => <span key={i}><br />{n.name}{n.address ? `, ${n.address}` : ""}</span>)}</>)
              : party("Notify parties", <span className="text-mut">None</span>, "")}
          </div>
        </Card>
        <Card icon={<Landmark />} title="Bank for TT" sub="Where the buyer sends payment">
          <dl className={grid}>
            <F label="Bank">{opt(t.bank_name)}</F>
            <F label="Branch">{opt(t.bank_branch)}</F>
            <F label="Account name">{opt(t.bank_account_name)}</F>
            <F label="Account number" mono>{opt(t.bank_account_no)}</F>
            <F label="SWIFT code" mono>{opt(t.bank_swift)}</F>
            <F label="Routing number" mono>{opt(t.bank_routing_no)}</F>
          </dl>
        </Card>
      </section>
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
      <div id="contract-doc" className="scroll-mt-20">
        <ContractVersions trade={t} items={extra?.items ?? []} revs={extra?.revs ?? []} />
      </div>
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

