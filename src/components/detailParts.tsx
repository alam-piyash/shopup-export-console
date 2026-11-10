import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { money } from "@/lib/format";
import { expNumber } from "@/lib/expFields";

/** One summary card: the headline amount, a note beside it, and a row of supporting figures. */
export function HeroCard({ label, amount, aside, stats }: { label: string; amount: ReactNode; aside?: ReactNode; stats: { label: string; value: ReactNode }[] }) {
  return (
    <section className="card flex flex-col gap-5 px-6 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[0.8125rem] text-mut">{label}</div>
          <div className="num text-[2.25rem] font-semibold leading-tight tracking-tight">{amount}</div>
        </div>
        {aside && <div className="text-[0.8125rem] text-mut">{aside}</div>}
      </div>
      <dl className="grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <dt className="text-[0.75rem] text-mut">{s.label}</dt>
            <dd className="num mt-0.5 truncate text-[1.0625rem] font-medium">{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type Row = { amount: number | string; exps: { id: string; code: string; exp_serial?: string | null; exp_year?: number | null; exp_no?: string | null; awb_no?: string | null } | null };

/** EXPs in a collection or claim: five rows, then Show all, with the total. */
export function ExpRowsTable<T extends Row>({ title, sub, rows, extra }: { title: string; sub: string; rows: T[]; extra: { label: string; cell: (r: T) => ReactNode } }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 5);
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  return (
    <section className="card overflow-hidden">
      <div className="px-6 pb-3 pt-4">
        <h2 className="text-[1.0625rem] font-semibold">{title}</h2>
        <p className="text-[0.8125rem] text-mut">{sub}</p>
      </div>
      <div className="scroll-thin overflow-x-auto">
        <table className="tbl min-w-[34rem]">
          <thead><tr><th>EXP</th><th>EXP number</th><th>{extra.label}</th><th className="!text-right">Amount</th></tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.exps?.id ?? i}>
                <td>{r.exps ? <Link to={`/exps/${r.exps.id}`} className="code-id font-medium text-accent hover:underline">{r.exps.code}</Link> : ""}</td>
                <td className="code-id">{r.exps ? expNumber(r.exps as never) || <span className="text-mut">Not set</span> : ""}</td>
                <td className="code-id text-mut">{extra.cell(r)}</td>
                <td className="!text-right num font-medium">{money(r.amount)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3}>{rows.length > 5 && <button type="button" onClick={() => setAll((v) => !v)} className="text-[0.8125rem] font-medium text-accent hover:underline">{all ? "Show fewer" : `Show all ${rows.length}`}</button>}</td>
              <td className="!text-right num font-semibold">{money(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Code, status chip and a one-line context under it. */
export function DetailHeader({ code, chips, meta, actions }: { code: string; chips: ReactNode; meta: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="h1 code-id">{code}</h1>
          {chips}
        </div>
        <p className="text-mut">{meta}</p>
      </div>
      {actions}
    </div>
  );
}
