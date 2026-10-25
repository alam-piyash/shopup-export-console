export type AppRole = "operation" | "admin";
export type TradeStatus = "pending_approval" | "active" | "revision_pending" | "closed" | "rejected";
export type ApprovalStatus = "pending_approval" | "approved" | "rejected" | "withdrawn";
export type Num = number | string;

export type Trade = {
  id: string;
  code: string;
  exporter: string;
  exporter_address: string | null;
  exporter_phone: string | null;
  exporter_email: string | null;
  importer_name: string;
  importer_country: string;
  buyer_cr_no: string | null;
  buyer_vat_no: string | null;
  buyer_address: string | null;
  notify_parties: { name: string; address: string }[];
  products: string;
  sales_contract_no: string;
  contract_date: string;
  shipping_mark: string | null;
  country_of_origin: string | null;
  country_of_destination: string | null;
  expiry_date: string | null;
  shipment_timeline: string | null;
  carriage_by: string | null;
  departure_port: string | null;
  point_of_entry: string | null;
  payment_type: string | null;
  payment_terms: string | null;
  tolerance_pct: Num | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_routing_no: string | null;
  bank_swift: string | null;
  bank_account_name: string | null;
  bank_account_no: string | null;
  incentive_terms: string | null;
  notes: string | null;
  contract_amount: Num;
  contract_amount_usd: Num | null;
  exchange_rate: Num | null;
  contract_extra: Record<string, unknown>;
  status: TradeStatus;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  // overview
  exp_issued: Num;
  exp_issued_usd: Num | null;
  collected: Num;
  collected_usd: Num | null;
  exp_count: number;
  pending_revision_id: string | null;
  latest_amendment_no: number | null;
};

export type Exp = {
  id: string;
  code: string;
  trade_id: string;
  shipment_id: string | null;
  exp_no: string | null;
  awb_no: string | null;
  flight_no: string | null;
  shipment_date: string | null;
  amount: Num;
  amount_usd: Num | null;
  type: "regular" | "advance";
  status: "open" | "closed";
  created_by: string;
  is_demo: boolean;
  created_at: string;
  closed_at: string | null;
  trade_code: string;
  importer_name: string;
  trade_status: TradeStatus;
  collection_status: ApprovalStatus | null;
  collection_code: string | null;
  incentive_status: ApprovalStatus | null;
  docs_final: number;
  docs_uploaded: number;
};

export type ExpDoc = {
  id: string;
  exp_id: string;
  doc_type: string;
  sort_order: number;
  status: "missing" | "uploaded" | "final";
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  uploaded_at: string | null;
  finalized_at: string | null;
  is_demo: boolean;
};

export type TradeItem = {
  id: string;
  trade_id: string;
  sort_order: number;
  description: string;
  carton_size: string | null;
  hs_code: string | null;
  incoterm: string | null;
  quantity_kg: Num;
  rate_per_kg: Num;
  rate_usd_per_kg: Num | null;
  line_total: Num;
};

export type Amendment = {
  id: string;
  trade_id: string;
  amendment_no: number;
  amendment_date: string;
  reason: string;
  old_amount: Num;
  new_amount: Num;
  old_items: unknown[] | null;
  new_items: unknown[] | null;
  old_expiry_date: string | null;
  new_expiry_date: string | null;
  old_shipment_timeline: string | null;
  new_shipment_timeline: string | null;
  exp_changes: { exp_id: string; code: string; status: string; old_amount: Num; new_amount: Num }[];
  status: ApprovalStatus;
  requested_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  is_demo: boolean;
  created_at: string;
};

export type Attachment = {
  id: string;
  entity_type: string;
  entity_id: string;
  doc_type: string;
  file_path: string;
  file_name: string;
  file_size: number | null;
  is_demo: boolean;
  created_at: string;
};

export type Activity = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  trade_id: string | null;
  action: string;
  details: Record<string, unknown>;
  actor_id: string | null;
  is_demo: boolean;
  created_at: string;
};

export type Collection = {
  id: string;
  code: string;
  trade_id: string;
  amount: Num;
  amount_usd: Num | null;
  bank_reference: string | null;
  status: ApprovalStatus;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  is_demo: boolean;
  created_at: string;
  trades: { code: string; importer_name: string } | null;
  collection_exps: { amount: Num; exps: { code: string } | null }[];
};

export type Incentive = {
  id: string;
  code: string;
  exp_amount: Num;
  net_proceed: Num;
  freight: Num;
  fob: Num;
  incentive_pct: Num;
  incentive_amount: Num;
  net_proceed_usd: Num | null;
  freight_usd: Num | null;
  status: ApprovalStatus;
  created_by: string;
  approved_at: string | null;
  rejection_reason: string | null;
  is_demo: boolean;
  created_at: string;
  incentive_exps: { amount: Num; exps: { code: string; trades: { code: string; importer_name: string } | null } | null }[];
};

export type UploadedFile = { path: string; name: string; size: number };

export type Me = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: AppRole | null;
};
