import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  buildAbsoluteApiUrl,
  acknowledgeVolunteerAttention,
  approveSelfRegistration,
  deactivateUser,
  disconnectGoogleDrive,
  getGoogleDriveStatus,
  getAdminSiteContent,
  getRoles,
  getServingAreas,
  getUsers,
  getVolunteerAdminRecords,
  type GoogleDriveStatus,
  inviteUser,
  resendInvite,
  rejectSelfRegistration,
  sendPasswordReset,
  updateUser,
  updateSiteContentBlock,
  type PasswordResetAdminResponse,
  type Role,
  type ServingArea,
  type User,
  type UserInvitePayload,
  type UserInviteResponse,
  type VolunteerAdminRecord,
} from "../api";
import { useDurableChange } from "../changePolling";
import { useConfirmationDialog } from "./ConfirmationDialog";
import { AdminAvailabilityPanel } from "./AdminAvailabilityPanel";
import { AudioSceneManager } from "./AudioSceneManager";
import { ServingRoleManager } from "./ServingRoleManager";
import { PlanTypeManager } from "./PlanTypeManager";
import { VolunteerReview } from "./VolunteerReview";

interface UserFormState {
  name: string;
  email: string;
  username: string;
  start_page: string;
  calendar_color: string;
  calendar_avatar: string;
  worship_max_sundays_per_month: string;
  sunday_school_max_sundays_per_month: string;
  email_confirmed: boolean;
  active: boolean;
  role_names: string[];
}

function formFromUser(user: User): UserFormState {
  return {
    name: user.name,
    email: user.email,
    username: user.username,
    start_page: user.start_page ?? "",
    calendar_color: user.calendar_color || "teacher-a",
    calendar_avatar: user.calendar_avatar || "",
    worship_max_sundays_per_month: user.worship_max_sundays_per_month?.toString() ?? "",
    sunday_school_max_sundays_per_month: user.sunday_school_max_sundays_per_month?.toString() ?? "",
    email_confirmed: user.email_confirmed,
    active: user.active,
    role_names: user.roles,
  };
}

function payloadFromForm(form: UserFormState): UserInvitePayload {
  const roleNames = form.role_names.some((roleName) => roleName !== "viewer")
    ? Array.from(new Set(["viewer", ...form.role_names]))
    : form.role_names.length ? form.role_names : ["viewer"];
  return {
    name: form.name,
    email: form.email,
    username: form.username || null,
    start_page: form.start_page || null,
    calendar_color: form.calendar_color || null,
    calendar_avatar: form.calendar_avatar || null,
    worship_max_sundays_per_month: form.worship_max_sundays_per_month === "" ? null : Number(form.worship_max_sundays_per_month),
    sunday_school_max_sundays_per_month: form.sunday_school_max_sundays_per_month === "" ? null : Number(form.sunday_school_max_sundays_per_month),
    email_confirmed: form.email_confirmed,
    active: form.active,
    role_names: roleNames,
  };
}

