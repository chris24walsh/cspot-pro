import { type FormEvent, useEffect, useState } from "react";

import {
  buildAbsoluteApiUrl,
  acknowledgeVolunteerAttention,
  deactivateUser,
  disconnectGoogleDrive,
  getGoogleDriveStatus,
  getRoles,
  getServingAreas,
  getUsers,
  getVolunteerAdminRecords,
  type GoogleDriveStatus,
  inviteUser,
  resendInvite,
  sendPasswordReset,
  updateUser,
  type PasswordResetAdminResponse,
  type Role,
  type ServingArea,
  type User,
  type UserInvitePayload,
  type UserInviteResponse,
  type VolunteerAdminRecord,
} from "../api";
import { CALENDAR_AVATARS, CALENDAR_COLORS } from "../userCalendarStyle";
import { useConfirmationDialog } from "./ConfirmationDialog";
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

function formatRoleName(roleName: string) {
  return roleName
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatUserStatus(user: User) {
  if (!user.active) {
    return "inactive";
  }
  if (user.invite_pending) {
    return "invited";
  }
  return "active";
}

const ROLE_GROUPS = [
  { label: "Worship & Production", roles: ["musician", "worship_leader"] },
  { label: "Sunday School", roles: ["sunday_school_teacher", "sunday_school_leader"] },
  { label: "Service", roles: ["teacher", "presenter"] },
  { label: "Hospitality & Care", roles: [] },
  { label: "Property & Facilities", roles: [] },
  { label: "General", roles: ["viewer"] },
  { label: "Administration", roles: ["administrator"] },
] as const;

export function UserManager({ adminSection, onAdminSectionChange, onAttentionChanged }: { adminSection: "users" | "settings"; onAdminSectionChange: (section: "users" | "settings") => void; onAttentionChanged?: () => void | Promise<void> }) {
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
  const [volunteerRows, setVolunteerRows] = useState<VolunteerAdminRecord[]>([]);
  const [servingAreas, setServingAreas] = useState<ServingArea[]>([]);
  const [mobileUserPane, setMobileUserPane] = useState<"list" | "detail">("list");
  const [userFilter, setUserFilter] = useState<"all" | "attention" | "active" | "inactive">("all");
  const [userSort, setUserSort] = useState<"attention" | "name" | "recent">("attention");
  const formDirty = mode === "create" || Boolean(selectedUser && JSON.stringify(form) !== JSON.stringify(formFromUser(selectedUser)));

  const pendingUserIds = new Set(volunteerRows.filter((row) => row.preference.admin_attention_pending).map((row) => row.user_id));
  const filteredUsers = users
    .filter((user) => showInactive || user.active)
    .filter((user) => userFilter === "all" || (userFilter === "attention" ? pendingUserIds.has(user.id) : userFilter === "active" ? user.active : !user.active))
    .sort((left, right) => userSort === "attention" ? Number(pendingUserIds.has(right.id)) - Number(pendingUserIds.has(left.id)) || left.name.localeCompare(right.name) : userSort === "recent" ? left.username.localeCompare(right.username) : left.name.localeCompare(right.name));

  async function load(selectedId?: string) {
    setLoading(true);
    setMessage(null);

    try {
      const [nextRoles, nextUsers, nextDriveStatus, nextVolunteerRows, nextServingAreas] = await Promise.all([
        getRoles(),
        getUsers(),
        getGoogleDriveStatus(),
        getVolunteerAdminRecords(),
        getServingAreas(),
      ]);
      setRoles(nextRoles);
      setUsers(nextUsers);
      setDriveStatus(nextDriveStatus);
      setVolunteerRows(nextVolunteerRows);
      setServingAreas(nextServingAreas);
      await onAttentionChanged?.();

      const target = nextUsers.find((user) => user.id === selectedId) ?? nextUsers[0] ?? null;
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
      setLoading(false);
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
    if (pendingUserIds.has(user.id)) {
      await acknowledgeVolunteerAttention(user.id);
      await refreshVolunteerRows();
    }
  }

  function toggleRole(roleName: string) {
    const hasRole = form.role_names.includes(roleName);
    if (roleName === "viewer" && form.role_names.some((name) => name !== "viewer")) {
      return;
    }
    const nextRoles = hasRole
      ? form.role_names.filter((name) => name !== roleName)
      : [...form.role_names, roleName];
    setForm({
      ...form,
      role_names: nextRoles.some((name) => name !== "viewer")
        ? Array.from(new Set(["viewer", ...nextRoles]))
        : nextRoles.length ? nextRoles : ["viewer"],
    });
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

  return (
    <section className={`manager-grid admin-manager ${adminSection === "settings" ? "is-settings" : "is-users"}`} aria-label="User management">
      {confirmationDialog}
      {adminSection === "users" ? <div className="admin-mobile-user-tabs worship-mobile-pane-tabs" aria-label="User panels"><button className={mobileUserPane === "list" ? "active" : ""} onClick={() => setMobileUserPane("list")} type="button">Users <span>{filteredUsers.length}</span></button><button className={mobileUserPane === "detail" ? "active" : ""} onClick={() => setMobileUserPane("detail")} type="button">User settings {selectedUser && pendingUserIds.has(selectedUser.id) ? <span>!</span> : null}</button></div> : null}
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

      <form className={`editor-panel ${mobileUserPane === "detail" ? "is-mobile-active" : ""}`} onSubmit={(event) => void submitUser(event)}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">{mode === "create" ? "Invite" : "Edit"}</p>
            <h2>{mode === "create" ? "New User" : selectedUser?.name ?? "User"}</h2>
          </div>
          <div className="action-row">
            {mode === "edit" && formDirty ? <><span className="status-pill attention">Unsaved changes</span><button className="text-button" onClick={() => selectedUser && setForm(formFromUser(selectedUser))} type="button">Discard</button></> : null}
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
            Name
            <input
              onChange={(event) => setForm({ ...form, name: event.target.value })}
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
              {ROLE_GROUPS.map((group) => { const groupRequests = volunteerRows.filter((row) => row.user_id === selectedUser?.id && row.preference.area.category === group.label); const groupAreas = servingAreas.filter((area) => area.category === group.label); if (!group.roles.length && !groupRequests.length && !groupAreas.length) return null; return <section className="role-group" key={group.label}><h3>{group.label}</h3>{group.roles.length ? <div className="admin-role-list">{group.roles.map((roleName) => { const role = roles.find((candidate) => candidate.name === roleName); return role ? <label className={`admin-role-row ${form.role_names.includes(role.name) ? "selected" : ""}`} key={role.id}><input checked={form.role_names.includes(role.name)} disabled={role.name === "viewer" && form.role_names.some((name) => name !== "viewer")} onChange={() => toggleRole(role.name)} type="checkbox" /><span><strong>{formatRoleName(role.name)}</strong><small>{role.description ?? "Workspace access"}</small></span></label> : null; })}</div> : null}{mode === "edit" && selectedUser && (groupRequests.length || groupAreas.length) ? <VolunteerReview areas={groupAreas} compact directRoleNames={selectedUser.roles} onChanged={refreshVolunteerRows} rows={groupRequests} userId={selectedUser.id} /> : null}</section>; })}
            </div>
          </fieldset>

          <fieldset className="wide-field role-fieldset calendar-identity-fieldset">
            <legend>Calendar identity</legend>
            <p className="muted-copy">Choose a fixed colour and initial, or use an avatar instead.</p>
            <div className="calendar-identity-preview">
              <span className={form.calendar_avatar ? "calendar-admin-avatar" : `calendar-admin-avatar ${form.calendar_color}`}>
                {form.calendar_avatar || form.name.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span>{form.calendar_avatar ? "Avatar" : "Colour and initial"}</span>
            </div>
            <div className="calendar-color-options" aria-label="Calendar colour">
              {CALENDAR_COLORS.map((color) => (
                <label className={`${color} ${form.calendar_color === color ? "selected" : ""}`} key={color}>
                  <input
                    checked={form.calendar_color === color}
                    name="calendar-color"
                    onChange={() => setForm({ ...form, calendar_color: color, calendar_avatar: "" })}
                    type="radio"
                  />
                  <span aria-hidden="true" />
                </label>
              ))}
            </div>
            <div className="calendar-avatar-options" aria-label="Calendar avatar">
              <label className={!form.calendar_avatar ? "selected" : ""}>
                <input
                  checked={!form.calendar_avatar}
                  name="calendar-avatar"
                  onChange={() => setForm({ ...form, calendar_avatar: "" })}
                  type="radio"
                />
                <span>Initial</span>
              </label>
              {CALENDAR_AVATARS.map((avatar) => (
                <label className={form.calendar_avatar === avatar ? "selected" : ""} key={avatar}>
                  <input
                    checked={form.calendar_avatar === avatar}
                    name="calendar-avatar"
                    onChange={() => setForm({ ...form, calendar_avatar: avatar })}
                    type="radio"
                  />
                  <span aria-hidden="true">{avatar}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {form.role_names.includes("worship_leader") || form.role_names.includes("sunday_school_teacher") ? (
            <fieldset className="wide-field role-fieldset leader-capacity-fieldset">
              <legend>Sunday rotation limits</legend>
              <p className="muted-copy">Leave unlimited when this leader can take any remaining Sundays. Never in rotation keeps them available for direct manual assignment but removes them from automatic allocation and swaps.</p>
              <div className="leader-capacity-grid">
                {form.role_names.includes("worship_leader") ? (
                  <label>
                    Worship per month
                    <select
                      onChange={(event) => setForm({ ...form, worship_max_sundays_per_month: event.target.value })}
                      value={form.worship_max_sundays_per_month}
                    >
                      <option value="">Unlimited</option>
                      <option value="0">Never in rotation</option>
                      {[1, 2, 3, 4, 5].map((limit) => <option key={limit} value={limit}>{limit}</option>)}
                    </select>
                  </label>
                ) : null}
                {form.role_names.includes("sunday_school_teacher") ? (
                  <label>
                    Sunday School per month
                    <select
                      onChange={(event) => setForm({ ...form, sunday_school_max_sundays_per_month: event.target.value })}
                      value={form.sunday_school_max_sundays_per_month}
                    >
                      <option value="">Unlimited</option>
                      <option value="0">Never in rotation</option>
                      {[1, 2, 3, 4, 5].map((limit) => <option key={limit} value={limit}>{limit}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
            </fieldset>
          ) : null}
        </div>

        <section className="subsection-panel admin-settings-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Integrations</p>
              <h3>Google Drive</h3>
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
                {driveStatus?.connected ? "Reconnect" : "Connect Google Drive"}
              </button>
            </div>
          </div>
          <p className="muted-copy">
            {driveStatus?.configured
              ? driveStatus.connected
                ? `Connected as ${driveStatus.account_name || driveStatus.account_email || "Google Drive account"}.`
                : "Connect the shared church Google Drive account so decks can be imported straight into the service flow."
              : "Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and PUBLIC_APP_URL in the backend env, then rebuild before connecting Google Drive."}
          </p>
        </section>
      </form>
    </section>
  );
}
