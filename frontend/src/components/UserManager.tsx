import { type FormEvent, useEffect, useState } from "react";

import {
  createUser,
  deactivateUser,
  getRoles,
  getUsers,
  updateUser,
  type Role,
  type User,
  type UserPayload,
} from "../api";

interface UserFormState {
  name: string;
  email: string;
  start_page: string;
  email_confirmed: boolean;
  active: boolean;
  role_names: string[];
  password: string;
}

function formFromUser(user: User): UserFormState {
  return {
    name: user.name,
    email: user.email,
    start_page: user.start_page ?? "",
    email_confirmed: user.email_confirmed,
    active: user.active,
    role_names: user.roles,
    password: "",
  };
}

function payloadFromForm(form: UserFormState): UserPayload {
  return {
    name: form.name,
    email: form.email,
    start_page: form.start_page || null,
    email_confirmed: form.email_confirmed,
    active: form.active,
    role_names: form.role_names.length ? form.role_names : ["user"],
    password: form.password || null,
  };
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
    role_names: ["user"],
    password: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    setForm({
      name: "",
      email: "",
      start_page: "",
      email_confirmed: false,
      active: true,
      role_names: ["user"],
      password: "",
    });
  }

  function selectUser(user: User) {
    setSelectedUser(user);
    setForm(formFromUser(user));
    setMode("edit");
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

  async function submitUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    if (mode === "create" && form.password.trim().length < 8) {
      setMessage("New users need a password with at least 8 characters.");
      return;
    }

    try {
      const payload = payloadFromForm(form);
      const saved =
        mode === "create" ? await createUser(payload) : await updateUser(selectedUser!.id, payload);

      await load(saved.id);
      setMessage(mode === "create" ? "User created." : "User updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save user.");
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
          <button className="text-button" onClick={startCreate} type="button">
            New User
          </button>
        </div>

        <div className="stack-list">
          {users.map((user) => (
            <button
              className={`stack-row ${user.id === selectedUser?.id ? "selected" : ""}`}
              key={user.id}
              onClick={() => selectUser(user)}
              type="button"
            >
              <strong>{user.name}</strong>
              <span>
                {user.email} · {user.active ? "active" : "inactive"}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <form className="editor-panel" onSubmit={(event) => void submitUser(event)}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">{mode === "create" ? "Create" : "Edit"}</p>
            <h2>{mode === "create" ? "New User" : selectedUser?.name ?? "User"}</h2>
          </div>
          <div className="action-row">
            {mode === "edit" && selectedUser?.active ? (
              <button className="danger-button" onClick={() => void removeUser()} type="button">
                Deactivate
              </button>
            ) : null}
            <button className="primary-button" disabled={loading} type="submit">
              Save User
            </button>
          </div>
        </div>

        {message ? <p className="form-message">{message}</p> : null}

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
            {mode === "create" ? "Password" : "Reset Password"}
            <input
              minLength={8}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder={mode === "create" ? "Temporary password" : "Leave blank to keep current"}
              required={mode === "create"}
              type="password"
              value={form.password}
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
                  {role.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </form>
    </section>
  );
}
