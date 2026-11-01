import { useEntityDocs, entityDocModels, type EntityType } from "@/lib/documents";
import { useRefresh } from "@/lib/api";
import { DocList, DocPanel } from "./docs";

/** Document panel for one record of a module (collection, incentive, amendment, amount change). */
export function EntityDocPanel({ entityType, entityId, folder, title = "Documents", hint, stages }: { entityType: EntityType; entityId: string; folder: string; title?: string; hint?: string; stages?: string[] }) {
  const refresh = useRefresh();
  const { data, isLoading } = useEntityDocs(entityType, [entityId]);
  if (isLoading) return <section className="card p-5 text-[0.8125rem] text-mut">Loading documents</section>;
  return <DocPanel title={title} docs={entityDocModels(data, { entityId, folder, refresh, stages })} hint={hint} />;
}

/** Cards only, for use inside another card (amendments). */
export function EntityDocList({ entityType, entityId, folder, stages }: { entityType: EntityType; entityId: string; folder: string; stages?: string[] }) {
  const refresh = useRefresh();
  const { data } = useEntityDocs(entityType, [entityId]);
  const docs = entityDocModels(data, { entityId, folder, refresh, stages });
  if (!docs.length) return null;
  return <DocList docs={docs} small />;
}
