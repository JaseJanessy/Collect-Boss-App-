"use client";

import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/section-card";
import type { BusinessMembershipRow, BusinessRoleSettingsRow, TenantRole } from "@/lib/supabase/types";

const roles: Exclude<TenantRole, "owner">[] = ["admin", "manager", "staff", "viewer"];
type Settings = Pick<BusinessRoleSettingsRow,
  "manager_can_approve_settlements" | "manager_can_approve_write_offs" | "manager_can_submit_document_intakes">;

export function TeamAccessPanel() {
  const [members, setMembers] = useState<BusinessMembershipRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<TenantRole, "owner">>("staff");
  const [message, setMessage] = useState("");
  const [allowed, setAllowed] = useState(true);
  const load = useCallback(async () => {
    const response = await fetch("/api/team-members", { cache: "no-store" });
    if (response.status === 403) return setAllowed(false);
    const body = await response.json() as { members?: BusinessMembershipRow[]; roleSettings?: Settings; error?: string };
    if (!response.ok) return setMessage(body.error ?? "Unable to load team access.");
    setMembers(body.members ?? []); setSettings(body.roleSettings ?? null);
  }, []);
  useEffect(() => {
    queueMicrotask(() => { void load(); });
  }, [load]);
  if (!allowed) return null;

  async function invite() {
    const response = await fetch("/api/team-members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) });
    const body = await response.json() as { error?: string };
    setMessage(response.ok ? "Invitation recorded. Access activates when that email signs in." : body.error ?? "Unable to invite member.");
    if (response.ok) { setEmail(""); await load(); }
  }
  async function updateMember(id: string, patch: Record<string, string>) {
    const response = await fetch(`/api/team-members/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    setMessage(response.ok ? "Team access updated and audited." : "Unable to update member.");
    if (response.ok) await load();
  }
  async function saveSettings(next: Settings) {
    const response = await fetch("/api/role-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    setMessage(response.ok ? "Manager approval controls updated and audited." : "Unable to update manager controls.");
    if (response.ok) setSettings(next);
  }

  return <SectionCard title="Team Access & Roles">
    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
      <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="team@example.com" className="rounded-xl border border-gray-200 px-3 py-2 text-xs" />
      <select value={role} onChange={(event) => setRole(event.target.value as typeof role)} className="rounded-xl border border-gray-200 px-2 py-2 text-xs">{roles.map((value) => <option key={value}>{value}</option>)}</select>
      <button type="button" disabled={!email.trim()} onClick={() => void invite()} className="rounded-xl bg-[#0D1B3D] px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Invite</button>
    </div>
    <div className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-100">
      {members.map((member) => <div key={member.id} className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{member.invited_email ?? member.user_id}</p><p className="text-[10px] text-gray-400">{member.status}</p></div>
        {member.role === "owner" ? <strong className="text-xs">owner</strong> : <>
          <select value={member.role} onChange={(event) => void updateMember(member.id, { role: event.target.value })} className="rounded-lg border border-gray-200 px-2 py-1 text-xs">{roles.map((value) => <option key={value}>{value}</option>)}</select>
          {member.status === "active" && <button type="button" onClick={() => void updateMember(member.id, { status: "suspended" })} className="text-[11px] font-semibold text-red-600">Suspend</button>}
        </>}
      </div>)}
    </div>
    {settings && <div className="mt-3 rounded-xl bg-gray-50 p-3"><p className="text-xs font-bold">Manager approvals</p>
      {([["manager_can_approve_settlements", "Allow settlement approval"], ["manager_can_approve_write_offs", "Allow write-off approval"], ["manager_can_submit_document_intakes", "Allow document draft submission"]] as const).map(([key, label]) =>
        <label key={key} className="mt-2 flex gap-2 text-xs text-gray-600"><input type="checkbox" checked={settings[key]} onChange={(event) => void saveSettings({ ...settings, [key]: event.target.checked })} />{label}</label>)}
    </div>}
    {message && <p role="status" className="mt-2 text-[11px] text-gray-600">{message}</p>}
  </SectionCard>;
}
