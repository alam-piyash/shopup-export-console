import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { rpc } from "./api";
import type { DocModel, DocStatus, DocVersion } from "@/components/docs";

export type EntityType = "collection" | "incentive" | "trade_amendment" | "exp_amount_change";

type DocRow = {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  doc_type: string;
  sort_order: number;
  status: DocStatus;
  finalized_at: string | null;
  document_versions: (DocVersion & { document_id: string })[];
};

/** Documents (with their versions) for one or more records of a module. */
export function useEntityDocs(entityType: EntityType, ids: string[]) {
  const key = [...ids].sort().join(",");
  return useQuery({
    queryKey: ["documents", entityType, key],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*, document_versions(*)")
        .eq("entity_type", entityType)
        .in("entity_id", ids)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as DocRow[];
    },
  });
}

/** Builds card models for module documents. Missing expected slots show as Not uploaded only when listed. */
export function entityDocModels(
  rows: DocRow[] | undefined,
  opts: { entityId: string; folder: string; refresh: () => void; stages?: string[]; names?: Record<string, string> },
): DocModel[] {
  return (rows ?? [])
    .filter((r) => r.entity_id === opts.entityId)
    .map((r) => ({
      key: r.id,
      name: opts.names?.[r.doc_type] ?? r.doc_type,
      status: r.status,
      finalizedAt: r.finalized_at,
      versions: [...(r.document_versions ?? [])].sort((a, b) => b.version - a.version),
      stages: opts.stages,
      folder: opts.folder,
      onAdd: async ({ file, stage, note, submittedOn }) => {
        await rpc("add_document_version", { p_doc: r.id, p_file: file, p_stage: stage, p_note: note || null, p_submitted_on: submittedOn || null });
        opts.refresh();
      },
      onFinal: async () => {
        await rpc("finalize_document", { p_doc: r.id });
        opts.refresh();
      },
    }));
}
