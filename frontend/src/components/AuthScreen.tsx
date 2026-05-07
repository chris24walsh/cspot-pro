import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  bootstrapAdmin,
  completeAuthAction,
  getAuthActionToken,
  login,
  requestPasswordReset,
  type AuthActionToken,
  type SessionUser,
} from "../api";
import { appAssetUrl } from "../paths";

interface AuthScreenProps {
  bootstrapAvailable: boolean;
  onAuthenticated: (user: SessionUser) => void;
}

type AuthMode = "login" | "bootstrap" | "forgot" | "password_setup";

function tokenHeading(tokenMeta: AuthActionToken | null) {
  if (tokenMeta?.purpose === "invite") {
    return {
      eyebrow: "Welcome to cspot-pro",
      title: "Set your password",
      body: "Choose a strong password to finish creating your church account.",
      submit: "Create Password",
    };
  }

  return {
    eyebrow: "Password reset",
    title: "Choose a new password",
    body: "Set a new password for your church account and we'll sign you straight in.",
    submit: "Reset Password",
  };
}

export function AuthScreen({ bootstrapAvailable, onAuthenticated }: AuthScreenProps) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const actionToken = params.get("token");
  const [mode, setMode] = useState<AuthMode>(actionToken ? "password_setup" : bootstrapAvailable ? "bootstrap" : "login");
  const [tokenMeta, setTokenMeta] = useState<AuthActionToken | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (actionToken) {
      return;
    }
    setMode((current) => {
      if (current === "forgot") {
        return current;
      }
      return bootstrapAvailable ? "bootstrap" : "login";
    });
  }, [actionToken, bootstrapAvailable]);

  useEffect(() => {
    if (!actionToken) {
      return;
    }

    let cancelled = false;
    setSubmitting(true);
    setMessage(null);

    void getAuthActionToken(actionToken)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setTokenMeta(result);
        setEmail(result.email);
        setMode("password_setup");
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setMessage(error instanceof Error ? error.message : "That setup link is no longer available.");
      })
      .finally(() => {
        if (!cancelled) {
          setSubmitting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actionToken]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      if (mode === "password_setup") {
        if (!actionToken) {
          throw new Error("That setup link is incomplete.");
        }
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }
        const user = await completeAuthAction({ token: actionToken, password });
        onAuthenticated(user);
        return;
      }

      if (mode === "bootstrap") {
        const user = await bootstrapAdmin({ name, email, password });
        onAuthenticated(user);
        return;
      }

      if (mode === "forgot") {
        const result = await requestPasswordReset({ email });
        setMessage(result.detail);
        setMode("login");
        setPassword("");
        return;
      }

      const user = await login({ email, password });
      onAuthenticated(user);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not complete that request.");
    } finally {
      setSubmitting(false);
    }
  }

  const setupCopy = mode === "password_setup" ? tokenHeading(tokenMeta) : null;

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand auth-brand">
          <img alt="" src={appAssetUrl("images/xs-cspot.png")} />
          <span>cspot-pro</span>
        </div>

        <div className="auth-lockup">
          <p className="eyebrow">
            {mode === "password_setup"
              ? setupCopy?.eyebrow
              : mode === "bootstrap"
                ? "First-time setup"
                : mode === "forgot"
                  ? "Need a reset link?"
                  : "Welcome back"}
          </p>
          <h1>
            {mode === "password_setup"
              ? setupCopy?.title
              : mode === "bootstrap"
                ? "Create the first admin"
                : mode === "forgot"
                  ? "Reset your password"
                  : "Sign in"}
          </h1>
          <p>
            {mode === "password_setup"
              ? setupCopy?.body
              : mode === "bootstrap"
                ? "This only appears while no administrator password has been set."
                : mode === "forgot"
                  ? "Enter your email and we'll send you a secure reset link."
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
              disabled={mode === "password_setup"}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>

          {mode === "password_setup" ? (
            <>
              <label>
                Password
                <input
                  minLength={12}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
              <label>
                Confirm password
                <input
                  minLength={12}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  type="password"
                  value={confirmPassword}
                />
              </label>
            </>
          ) : mode === "forgot" ? null : (
            <label>
              Password
              <input
                minLength={mode === "bootstrap" ? 12 : undefined}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
          )}

          {message ? <p className="form-message">{message}</p> : null}

          <button className="primary-button auth-submit" disabled={submitting} type="submit">
            {mode === "password_setup"
              ? setupCopy?.submit
              : mode === "bootstrap"
                ? "Create Admin"
                : mode === "forgot"
                  ? "Send Reset Link"
                  : "Sign In"}
          </button>
        </form>

        {mode === "password_setup" ? null : (
          <div className="auth-switch">
            {bootstrapAvailable ? (
              <button
                className="text-button"
                onClick={() =>
                  setMode((current) => (current === "bootstrap" ? "login" : bootstrapAvailable ? "bootstrap" : "login"))
                }
                type="button"
              >
                {mode === "bootstrap" ? "Already have an account?" : "Need to create the first admin?"}
              </button>
            ) : null}
            <button
              className="text-button"
              onClick={() => setMode((current) => (current === "forgot" ? "login" : "forgot"))}
              type="button"
            >
              {mode === "forgot" ? "Back to sign in" : "Forgot your password?"}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
