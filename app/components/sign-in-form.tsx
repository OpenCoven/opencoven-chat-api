"use client";

import { useState } from "react";

export default function SignInForm({ configured }: { configured: boolean }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json();
      setPassword("");
      if (!response.ok) { setError(body.error || "Unable to sign in"); return; }
      window.location.replace("/");
    } catch { setError("Unable to sign in. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <form className="chat-form sign-in-form" onSubmit={signIn}>
      <p className="access-description">Salem is available to approved users. Sign in to ask questions and view your recent chats.</p>
      {!configured && <p className="form-error" role="alert">Access is not configured. Contact the administrator.</p>}
      <label className="password-field">
        <span>Username</span>
        <input className="chat-input" autoComplete="username" name="username" required maxLength={64} value={username} onChange={(event) => setUsername(event.target.value)} disabled={!configured || busy} />
      </label>
      <label className="password-field">
        <span>Password</span>
        <input className="chat-input" type="password" autoComplete="current-password" name="password" required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} disabled={!configured || busy} />
      </label>
      <button className="chat-btn" type="submit" disabled={!configured || busy}>{busy ? "Signing in…" : "Sign in"}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
