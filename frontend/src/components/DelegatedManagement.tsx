import { useEffect, useState } from "react";
import { Check, UserPlus, X, Save } from "lucide-react";
import { approveSelfRegistration, rejectSelfRegistration, getPendingRegistrations, getUsers, getRoles, getServingManagement, getVolunteerAdminRecords, updateUser, inviteUser, deactivateUser, resendInvite, sendPasswordReset, type User, type Role, type ServingManagement, type VolunteerAdminRecord, type SessionUser } from "../api";
import { VolunteerReview } from "./VolunteerReview";
import { useConfirmationDialog } from "./ConfirmationDialog";
import { useDurableChange } from "../changePolling";

export function DelegatedManagement({ sessionUser }: { sessionUser: SessionUser }) {
  const permissions = new Set(sessionUser.permissions);
  const canApprove = permissions.has("users:approve");
  const canAdmin = permissions.has("users:admin");
  const canManageTeams = permissions.has("serving:manage");
  const [users, setUsers] = useState<User[]>([]);
  const [registrations, setRegistrations] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [teams, setTeams] = useState<ServingManagement>({ areas: [], members: [] });
  const [rows, setRows] = useState<VolunteerAdminRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedArea, setSelectedArea] = useState("");
  const [invitationLink, setInvitationLink] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(canAdmin || canApprove ? "accounts" : "teams");
  const { confirm, confirmationDialog } = useConfirmationDialog();
  async function load() {
    try {
      const [nextUsers, pending, nextRoles, nextTeams, nextRows] = await Promise.all([
        canAdmin ? getUsers() : Promise.resolve([]), canApprove ? getPendingRegistrations() : Promise.resolve([]),
        canAdmin ? getRoles() : Promise.resolve([]), canManageTeams ? getServingManagement() : Promise.resolve({ areas: [], members: [] }),
        canManageTeams ? getVolunteerAdminRecords() : Promise.resolve([]),
      ]);
      setUsers(nextUsers); setRegistrations(pending); setRoles(nextRoles); setTeams(nextTeams); setRows(nextRows);
      setSelectedId((current) => nextTeams.members.some((member) => member.id === current) ? current : nextTeams.members[0]?.id ?? "");
      setSelectedArea((current) => nextTeams.areas.some((area) => area.key === current) ? current : nextTeams.areas[0]?.key ?? "");
    } catch (error) { setMessage(String(error)); }
  }
  useEffect(() => { void load(); }, [sessionUser]);
  useDurableChange(() => { void load(); }, true, ["identity"]);
  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage("");
    try { await action(); await load(); setMessage(success); } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }
  async function decide(user: User, approve: boolean) {
    if (!approve && !await confirm({ title: "Reject registration", message: `Remove ${user.name}'s registration request?`, confirmLabel: "Reject", tone: "danger" })) return;
    await act(() => approve ? approveSelfRegistration(user.id) : rejectSelfRegistration(user.id), approve ? "Registration approved." : "Registration rejected.");
  }
  const selectedMember = teams.members.find((member) => member.id === selectedId);
  const directRoleNames = teams.areas.filter((area) => selectedMember?.direct_area_keys.includes(area.key)).flatMap((area) => area.legacy_role_name ? [area.legacy_role_name] : []);
  const memberRows = rows.filter((row) => row.user_id === selectedId && row.preference.area.key === selectedArea);
  return <section className="editor-panel delegated-management">{confirmationDialog}
    <div className="tab-row flat-admin-tabs">{canAdmin || canApprove ? <button type="button" className={tab === "accounts" ? "active" : ""} onClick={() => setTab("accounts")}>Users & approvals</button> : null}{canManageTeams ? <button type="button" className={tab === "teams" ? "active" : ""} onClick={() => setTab("teams")}>Manage teams</button> : null}</div>
    {message ? <p className="form-message" role="status">{message}</p> : null}
    {tab === "accounts" ? <>
      <h2>Registration approvals</h2>{registrations.length ? registrations.map((user) => <div className="admin-role-row" key={user.id}><span><strong>{user.name}</strong> · {user.email}{!user.email_confirmed ? " · Email unverified" : ""}</span><div className="action-row"><button type="button" disabled={busy} className="primary-button" onClick={() => void decide(user, true)}><Check size={16} /> Approve</button><button type="button" disabled={busy} className="danger-button" onClick={() => void decide(user, false)}><X size={16} /> Reject</button></div></div>) : <p className="muted-copy">No registrations awaiting approval.</p>}
      {canAdmin ? <><h2>User accounts & access</h2><p className="muted-copy">Manage ordinary accounts and their workspace roles. Full administrators manage accounts with delegated management powers.</p>
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const form = event.currentTarget; void act(() => inviteUser({ name: String(data.get("name")), email: String(data.get("email")), role_names: ["viewer"], active: true, email_confirmed: false, start_page: null, username: null, calendar_color: null, calendar_avatar: null, worship_max_sundays_per_month: null, sunday_school_max_sundays_per_month: null }).then((result) => { form.reset(); if (!result.email_sent) setInvitationLink(result.invitation_url); }), "Invitation created."); }}>
          <label>Name<input name="name" required /></label><label>Email<input name="email" type="email" required /></label><button className="primary-button" disabled={busy} type="submit"><UserPlus size={16} /> Invite user</button>
        </form><InvitationLink value={invitationLink} />
        {users.filter((user) => !user.registration_pending).map((user) => <AccountRow key={user.id} user={user} roles={roles} busy={busy} onSave={(name, email, role_names) => act(() => updateUser(user.id, { name, email, role_names }), "Account saved.")} onDeactivate={async () => { if (await confirm({ title: "Deactivate user", message: `Deactivate ${user.name}?`, confirmLabel: "Deactivate", tone: "danger" })) await act(() => deactivateUser(user.id), "Account deactivated."); }} onReactivate={() => act(() => updateUser(user.id, { active: true }), "Account reactivated.")} onReset={() => act(async () => { if (user.invite_pending) { const result = await resendInvite(user.id); if (!result.email_sent) setInvitationLink(result.invitation_url); } else { const result = await sendPasswordReset(user.id); if (!result.email_sent) setInvitationLink(result.reset_url); } }, user.invite_pending ? "Invitation created." : "Password reset created.")} />)}
      </> : null}
    </> : <>
      <h2>Team management</h2><p className="muted-copy">Invite members and review serving requests for the roles you manage. Invitations require the member’s acceptance.</p>
      <div className="form-grid"><label>Serving role<select value={selectedArea} onChange={(event) => setSelectedArea(event.target.value)}>{teams.areas.map((area) => <option key={area.id} value={area.key}>{area.category} · {area.name}</option>)}</select></label><label>Member<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{teams.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label></div>
      {selectedMember?.direct_area_keys.includes(selectedArea) ? <p className="muted-copy">This member has a directly assigned workspace role. An account administrator manages that assignment.</p> : null}
      <div onClickCapture={() => setMessage("")}><VolunteerReview key={`${selectedId}:${selectedArea}`} areas={teams.areas.filter((area) => area.key === selectedArea)} directRoleNames={directRoleNames} userId={selectedId || undefined} rows={memberRows} onChanged={load} /></div>
      <h3>Team list</h3>{teams.members.filter((member) => member.direct_area_keys.includes(selectedArea)).map((member) => <button className="stack-row" key={member.id} type="button" onClick={() => setSelectedId(member.id)}><strong>{member.name}</strong><span>Assigned directly</span></button>)}{rows.filter((row) => row.preference.area.key === selectedArea).map((row) => <button className="stack-row" key={row.preference.id} type="button" onClick={() => setSelectedId(row.user_id)}><strong>{row.user_name}</strong><span>{row.preference.status}{row.preference.admin_attention_pending ? " · Needs review" : ""}</span></button>)}
    </>}
  </section>;

}

