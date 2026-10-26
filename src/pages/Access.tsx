import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase, ALLOWED_DOMAIN } from "@/lib/supabase";
import { rpc, useMe, useRefresh } from "@/lib/api";
import { errMsg, fmtDateTime } from "@/lib/format";
import type { AppRole } from "@/lib/types";
import { Avatar, Button, Chip, Confirm, Field, Input, LoadingRows, PageHeader, Panel, Select } from "@/components/ui";

type Person = { id: string; email: string; name: string | null; avatar: string | null; role: AppRole | null; last: string | null; pending?: boolean };

export default function Access() {
  const qc = useQueryClient();
  const refreshAll = useRefresh();
  const { data: me } = useMe();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AppRole>("operation");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Person | null>(null);
  const [confirmDemo, setConfirmDemo] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["access"],
    queryFn: async () => {
      const [p, r, pre] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at"),
        supabase.from("user_roles").select("*"),
        supabase.from("role_preassignments").select("*").order("created_at"),
      ]);
      if (p.error) throw p.error;
      if (r.error) throw r.error;
      if (pre.error) throw pre.error;
      const roles = Object.fromEntries((r.data ?? []).map((x) => [x.user_id, x.role]));
      const people: Person[] = (p.data ?? []).map((x) => ({ id: x.id, email: x.email, name: x.full_name, avatar: x.avatar_url, role: roles[x.id] ?? null, last: x.last_sign_in_at }));
      const pending: Person[] = (pre.data ?? []).map((x) => ({ id: x.email, email: x.email, name: x.full_name, avatar: null, role: x.role, last: null, pending: true }));
      return [...people, ...pending];
    },
  });
  const { data: demoCount } = useQuery({ queryKey: ["demo-count"], queryFn: () => rpc<number>("demo_count") });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["access"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };
  const admins = (data ?? []).filter((p) => !p.pending && p.role === "admin").length;
  const emailOk = new RegExp(`^[^@\\s]+@${ALLOWED_DOMAIN.replace(/\./g, "\\.")}$`, "i").test(email.trim());

  async function preassign() {
    setBusy(true);
    try {
      await rpc("preassign_role", { p_email: email, p_name: name, p_role: role });
      toast.success("Role saved. It applies when they sign in.");
      setEmail(""); setName(""); setRole("operation");
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeRole(p: Person, r: AppRole) {
    try {
      if (p.pending) await rpc("preassign_role", { p_email: p.email, p_name: p.name ?? "", p_role: r });
      else await rpc("set_user_role", { p_user: p.id, p_role: r });
      toast.success("Role updated");
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  }
  async function remove(p: Person) {
    if (p.pending) await rpc("delete_preassignment", { p_email: p.email });
    else await rpc("remove_access", { p_user: p.id });
    toast.success("Access removed");
    refresh();
  }
  const lastAdminLock = (p: Person) => !p.pending && p.role === "admin" && admins <= 1;

  return (
    <>
      <PageHeader title="Access control" sub={`Everyone with a ${ALLOWED_DOMAIN} Google account gets Operation on first sign in. Pre-assign a role to change that.`} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Pre-assign a role">
          <div className="grid grid-cols-1 items-end gap-3 p-5 sm:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_10rem_auto]">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`name@${ALLOWED_DOMAIN}`} /></Field>
            <Field label="Role">
              <Select value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
                <option value="operation">Operation</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>
            <Button disabled={!emailOk} loading={busy} onClick={preassign}>{!busy && <UserPlus />} Save</Button>
          </div>
        </Panel>
        <div className="card p-5">
          <div className="lbl">Demo data</div>
          <div className="num mt-1 text-[1.75rem] font-semibold">{demoCount ?? 0}</div>
          <p className="text-[0.8125rem] text-mut">Demo trades, EXPs, collections, incentives and amendments.</p>
          <Button variant="outline" className="mt-3 w-full" disabled={!demoCount} onClick={() => setConfirmDemo(true)}><Trash2 /> Remove demo data</Button>
        </div>
      </div>

      <Panel title={<>People <span className="num ml-1 text-mut">{data?.length ?? 0}</span></>}>
        {isLoading ? <LoadingRows /> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="tbl min-w-[47.5rem]">
              <thead><tr>{["Name", "Email", "Role", "Last sign in", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {(data ?? []).map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={p.name || p.email} src={p.avatar} size={30} />
                        <span className="font-medium">{p.name || "Not set"}</span>
                        {p.id === me?.id && <Chip label="You" tone="info" dot={false} />}
                        {p.pending && <Chip label="Not signed in yet" tone="gray" dot={false} />}
                        {!p.pending && !p.role && <Chip label="No access" tone="bad" dot={false} />}
                      </div>
                    </td>
                    <td className="text-mut">{p.email}</td>
                    <td className="w-44">
                      <Select value={p.role ?? ""} onChange={(e) => changeRole(p, e.target.value as AppRole)} disabled={lastAdminLock(p)} placeholder={p.role ? undefined : "No role"}>
                        <option value="operation">Operation</option>
                        <option value="admin">Admin</option>
                      </Select>
                    </td>
                    <td className="num text-mut">{p.last ? fmtDateTime(p.last) : "Never"}</td>
                    <td className="text-right">
                      <Button variant="outline" size="icon" disabled={lastAdminLock(p) || (!p.pending && !p.role)} onClick={() => setRemoving(p)} aria-label="Remove access"><Trash2 /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {admins <= 1 && <p className="text-[0.7812rem] text-mut">The last admin cannot be demoted or removed.</p>}

      <Confirm open={confirmDemo} onOpenChange={setConfirmDemo} danger title="Remove all demo data?" body="This deletes every demo trade, EXP, collection, incentive and amendment. Real records are not touched." confirmLabel="Remove demo data"
        onConfirm={async () => { await rpc("remove_demo_data"); toast.success("Demo data removed"); refreshAll(); }} />
      <Confirm open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} danger title={`Remove access for ${removing?.name || removing?.email}?`} body="They will no longer be able to use Export Console. You can grant a role again later." confirmLabel="Remove"
        onConfirm={() => remove(removing!)} />
    </>
  );
}
