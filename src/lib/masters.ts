import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type Notify = { name: string; address: string };

export type CompanyProfile = {
  id: string;
  label: string;
  legal_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  signatory_name: string | null;
  signatory_designation: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_routing_no: string | null;
  bank_swift: string | null;
  bank_account_name: string | null;
  bank_account_no: string | null;
  shipping_mark: string | null;
  sc_prefix: string | null;
  default_terms: {
    country_of_origin?: string;
    carriage_by?: string;
    departure_port?: string;
    payment_terms?: string;
    tolerance_pct?: number;
    notify_parties?: Notify[];
  };
  is_default: boolean;
  is_active: boolean;
};

export type Buyer = {
  id: string;
  name: string;
  cr_no: string | null;
  vat_no: string | null;
  address: string | null;
  country: string | null;
  notify_parties: Notify[];
  point_of_entry: string | null;
  is_active: boolean;
};

export type Product = {
  id: string;
  description: string;
  carton_size: string | null;
  hs_code: string | null;
  incoterm: string | null;
  rate_usd_per_kg: number | string | null;
  is_active: boolean;
};

export type ContractDoc = {
  id: string;
  trade_id: string;
  version: number;
  source: "generated" | "uploaded";
  status: "draft" | "signed";
  file_path: string;
  file_name: string;
  file_size: number | null;
  note: string | null;
  uploaded_by: string | null;
  created_at: string;
  signed_by: string | null;
  signed_at: string | null;
};

function useTable<T>(table: string, order: string) {
  return useQuery({
    queryKey: [table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select("*").order(order);
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

export const useCompanyProfiles = () => useTable<CompanyProfile>("company_profiles", "label");
export const useBuyers = () => useTable<Buyer>("buyers", "name");
export const useProducts = () => useTable<Product>("products", "description");

export function useContractDocs(tradeId: string | undefined) {
  return useQuery({
    queryKey: ["contract_documents", tradeId],
    enabled: !!tradeId,
    queryFn: async () => {
      const { data, error } = await supabase.from("contract_documents").select("*").eq("trade_id", tradeId!).order("version", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContractDoc[];
    },
  });
}

/** Item lines that represent freight are stored as a normal line with this description. */
export const FREIGHT_LABEL = "Freight Cost (Subject to Change)";
export const isFreight = (description?: string | null) => /^\(?\+?\)?\s*freight cost/i.test((description ?? "").trim());

/** Next free SC number for a prefix, for example VEG/SU/39. */
export function nextScNo(prefix: string | null | undefined, existing: string[]) {
  if (!prefix) return "";
  const nums = existing
    .filter((s) => s.toUpperCase().startsWith(prefix.toUpperCase()))
    .map((s) => parseInt(s.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n));
  return `${prefix}${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

/** Follow-up checkpoints at 25, 50, 75 and 100 percent of the shipment period. */
export function followupCheckpoints(start?: string | null, end?: string | null) {
  if (!start || !end) return [];
  const s = new Date(start + "T00:00:00").getTime();
  const e = new Date(end + "T00:00:00").getTime();
  if (!(e > s)) return [];
  const days = Math.round((e - s) / 86400000);
  return [1, 2, 3, 4].map((k) => {
    const day = Math.round((days * k) / 4);
    const date = new Date(s + day * 86400000).toISOString().slice(0, 10);
    return { checkpoint: k, day, days, date };
  });
}
