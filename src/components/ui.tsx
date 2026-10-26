import { forwardRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import * as D from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";
import { bdt, errMsg, usdOpt } from "@/lib/format";

export const cn = clsx;

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "md" | "sm" | "icon";
  loading?: boolean;
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      disabled={disabled || loading}
      className={cn("btn", `btn-${variant}`, size === "sm" && "btn-sm", size === "icon" && "btn-icon", className)}
      {...rest}
    >
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </button>
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn("field", p.type === "number" && "num", className)} {...p} />;
});
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("field", className)} rows={p.rows ?? 3} {...p} />;
}
export function Select({ className, children, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string }) {
  return (
    <select className={cn("field appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: CHEVRON }} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {children}
    </select>
  );
}
const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

export function Field({ label, hint, children, className, required, error }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; required?: boolean; error?: boolean }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-[0.8125rem] font-medium text-fg/90">
        {label} {required && <span className="text-accent">*</span>}
      </span>
      {children}
      {hint && <span className={cn("text-[0.75rem]", error ? "text-bad" : "text-mut")}>{hint}</span>}
    </label>
  );
}

export function Grid({ children, cols = 2, className }: { children: ReactNode; cols?: 2 | 3 | 4; className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-2 lg:grid-cols-3", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4", className)}>
      {children}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition", checked ? "bg-accent" : "bg-line")}
    >
      <span className={cn("inline-block size-5 rounded-full bg-white shadow transition", checked ? "translate-x-[1.375rem]" : "translate-x-0.5")} />
    </button>
  );
}

type Tone = "ok" | "warn" | "bad" | "info" | "gray";
const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending_approval: { label: "Awaiting approval", tone: "warn" },
  active: { label: "Active", tone: "ok" },
  revision_pending: { label: "Amendment pending", tone: "info" },
  closed: { label: "Closed", tone: "gray" },
  rejected: { label: "Rejected", tone: "bad" },
  approved: { label: "Approved", tone: "ok" },
  withdrawn: { label: "Withdrawn", tone: "gray" },
  open: { label: "Open", tone: "info" },
  missing: { label: "Missing", tone: "gray" },
  uploaded: { label: "Uploaded", tone: "warn" },
  final: { label: "Final", tone: "ok" },
};
export function Chip({ status, label, tone, dot = true, className }: { status?: string | null; label?: ReactNode; tone?: Tone; dot?: boolean; className?: string }) {
  const s = (status && STATUS[status]) || { label: status ?? "", tone: "gray" as Tone };
  return (
    <span className={cn("chip", `chip-${tone ?? s.tone}`, className)}>
      {dot && <i />}
      {label ?? s.label}
    </span>
  );
}

export function Money({ bdt: b, usd: u, className, align }: { bdt: number | string | null | undefined; usd?: number | string | null; className?: string; align?: "end" }) {
  const line = usdOpt(u);
  return (
    <span className={cn("inline-flex flex-col", align === "end" && "items-end", className)}>
      <span className="num">{bdt(b)}</span>
      {line && <span className="num text-[0.7188rem] font-normal text-mut">{line}</span>}
    </span>
  );
}

export function Kpi({ label, value, sub, usdValue, icon, tone }: { label: string; value: ReactNode; sub?: ReactNode; usdValue?: number | string | null; icon?: ReactNode; tone?: Tone }) {
  const line = usdOpt(usdValue);
  return (
    <div className="card relative flex min-w-0 flex-col gap-2.5 overflow-hidden px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.8125rem] text-fg/80">{label}</span>
        {icon && <span className="text-mut [&_svg]:size-4">{icon}</span>}
      </div>
      <div className="min-w-0">
        <div className="num truncate text-[1.5rem] font-semibold leading-tight tracking-tight">{value}</div>
        {line && <div className="num mt-0.5 text-[0.7812rem] text-mut">{line}</div>}
      </div>
      {sub && <div className="text-[0.7812rem] text-mut">{sub}</div>}
    </div>
  );
}
export function KpiGrid({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 | 5 }) {
  return <div className={cn("grid grid-cols-2 gap-3", cols === 3 && "lg:grid-cols-3", cols === 4 && "lg:grid-cols-4", cols === 5 && "lg:grid-cols-5")}>{children}</div>;
}

