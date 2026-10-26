import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Download, Eye, FileText, Loader2, Paperclip, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { downloadFile, openFile, uploadFile } from "@/lib/api";
import { errMsg, fileSize } from "@/lib/format";
import type { Attachment, UploadedFile } from "@/lib/types";
import { Button, Chip, cn } from "./ui";

export function FileLink({ path, name, size, demo }: { path?: string | null; name: string; size?: number | null; demo?: boolean }) {
  if (demo || !path || path === "demo")
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-mut">
        <FileText className="size-3.5 shrink-0" /> Demo file
      </span>
    );
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px]">
        <FileText className="size-3.5 shrink-0 text-mut" />
        <span className="truncate">{name}</span>
        {size ? <span className="num shrink-0 text-[11px] text-mut">{fileSize(size)}</span> : null}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => openFile(path).catch((e) => toast.error(errMsg(e)))}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[12px] font-medium text-fg transition hover:border-accent hover:text-accent"
        >
          <Eye className="size-3.5" /> View
        </button>
        <button
          type="button"
          onClick={() => downloadFile(path, name).catch((e) => toast.error(errMsg(e)))}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[12px] font-medium text-fg transition hover:border-accent hover:text-accent"
        >
          <Download className="size-3.5" /> Download
        </button>
      </span>
    </span>
  );
}

const ACCEPT = "image/*,application/pdf,.doc,.docx,.xls,.xlsx";

/** Uploads immediately to private storage. Supports drag and drop. */
export function FileField({ label, folder, value, onChange, required }: { label: string; folder: string; value: UploadedFile | null; onChange: (f: UploadedFile | null) => void; required?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  async function pick(f?: File) {
    if (!f) return;
    setBusy(true);
    try {
      onChange(await uploadFile(f, folder));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-dashed px-3.5 py-3 transition",
        value ? "border-ok/40 bg-ok/[0.04]" : over ? "border-accent bg-accent/[0.06]" : "border-line bg-bg",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", value ? "bg-ok/10 text-ok" : "bg-raised text-mut")}>
          {value ? <CheckCircle2 className="size-4" /> : <Paperclip className="size-4" />}
        </span>
        <div className="min-w-0">
          <div className="text-[0.8438rem] font-medium">{label}</div>
          <div className="truncate text-[0.75rem] text-mut">{value ? `${value.name} · ${fileSize(value.size)}` : "Drop a file or click upload. PDF, image, Word or Excel."}</div>
        </div>
      </div>
      <input ref={ref} type="file" className="hidden" accept={ACCEPT} onChange={(e) => pick(e.target.files?.[0])} />
      <div className="flex shrink-0 items-center gap-1.5">
        {!value && required && <Chip label="Required" tone="gray" dot={false} className="hidden sm:inline-flex" />}
        {value && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onChange(null)} aria-label="Remove file">
            <X />
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => ref.current?.click()}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload />}
          {value ? "Replace" : "Upload"}
        </Button>
      </div>
    </div>
  );
}

export function FileActions({ path, name }: { path: string; name: string }) {
  const btn = "inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[0.75rem] font-medium text-fg transition hover:border-accent hover:text-accent";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <button type="button" className={btn} onClick={() => openFile(path).catch((e) => toast.error(errMsg(e)))}><Eye className="size-3.5" /> View</button>
      <button type="button" className={btn} onClick={() => downloadFile(path, name).catch((e) => toast.error(errMsg(e)))}><Download className="size-3.5" /> Download</button>
    </span>
  );
}

export function AttachmentList({ entityId, expected }: { entityId: string; expected?: readonly string[] }) {
  const { data, isLoading } = useQuery({
    queryKey: ["attachments", entityId],
    queryFn: async () => {
      const { data, error } = await supabase.from("attachments").select("*").eq("entity_id", entityId).order("created_at");
      if (error) throw error;
      return data as Attachment[];
    },
  });
  if (isLoading) return <p className="px-4 py-3 text-[0.8125rem] text-mut">Loading files</p>;
  const list = data ?? [];
  const order = expected ? [...list].sort((a, b) => expected.indexOf(a.doc_type) - expected.indexOf(b.doc_type)) : list;
  const missing = expected ? expected.filter((d) => !list.some((a) => a.doc_type === d)) : [];
  if (!order.length && !missing.length) return <p className="px-4 py-3 text-[0.8125rem] text-mut">No files.</p>;
  return (
    <ul className="divide-y divide-line/70">
      {order.map((a, i) => {
        const demo = a.is_demo || !a.file_path || a.file_path === "demo";
        return (
          <li key={a.id} className="grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)_auto]">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="num w-5 shrink-0 text-[0.75rem] text-mut">{i + 1}.</span>
              <span className="truncate text-[0.8438rem] font-medium">{a.doc_type}</span>
            </div>
            <div className="flex min-w-0 items-center gap-1.5 pl-7 text-[0.8125rem] sm:pl-0">
              <FileText className="size-3.5 shrink-0 text-mut" />
              <span className="truncate" title={a.file_name}>{demo ? "Demo file" : a.file_name}</span>
              {a.file_size ? <span className="num shrink-0 text-[0.6875rem] text-mut">{fileSize(a.file_size)}</span> : null}
            </div>
            <div className="pl-7 sm:pl-0">{demo ? <span className="text-[0.75rem] text-mut">Not available</span> : <FileActions path={a.file_path} name={a.file_name} />}</div>
          </li>
        );
      })}
      {missing.map((d) => (
        <li key={d} className="grid grid-cols-1 items-center gap-x-4 px-4 py-3 sm:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)_auto]">
          <span className="truncate pl-7 text-[0.8438rem] font-medium">{d}</span>
          <span className="pl-7 text-[0.8125rem] text-mut sm:pl-0">Missing</span>
          <span />
        </li>
      ))}
    </ul>
  );
}
