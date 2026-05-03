import { type FormEvent, useState } from "react";

import { bootstrapAdmin, login, type SessionUser } from "../api";

interface AuthScreenProps {
  bootstrapAvailable: boolean;
  onAuthenticated: (user: SessionUser) => void;
}

export function AuthScreen({ bootstrapAvailable, onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "bootstrap">(bootstrapAvailable ? "bootstrap" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const user =
        mode === "bootstrap"
          ? await bootstrapAdmin({ name, email, password })
          : await login({ email, password });
      onAuthenticated(user);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand auth-brand">
          <img alt="" src="/images/xs-cspot.png" />
          <span>cspot-pro</span>
        </div>

        <div className="auth-lockup">
          <p className="eyebrow">{mode === "bootstrap" ? "First-time setup" : "Welcome back"}</p>
          <h1>{mode === "bootstrap" ? "Create the first admin" : "Sign in"}</h1>
          <p>
            {mode === "bootstrap"
              ? "This only appears while no administrator password has been set."
              : "Use your church account to open plans, songs, and presenter controls."}
          </p>
        </div>

        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {mode === "bootstrap" ? (
            <label>
              Name
              <input onChange={(event) => setName(event.target.value)} required value={name} />
            </label>
          ) : null}

          <label>
            Email
            <input
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>

          <label>
            Password
            <input
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          {message ? <p className="form-message">{message}</p> : null}

          <button className="primary-button auth-submit" disabled={submitting} type="submit">
            {mode === "bootstrap" ? "Create Admin" : "Sign In"}
          </button>
        </form>

        {bootstrapAvailable ? (
          <div className="auth-switch">
            <button
              className="text-button"
              onClick={() => setMode((current) => (current === "bootstrap" ? "login" : "bootstrap"))}
              type="button"
            >
              {mode === "bootstrap" ? "Already have an account?" : "Need to create the first admin?"}
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