export function PageHeader({ title, sub, actions, eyebrow }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow && <div className="flex flex-wrap items-center gap-2">{eyebrow}</div>}
        <h1 className="h1">{title}</h1>
        {sub && <p className="max-w-2xl text-mut">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, hint, children, right, step }: { title: string; hint?: string; children: ReactNode; right?: ReactNode; step?: number }) {
  return (
    <section className="card animate-in overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          {step !== undefined && <span className="num grid size-6 place-items-center rounded-md bg-accent/15 text-[0.75rem] font-semibold text-accent">{step}</span>}
          <div>
            <div className="text-[0.875rem] font-semibold">{title}</div>
            {hint && <div className="text-[0.7812rem] text-mut">{hint}</div>}
          </div>
        </div>
        {right}
      </div>
      <div className="flex flex-col gap-4 p-5">{children}</div>
    </section>
  );
}

export function Panel({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("card overflow-hidden", className)}>
      {(title || right) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="text-[0.9375rem] font-semibold">{title}</div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-[0.8438rem]">
      <span className="shrink-0 text-mut">{label}</span>
      <span className="min-w-0 text-right">{value}</span>
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-xl bg-raised text-mut [&_svg]:size-5">{icon}</div>}
      <div className="font-medium">{title}</div>
      {body && <p className="mt-1 max-w-sm text-mut">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-raised", className)} />;
}
export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function Progress({ value, className, tone = "accent" }: { value: number; className?: string; tone?: "accent" | "ok" | "warn" | "bad" }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-line", className)}>
      <div className={cn("h-full rounded-full transition-all", { accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" }[tone])} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Segments<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="scroll-thin flex max-w-full gap-0.5 overflow-x-auto rounded-[0.5625rem] border border-line bg-surface p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 text-[0.8125rem] font-medium transition",
            value === o.value ? "bg-raised text-fg" : "text-mut hover:text-fg",
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="num text-[0.6875rem] text-mut">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[] }) {
  return (
    <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn(
            "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[0.8438rem] font-medium transition",
            value === t.value ? "border-accent text-fg" : "border-transparent text-mut hover:text-fg",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[0.125rem] data-[state=open]:animate-in" />
        <D.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-line bg-surface shadow-2xl outline-none",
            wide ? "max-w-2xl" : "max-w-lg",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <D.Title className="text-[1rem] font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-[0.8125rem] text-mut">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
            </div>
            <D.Close className="btn btn-ghost btn-icon -mr-2 -mt-1 h-8 w-8" aria-label="Close">
              <X />
            </D.Close>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Confirm({ open, onOpenChange, title, body, confirmLabel = "Confirm", danger, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; body?: string; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={body}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (e) {
                toast.error(errMsg(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

export function RejectDialog({ open, onOpenChange, title, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) setReason(""); }}
      title={title}
      description="The reason is saved and shown to the person who submitted it."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={!reason.trim()}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
                setReason("");
                onOpenChange(false);
              } catch (e) {
                toast.error(errMsg(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Reject
          </Button>
        </>
      }
    >
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection" rows={4} autoFocus />
    </Modal>
  );
}

export function ApproveReject({ label, onApprove, onReject, size = "sm" }: { label: string; onApprove: () => Promise<void>; onReject: (reason: string) => Promise<void>; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
      <Button
        size={size}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onApprove();
          } catch (e) {
            toast.error(errMsg(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Approve
      </Button>
      <Button size={size} variant="outline" onClick={() => setOpen(true)}>Reject</Button>
      <RejectDialog open={open} onOpenChange={setOpen} title={`Reject ${label}`} onConfirm={onReject} />
    </div>
  );
}

export function Avatar({ name, src, size = 32 }: { name?: string | null; src?: string | null; size?: number }) {
  const ini = (name || "?").split(/[ .@_-]/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("");
  if (src) return <img src={src} alt="" referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-accent/15 text-[0.75rem] font-semibold text-accent" style={{ width: size, height: size }}>
      {ini}
    </span>
  );
}