function suggestedUsername(name: string, users: User[]) {
  const parts = name.trim().toLowerCase().split(/\s+/).map((part) => part.replace(/[^a-z0-9]/g, "")).filter(Boolean);
  if (!parts.length) return "";
  const base = parts[0].length >= 2 ? parts[0].slice(0, 72) : `user-${parts[0]}`;
  const used = new Set(users.map((user) => user.username));
  if (!used.has(base)) return base;

  const initials = parts.slice(1).map((part) => part[0]).join("");
  const collisionBase = initials ? `${base.slice(0, 80 - initials.length)}${initials}` : base;
  if (!used.has(collisionBase)) return collisionBase;

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${collisionBase.slice(0, 79 - String(suffix).length)}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

function formatRoleName(roleName: string) {
  return roleName
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatUserStatus(user: User) {
  if (user.registration_pending) {
    return "registration pending";
  }
  if (!user.active) {
    return "inactive";
  }
  if (user.invite_pending) {
    return "invited";
  }
  return "active";
}

export function UserManager({ adminSection, onAdminSectionChange, onAttentionChanged }: { adminSection: "users" | "templates" | "settings"; onAdminSectionChange: (section: "users" | "templates" | "settings") => void; onAttentionChanged?: () => void | Promise<void> }) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [mode, setMode] = useState<"edit" | "create">("edit");
  const [form, setForm] = useState<UserFormState>({
    name: "",
    email: "",
    username: "",
    start_page: "",
    calendar_color: "teacher-a",
    calendar_avatar: "",
    worship_max_sundays_per_month: "",
    sunday_school_max_sundays_per_month: "",
    email_confirmed: false,
    active: true,
    role_names: ["viewer"],
  });
  const [message, setMessage] = useState<string | null>(null);
  const [actionLink, setActionLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(true);
  const [driveStatus, setDriveStatus] = useState<GoogleDriveStatus | null>(null);
  const [selfRegistrationEnabled, setSelfRegistrationEnabled] = useState(false);
  const registrationUrl = `${window.location.origin}${window.location.pathname}?signup=1`;
  const [volunteerRows, setVolunteerRows] = useState<VolunteerAdminRecord[]>([]);
  const [servingAreas, setServingAreas] = useState<ServingArea[]>([]);
  const [mobileUserPane, setMobileUserPane] = useState<"list" | "detail">("list");
  const [userSettingsSection, setUserSettingsSection] = useState<"profile" | "serving">("profile");
  const [userFilter, setUserFilter] = useState<"all" | "attention" | "active" | "inactive">("all");
  const [userSort, setUserSort] = useState<"attention" | "name" | "recent">("attention");
  const [openRoleGroup, setOpenRoleGroup] = useState<string | null>(null);
  const initialAttentionRouted = useRef(false);
  const formDirty = mode === "create" || Boolean(selectedUser && JSON.stringify(form) !== JSON.stringify(formFromUser(selectedUser)));
  const roleGroups: Array<{ label: string; roles: string[] }> = [
    ...Array.from(new Set(servingAreas.map((area) => area.category))).sort().map((label) => ({ label, roles: [] })),
    { label: "General", roles: ["viewer"] },
    { label: "Administration", roles: ["administrator"] },
  ];

  const pendingUserIds = new Set([...users.filter((user) => user.registration_pending).map((user) => user.id), ...volunteerRows.filter((row) => row.preference.admin_attention_pending).map((row) => row.user_id)]);
  const filteredUsers = users
    .filter((user) => showInactive || user.active)
    .filter((user) => userFilter === "all" || (userFilter === "attention" ? pendingUserIds.has(user.id) : userFilter === "active" ? user.active : !user.active))
    .sort((left, right) => userSort === "attention" ? Number(pendingUserIds.has(right.id)) - Number(pendingUserIds.has(left.id)) || left.name.localeCompare(right.name) : userSort === "recent" ? left.username.localeCompare(right.username) : left.name.localeCompare(right.name));

  async function load(selectedId?: string, silent = false) {
    if (!silent) {
      setLoading(true);
      setMessage(null);
    }

    try {
      const [nextRoles, nextUsers, nextDriveStatus, nextVolunteerRows, nextServingAreas, siteContent] = await Promise.all([
        getRoles(),
        getUsers(),
        getGoogleDriveStatus(),
        getVolunteerAdminRecords(),
        getServingAreas(),
        getAdminSiteContent(),
      ]);
      setRoles(nextRoles);
      setUsers(nextUsers);
      setDriveStatus(nextDriveStatus);
      setVolunteerRows(nextVolunteerRows);
      setServingAreas(nextServingAreas);
      setSelfRegistrationEnabled(siteContent.find((block) => block.key === "identity.self_registration")?.value === "enabled");
      await onAttentionChanged?.();

      const attentionRow = !selectedId && !initialAttentionRouted.current
        ? nextVolunteerRows.find((row) => row.preference.admin_attention_pending)
        : undefined;
      const registrationUser = !selectedId && !initialAttentionRouted.current ? nextUsers.find((user) => user.registration_pending) : undefined;
      const attentionUserId = registrationUser?.id ?? attentionRow?.user_id;
      const target = nextUsers.find((user) => user.id === (selectedId ?? attentionUserId)) ?? nextUsers[0] ?? null;
      if (!initialAttentionRouted.current) {
        initialAttentionRouted.current = true;
        if (attentionUserId) {
          setMobileUserPane("detail");
          setUserSettingsSection(registrationUser ? "profile" : "serving");
          setOpenRoleGroup(attentionRow?.preference.area.category ?? null);
        }
      }
      if (target) {
        setSelectedUser(target);
        setForm(formFromUser(target));
        setMode("edit");
      } else {
        startCreate();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load users.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function refreshVolunteerRows() {
    const nextVolunteerRows = await getVolunteerAdminRecords();
    setVolunteerRows(nextVolunteerRows);
    await onAttentionChanged?.();
  }

  function startCreate() {
    setSelectedUser(null);
    setMode("create");
    setActionLink(null);
    setMobileUserPane("detail");
    setUserSettingsSection("profile");
    setForm({
      name: "",
      email: "",
      username: "",
      start_page: "",
      calendar_color: "teacher-a",
      calendar_avatar: "",
      worship_max_sundays_per_month: "",
      sunday_school_max_sundays_per_month: "",
      email_confirmed: false,
      active: true,
      role_names: ["viewer"],
    });
  }

  async function selectUser(user: User) {
    if (formDirty && mode === "edit" && !(await confirm({ title: "Discard unsaved changes?", message: "This user's unsaved account and access changes will be lost.", confirmLabel: "Discard changes", tone: "danger" }))) return;
    setSelectedUser(user);
    setForm(formFromUser(user));
    setMode("edit");
    setActionLink(null);
    setMessage(null);
    setMobileUserPane("detail");
    const attentionRow = volunteerRows.find((row) => row.user_id === user.id && row.preference.admin_attention_pending);
    if (user.registration_pending) {
      setUserSettingsSection("profile");
    } else if (attentionRow) {
      setUserSettingsSection("serving");
      setOpenRoleGroup(attentionRow.preference.area.category);
    }
    if (pendingUserIds.has(user.id)) {
      await acknowledgeVolunteerAttention(user.id);
      await refreshVolunteerRows();
    }
  }

  async function decideRegistration(approve: boolean) {
    if (!selectedUser?.registration_pending) return;
    if (!approve && !(await confirm({ title: "Reject registration", message: `Permanently remove ${selectedUser.name}'s registration request?`, confirmLabel: "Reject and remove", tone: "danger" }))) return;
    try {
      if (approve) await approveSelfRegistration(selectedUser.id); else await rejectSelfRegistration(selectedUser.id);
      await load();
      setMessage(approve ? "Registration approved." : "Registration rejected and removed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not review registration."); }
  }

  async function toggleSelfRegistration() {
    const enabled = !selfRegistrationEnabled;
    try {
      await updateSiteContentBlock("identity.self_registration", { label: "Public self-registration", block_type: "setting", value: enabled ? "enabled" : "disabled", published: true });
      setSelfRegistrationEnabled(enabled);
      setMessage(enabled ? "Public registration enabled." : "Public registration disabled.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not change registration setting."); }
  }

  async function copyRegistrationLink() {
    await navigator.clipboard.writeText(registrationUrl);
    setMessage("Registration link copied.");
  }

  async function persistServingAccess(changes: Partial<Pick<UserFormState, "role_names" | "worship_max_sundays_per_month" | "sunday_school_max_sundays_per_month">>) {
    if (!selectedUser) return;
    const saved = await updateUser(selectedUser.id, payloadFromForm({ ...formFromUser(selectedUser), ...changes }));
    setSelectedUser(saved);
    setForm((current) => ({ ...current, role_names: saved.roles, worship_max_sundays_per_month: saved.worship_max_sundays_per_month?.toString() ?? "", sunday_school_max_sundays_per_month: saved.sunday_school_max_sundays_per_month?.toString() ?? "" }));
    setMessage("Serving access updated.");
  }

  async function toggleRole(roleName: string) {
    const hasRole = form.role_names.includes(roleName);
    if (roleName === "viewer" && form.role_names.some((name) => name !== "viewer")) {
      return;
    }
    const nextRoles = hasRole
      ? form.role_names.filter((name) => name !== roleName)
      : [...form.role_names, roleName];
    if (hasRole && !(await confirm({ title: "Remove role", message: `Remove ${formatRoleName(roleName)} from this user?`, confirmLabel: "Remove role", tone: "danger" }))) return;
    const role_names = nextRoles.some((name) => name !== "viewer") ? Array.from(new Set(["viewer", ...nextRoles])) : nextRoles.length ? nextRoles : ["viewer"];
    try { await persistServingAccess({ role_names }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update serving access."); }
  }

  async function copyLink() {
    if (!actionLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(actionLink);
      setMessage("Link copied.");
    } catch {
      setMessage("Could not copy the link automatically. You can still select and copy it.");
    }
  }

  function updateActionLink(result: UserInviteResponse | PasswordResetAdminResponse) {
    const url = "invitation_url" in result ? result.invitation_url : result.reset_url;
    setActionLink(url);
    setMessage(result.email_sent ? "Email sent." : "Email is not configured, so we generated a copyable link instead.");
  }

  async function submitUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setActionLink(null);

    try {
      const payload = payloadFromForm(form);
      if (mode === "create") {
        const result = await inviteUser(payload);
        await load(result.user.id);
        updateActionLink(result);
        return;
      }

      const saved = await updateUser(selectedUser!.id, payload);
      await load(saved.id);
      setMessage("User updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save user.");
    }
  }

  async function issueInvite() {
    if (!selectedUser) {
      return;
    }

    setMessage(null);
    setActionLink(null);

    try {
      const result = await resendInvite(selectedUser.id);
      await load(result.user.id);
      updateActionLink(result);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Could not resend invite.";
      setMessage(
        messageText.includes("PUBLIC_APP_URL")
          ? "Set PUBLIC_APP_URL in the backend env to your public app address, then rebuild before sending invite or reset links."
          : messageText,
      );
    }
  }

  async function issuePasswordReset() {
    if (!selectedUser) {
      return;
    }

    setMessage(null);
    setActionLink(null);

    try {
      const result = await sendPasswordReset(selectedUser.id);
      await load(selectedUser.id);
      updateActionLink(result);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Could not create a reset link.";
      setMessage(
        messageText.includes("PUBLIC_APP_URL")
          ? "Set PUBLIC_APP_URL in the backend env to your public app address, then rebuild before sending invite or reset links."
          : messageText,
      );
    }
  }

  async function removeUser() {
    if (!selectedUser) {
      return;
    }

    const confirmed = await confirm({
      confirmLabel: "Deactivate",
      message: `Deactivate user "${selectedUser.name}"?`,
      title: "Deactivate User",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setMessage(null);
    setActionLink(null);

    try {
      await deactivateUser(selectedUser.id);
      await load(selectedUser.id);
      setMessage("User deactivated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not deactivate user.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useDurableChange(() => {
    if (!formDirty) void load(selectedUser?.id, true);
  }, true, ["identity"]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("googleDrive");
    if (!result) {
      return;
    }

    onAdminSectionChange("settings");

    if (result === "connected") {
      setMessage("Google Drive connected.");
    } else if (result.startsWith("error:")) {
      setMessage(`Google Drive connection failed: ${decodeURIComponent(result.slice(6))}`);
    }

    params.delete("googleDrive");
    const nextQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
    void load(selectedUser?.id);
  }, [selectedUser?.id]);

  async function disconnectDrive() {
    const confirmed = await confirm({
      confirmLabel: "Disconnect",
      message: "Disconnect the shared Google Drive account?",
      title: "Disconnect Google Drive",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    setMessage(null);
    try {
      await disconnectGoogleDrive();
      await load(selectedUser?.id);
      setMessage("Google Drive disconnected.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect Google Drive.");
    }
  }

  function connectDrive() {
    window.location.href = buildAbsoluteApiUrl("/api/v1/integrations/google-drive/connect");
  }

  if (adminSection === "templates") {
    return <section className="admin-template-workspace"><PlanTypeManager onMessage={setMessage} />{message ? <p className="form-message">{message}</p> : null}</section>;
  }

  return (
    <section className={`manager-grid admin-manager ${adminSection === "settings" ? "is-settings" : "is-users"}`} aria-label="User management">
      {confirmationDialog}
      {adminSection === "users" ? <div className="admin-mobile-user-tabs tab-row flat-admin-tabs" aria-label="User panels"><button className={mobileUserPane === "list" ? "active" : ""} onClick={() => setMobileUserPane("list")} type="button">Users <span>{filteredUsers.length}</span></button><button className={mobileUserPane === "detail" ? "active" : ""} onClick={() => setMobileUserPane("detail")} type="button">User settings {selectedUser && pendingUserIds.has(selectedUser.id) ? <span>!</span> : null}</button></div> : null}
      <aside className={`manager-list ${mobileUserPane === "list" ? "is-mobile-active" : ""}`}>
        <div className="section-heading">
          <h2>Users</h2>
          <div className="action-row">
            <button className="text-button" onClick={startCreate} type="button">
              New User
            </button>
          </div>
        </div>

        <div className="admin-user-filters">
          <select aria-label="Filter users" value={userFilter} onChange={(event) => { const next = event.target.value as typeof userFilter; setUserFilter(next); setShowInactive(next === "inactive" || next === "all"); }}><option value="all">All users</option><option value="attention">Needs attention</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
          <select aria-label="Sort users" value={userSort} onChange={(event) => setUserSort(event.target.value as typeof userSort)}><option value="attention">Attention first</option><option value="name">Name</option><option value="recent">Username</option></select>
        </div>

        <div className="stack-list">
          {filteredUsers.map((user) => (
            <button
              className={`stack-row ${user.id === selectedUser?.id ? "selected" : ""}`}
              key={user.id}
              onClick={() => void selectUser(user)}
              type="button"
            >
              <strong>{user.name}{pendingUserIds.has(user.id) ? <span className="user-attention-flag" aria-label="Volunteer request pending">!</span> : null}</strong>
              <span>
                @{user.username} · {user.email} · {formatUserStatus(user)}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <form className={`editor-panel ${mobileUserPane === "detail" ? "is-mobile-active" : ""} is-${userSettingsSection}-settings`} onSubmit={(event) => void submitUser(event)}>
        {adminSection === "users" ? <div className="tab-row flat-admin-tabs user-settings-tabs" role="tablist" aria-label="User setting sections"><button className={userSettingsSection === "profile" ? "active" : ""} onClick={() => setUserSettingsSection("profile")} type="button">Account & identity</button><button className={userSettingsSection === "serving" ? "active" : ""} onClick={() => setUserSettingsSection("serving")} type="button">Roles & serving</button></div> : null}
        <div className="section-heading">
          <div>
            <p className="eyebrow">{mode === "create" ? "Invite" : "Edit"}</p>
            <h2>{mode === "create" ? "New User" : selectedUser?.name ?? "User"}</h2>
          </div>
          <div className="action-row">
            {mode === "edit" && formDirty ? <><span className="status-pill attention">Unsaved changes</span><button className="text-button" onClick={() => selectedUser && setForm(formFromUser(selectedUser))} type="button">Discard</button></> : null}
            {mode === "edit" && selectedUser?.registration_pending ? <><span className="status-pill attention">Registration pending</span><button className="primary-button" onClick={() => void decideRegistration(true)} type="button">Approve</button><button className="danger-button" onClick={() => void decideRegistration(false)} type="button">Reject</button></> : null}
            {mode === "edit" && selectedUser?.active ? (
              <>
                {selectedUser.invite_pending ? (
                  <button className="text-button" onClick={() => void issueInvite()} type="button">
                    Resend Invite
                  </button>
                ) : (
                  <button className="text-button" onClick={() => void issuePasswordReset()} type="button">
                    Send Reset Link
                  </button>
                )}
                <button className="danger-button" onClick={() => void removeUser()} type="button">
                  Deactivate
                </button>
              </>
            ) : null}
            <button className="primary-button" disabled={loading || (mode === "edit" && !formDirty)} type="submit">
              {mode === "create" ? "Invite User" : "Save User"}
            </button>
          </div>
        </div>

        {message ? <p className="form-message">{message}</p> : null}
        {actionLink ? (
          <div className="field-action-row">
            <label className="wide-field">
              Invite or reset link
              <input readOnly value={actionLink} />
            </label>
            <button className="text-button" onClick={() => void copyLink()} type="button">
              Copy Link
            </button>
          </div>
        ) : null}

        <div className="form-grid">
          <label>
            Full name
            <input
              autoComplete="name"
              onChange={(event) => {
                const name = event.target.value;
                const username = mode === "create" && form.username === suggestedUsername(form.name, users)
                  ? suggestedUsername(name, users)
                  : form.username;
                setForm({ ...form, name, username });
              }}
              placeholder="First name and surname"
              required
              value={form.name}
            />
          </label>

          <label>
            Email
            <input
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
              type="email"
              value={form.email}
            />
          </label>

          <label>
            Username
            <input
              autoCapitalize="none"
              onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })}
              pattern="[a-z0-9][a-z0-9._-]{1,79}"
              required
              value={form.username}
            />
          </label>

          <fieldset className="wide-field role-fieldset compact-role-fieldset capability-fieldset">
            <legend>Capabilities, roles and volunteer requests</legend>
            <p className="muted-copy">Serving roles are grouped by ministry. Approved requests automatically provide the matching workspace access; administration remains explicit.</p>
            <div className="role-group-grid">
              {roleGroups.map((group) => { const groupRequests = volunteerRows.filter((row) => row.user_id === selectedUser?.id && row.preference.area.category === group.label); const groupAreas = servingAreas.filter((area) => area.category === group.label); if (!group.roles.length && !groupRequests.length && !groupAreas.length) return null; const groupOpen = openRoleGroup === group.label; const activeCount = group.roles.filter((roleName) => form.role_names.includes(roleName)).length + groupRequests.filter((row) => row.preference.status === "approved" || row.preference.status === "pending").length; return <section className={`role-group role-category ${groupOpen ? "is-open" : ""}`} key={group.label}><button className="role-category-heading" onClick={() => setOpenRoleGroup(groupOpen ? null : group.label)} type="button"><span>{group.label}</span><small>{activeCount} active</small><span aria-hidden="true">{groupOpen ? "−" : "+"}</span></button>{groupOpen ? <div className="role-category-items">{group.roles.length ? <div className="admin-role-list">{group.roles.map((roleName) => { const role = roles.find((candidate) => candidate.name === roleName); const selected = Boolean(role && form.role_names.includes(role.name)); const limit = roleName === "worship_leader" ? form.worship_max_sundays_per_month : roleName === "sunday_school_teacher" ? form.sunday_school_max_sundays_per_month : null; return role ? <div className={`admin-role-row ${selected ? "selected" : ""}`} key={role.id}><label className="admin-role-toggle"><input checked={selected} disabled={role.name === "viewer" && form.role_names.some((name) => name !== "viewer")} onChange={() => void toggleRole(role.name)} type="checkbox" /><span><strong>{formatRoleName(role.name)}</strong><small>{role.description ?? "Workspace access"}</small></span></label>{selected && limit !== null ? <label className="inline-role-limit"><span>Sundays</span><select onChange={(event) => { const value = event.target.value; void persistServingAccess(roleName === "worship_leader" ? { worship_max_sundays_per_month: value } : { sunday_school_max_sundays_per_month: value }).catch((error) => setMessage(error instanceof Error ? error.message : "Could not update rotation limit.")); }} value={limit}><option value="">Unlimited</option><option value="0">Never</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}/month</option>)}</select></label> : null}</div> : null; })}</div> : null}{mode === "edit" && selectedUser && (groupRequests.length || groupAreas.length) ? <VolunteerReview areas={groupAreas} compact directRoleNames={selectedUser.roles} onChanged={refreshVolunteerRows} rows={groupRequests} userId={selectedUser.id} /> : null}</div> : null}</section>; })}
            </div>
          </fieldset>

          {mode === "edit" && selectedUser ? <AdminAvailabilityPanel onMessage={setMessage} roleOptions={servingAreas.filter((area) => volunteerRows.some((row) => row.user_id === selectedUser.id && row.preference.area.key === area.key && row.preference.status === "approved") || Boolean(area.legacy_role_name && selectedUser.roles.includes(area.legacy_role_name))).map((area) => ({ key: area.key, name: area.name }))} userId={selectedUser.id} /> : null}

        </div>

        <section className="subsection-panel admin-settings-panel self-registration-settings">
          <div className="section-heading"><div><p className="eyebrow">Access</p><h3>Self-registration</h3></div><button className={selfRegistrationEnabled ? "danger-button" : "primary-button"} onClick={() => void toggleSelfRegistration()} type="button">{selfRegistrationEnabled ? "Disable" : "Enable"}</button></div>
          <p className="muted-copy">Anyone with this link can request an account. Requests remain inactive until an administrator approves them.</p>
          <div className="registration-share-panel"><img alt="QR code for account registration" src={buildAbsoluteApiUrl("/api/v1/identity/auth/registration-qr")} /><div className="stack"><input aria-label="Registration link" readOnly value={registrationUrl} /><div className="action-row"><button className="text-button" onClick={() => void copyRegistrationLink()} type="button">Copy link</button><a className="text-button" download="cspot-registration-qr.svg" href={buildAbsoluteApiUrl("/api/v1/identity/auth/registration-qr")}>Download QR</a></div><small>{selfRegistrationEnabled ? "Open for registration" : "Link disabled until registration is enabled"}</small></div></div>
        </section>

        <ServingRoleManager onChanged={(areas) => { setServingAreas(areas); void refreshVolunteerRows(); }} />

        <AudioSceneManager onMessage={setMessage} />

        <section className="subsection-panel admin-settings-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Integrations</p>
              <h3>Google Drive and YouTube</h3>
            </div>
            <div className="action-row">
              {driveStatus?.connected ? (
                <button className="danger-button" onClick={() => void disconnectDrive()} type="button">
                  Disconnect
                </button>
              ) : null}
              <button
                className="text-button"
                disabled={!driveStatus?.configured}
                onClick={connectDrive}
                type="button"
              >
                {driveStatus?.connected ? "Reconnect" : "Connect Google"}
              </button>
            </div>
          </div>
          <p className="muted-copy">
            {driveStatus?.configured
              ? driveStatus.connected
                ? driveStatus.scope?.includes("youtube.readonly")
                  ? `Connected as ${driveStatus.account_name || driveStatus.account_email || "Google account"}. Drive imports and YouTube search are ready.`
                  : `Connected as ${driveStatus.account_name || driveStatus.account_email || "Google account"}. Reconnect to grant YouTube search access.`
                : "Connect the shared church Google account so Drive media can be imported and YouTube can be searched in the service flow."
              : "Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and PUBLIC_APP_URL in the backend env, then rebuild before connecting Google Drive."}
          </p>
        </section>
      </form>
    </section>
  );
}
