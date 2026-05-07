import { type FormEvent, useEffect, useState } from "react";

import {
  deactivateUser,
  getRoles,
  getUsers,
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

  const filteredUsers = showInactive ? users : users.filter((user) => user.active);

  async function load(selectedId?: string) {
    setLoading(true);
    setMessage(null);

    try {
      const [nextRoles, nextUsers] = await Promise.all([getRoles(), getUsers()]);
      setRoles(nextRoles);
      setUsers(nextUsers);

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

          <label>
            Start Page
            <input
              onChange={(event) => setForm({ ...form, start_page: event.target.value })}
              placeholder="/cspot/plans/next"
              value={form.start_page}
            />
          </label>

          <div className="toggle-row">
            <label>
              <input
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
                type="checkbox"
              />
              Active
            </label>
            <label>
              <input
                checked={form.email_confirmed}
                onChange={(event) => setForm({ ...form, email_confirmed: event.target.checked })}
                type="checkbox"
              />
              Email confirmed
            </label>
          </div>

          <fieldset className="wide-field role-fieldset">
            <legend>Roles</legend>
            <div className="role-grid">
              {roles.map((role) => (
                <label key={role.id}>
                  <input
                    checked={form.role_names.includes(role.name)}
                    onChange={() => toggleRole(role.name)}
                    type="checkbox"
                  />
                  <span>{formatRoleName(role.name)}</span>
                  {role.description ? <small>{role.description}</small> : null}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </form>
    </section>
  );
}