function InvitationLink({ value }: { value: string }) { return value ? <label>Invitation or reset link<input aria-label="Invitation or reset link" readOnly value={value} /></label> : null; }

function AccountRow({ user, roles, busy, onSave, onDeactivate, onReactivate, onReset }: { user: User; roles: Role[]; busy: boolean; onSave: (name: string, email: string, roles: string[]) => Promise<void>; onDeactivate: () => Promise<void>; onReactivate: () => Promise<void>; onReset: () => Promise<void> }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [selected, setSelected] = useState(user.roles);
  useEffect(() => { setName(user.name); setEmail(user.email); setSelected(user.roles); }, [user.name, user.email, user.roles.join(",")]);
  return <details className="subsection-panel"><summary>{user.name} · {user.active ? "Active" : user.registration_pending ? "Awaiting approval" : "Inactive"}</summary><form onSubmit={(event) => { event.preventDefault(); void onSave(name, email, selected); }}>
    <div className="form-grid"><label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label></div>
    <fieldset><legend>Workspace roles</legend>{roles.map((role) => <label className="admin-role-toggle" key={role.id}><input type="checkbox" checked={selected.includes(role.name)} onChange={() => setSelected(selected.includes(role.name) ? selected.filter((name) => name !== role.name) : [...selected, role.name])} /><span><strong>{role.name.replace(/_/g, " ")}</strong><small>{role.description}</small></span></label>)}</fieldset>
    <div className="action-row"><button className="primary-button" disabled={busy} type="submit"><Save size={16} /> Save</button>{user.active ? <><button className="text-button" disabled={busy} type="button" onClick={() => void onReset()}>{user.invite_pending ? "Resend invite" : "Reset password"}</button><button className="danger-button" disabled={busy} type="button" onClick={() => void onDeactivate()}>Deactivate</button></> : !user.registration_pending ? <button className="text-button" disabled={busy} type="button" onClick={() => void onReactivate()}>Reactivate</button> : null}</div>
  </form></details>;
}
