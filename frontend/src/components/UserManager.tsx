import { type FormEvent, useEffect, useState } from "react";

import {
  buildAbsoluteApiUrl,
  deactivateUser,
  disconnectGoogleDrive,
  getGoogleDriveStatus,
  getRoles,
  getUsers,
  type GoogleDriveStatus,
  inviteUser,
  resendInvite,
  sendPasswordReset,
  updateUser,
  type PasswordResetAdminResponse,
  type Role,
  type User,
  type UserInvitePayload,
  type UserInviteResponse,
} from "../api";

interface UserFormState {
  name: string;
  email: string;
  start_page: string;
  email_confirmed: boolean;
  active: boolean;
  role_names: string[];
}

function formFromUser(user: User): UserFormState {
  return {
    name: user.name,
    email: user.email,
    start_page: user.start_page ?? "",
    email_confirmed: user.email_confirmed,
    active: user.active,
    role_names: user.roles,
  };
}

function payloadFromForm(form: UserFormState): UserInvitePayload {
  return {
    name: form.name,
    email: form.email,
    start_page: form.start_page || null,
    email_confirmed: form.email_confirmed,
    active: form.active,
    role_names: form.role_names.length ? form.role_names : ["viewer"],
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

export function UserManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [mode, setMode] = useState<"edit" | "create">("edit");
  const [form, setForm] = useState<UserFormState>({
    name: "",
    email: "",
    start_page: "",
    email_confirmed: false,
    active: true,
    role_names: ["viewer"],
  });
  const [message, setMessage] = useState<string | null>(null);
  const [actionLink, setActionLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [driveStatus, setDriveStatus] = useState<GoogleDriveStatus | null>(null);

  const filteredUsers = showInactive ? users : users.filter((user) => user.active);

  async function load(selectedId?: string) {
    setLoading(true);
    setMessage(null);

    try {
      const [nextRoles, nextUsers, nextDriveStatus] = await Promise.all([
        getRoles(),
        getUsers(),
        getGoogleDriveStatus(),
      ]);
      setRoles(nextRoles);
      setUsers(nextUsers);
      setDriveStatus(nextDriveStatus);

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

  function startCreate() {
    setSelectedUser(null);
    setMode("create");
    setActionLink(null);
    setForm({
      name: "",
      email: "",
      start_page: "",
      email_confirmed: false,
      active: true,
      role_names: ["viewer"],
    });
  }

  function selectUser(user: User) {
    setSelectedUser(user);
    setForm(formFromUser(user));
    setMode("edit");
    setActionLink(null);
    setMessage(null);
  }

  function toggleRole(roleName: string) {
    const hasRole = form.role_names.includes(roleName);
    setForm({
      ...form,
      role_names: hasRole
        ? form.role_names.filter((name) => name !== roleName)
        : [...form.role_names, roleName],
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

    const confirmed = window.confirm(`Deactivate user "${selectedUser.name}"?`);
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
    const confirmed = window.confirm("Disconnect the shared Google Drive account?");
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
    <section className="manager-grid" aria-label="User management">
      <aside className="manager-list">
        <div className="section-heading">
          <h2>Users</h2>
          <div className="action-row">
            <label className="inline-toggle">
              <input
                checked={showInactive}
                onChange={(event) => setShowInactive(event.target.checked)}
                type="checkbox"
              />
              <span>Show inactive</span>
            </label>
            <button className="text-button" onClick={startCreate} type="button">
              New User
            </button>
          </div>
        </div>

        <div className="stack-list">
          {filteredUsers.map((user) => (
            <button
              className={`stack-row ${user.id === selectedUser?.id ? "selected" : ""}`}
              key={user.id}
              onClick={() => selectUser(user)}
              type="button"
            >
              <strong>{user.name}</strong>
              <span>
                {user.email} · {formatUserStatus(user)}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <form className="editor-panel" onSubmit={(event) => void submitUser(event)}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">{mode === "create" ? "Invite" : "Edit"}</p>
            <h2>{mode === "create" ? "New User" : selectedUser?.name ?? "User"}</h2>
          </div>
          <div className="action-row">
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
            <button className="primary-button" disabled={loading} type="submit">
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

          <fieldset className="wide-field role-fieldset compact-role-fieldset">
            <legend>Roles</legend>
            <div className="role-chip-grid">
              {roles.map((role) => (
                <label
                  className={`role-chip ${form.role_names.includes(role.name) ? "selected" : ""}`}
                  key={role.id}
                  title={role.description ?? formatRoleName(role.name)}
                >
                  <input
                    checked={form.role_names.includes(role.name)}
                    onChange={() => toggleRole(role.name)}
                    type="checkbox"
                  />
                  <span>{formatRoleName(role.name)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <section className="subsection-panel">
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
