"use client";

import { Database, KeyRound, LogOut, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { type FormEvent, useId, useState } from "react";

import { useDialogBehavior } from "@/lib/use-motion";
import { RecoveryCodeDialog } from "@/components/nexus/recovery-code-dialog";

type ApiRequest = (path: string, init?: RequestInit) => Promise<Response>;
type Action = "password" | "recovery" | "signout" | "delete";
type Status = { action: Action; kind: "error" | "done"; message: string } | null;

/**
 * The account panel (package 1.5), opened from the operator name in the top bar. Every change
 * asks for the current password, typed once at the top of the panel.
 */
export function AccountPanel({
  username,
  databaseMode,
  hasRecoveryCode,
  request,
  onClose,
  onRecoveryCodeChanged,
  onSignedOut,
}: {
  username: string;
  databaseMode: string;
  hasRecoveryCode: boolean;
  request: ApiRequest;
  onClose: () => void;
  onRecoveryCodeChanged: () => void;
  /** After "Sign out everywhere" or "Delete account": this device is signed out too. */
  onSignedOut: (message: string) => void;
}) {
  const dialogRef = useDialogBehavior(onClose);
  const id = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmUsername, setConfirmUsername] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [newCode, setNewCode] = useState<string | null>(null);

  const synced = databaseMode === "SYNCED VAULT";

  async function send(action: Action, path: string, method: "POST" | "DELETE", body: Record<string, string>) {
    if (!currentPassword) {
      setStatus({ action, kind: "error", message: "Enter your current password first." });
      return null;
    }
    setBusy(action);
    setStatus(null);
    try {
      const response = await request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, ...body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus({ action, kind: "error", message: payload.error ?? "That did not work. Try again." });
        return null;
      }
      return payload as Record<string, unknown>;
    } catch {
      setStatus({ action, kind: "error", message: "The server could not be reached. Try again." });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await send("password", "/api/account/password", "POST", { newPassword })) {
      setNewPassword("");
      setCurrentPassword("");
      setStatus({ action: "password", kind: "done", message: "Password changed. Use the new one next time you sign in." });
    }
  }

  async function makeRecoveryCode() {
    const payload = await send("recovery", "/api/account/recovery-code", "POST", {});
    if (payload && typeof payload.recoveryCode === "string") {
      setCurrentPassword("");
      setNewCode(payload.recoveryCode);
      onRecoveryCodeChanged();
    }
  }

  async function signOutEverywhere() {
    if (await send("signout", "/api/account/sessions/revoke", "POST", {})) {
      onSignedOut("Signed out on every device.");
    }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await send("delete", "/api/account", "DELETE", { confirmUsername })) {
      onSignedOut("Your account and all its progress were deleted.");
    }
  }

  const statusFor = (action: Action) =>
    status?.action === action ? (
      <p className={status.kind === "error" ? "form-error" : "account-done"} role={status.kind === "error" ? "alert" : "status"}>
        {status.message}
      </p>
    ) : null;

  const typedNameMatches = confirmUsername.trim().toLocaleLowerCase() === username.toLocaleLowerCase();

  return (
    <div className="confirmation-shell">
      <button className="confirmation-backdrop" onClick={onClose} aria-label="Close account" />
      <section ref={dialogRef} className="confirmation-dialog account-panel" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
        <button className="account-close" onClick={onClose} aria-label="Close account"><X size={18} /></button>
        <div className="confirmation-icon"><UserRound size={22} /></div>
        <p className="eyebrow">OPERATOR FILE</p>
        <h2 id={`${id}-title`}>{username}</h2>

        <div className="account-storage">
          <Database size={15} />
          <span>
            <strong>{synced ? "Synced vault" : "Local vault"}</strong>
            {synced ? " · Progress is saved online and follows you to any device you sign in on." : " · Progress is saved in a database file on the computer running this app."}
          </span>
        </div>

        <label className="account-field">
          Current password
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Needed for every change below" maxLength={200} />
        </label>

        <form className="account-section" onSubmit={changePassword}>
          <h3><ShieldCheck size={16} /> Change password</h3>
          <label className="account-field">
            New password
            <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="8 to 72 characters" minLength={8} maxLength={72} required />
          </label>
          {statusFor("password")}
          <button type="submit" className="secondary-action" disabled={busy !== null}>{busy === "password" ? "Changing…" : "Change password"}</button>
        </form>

        <section className="account-section">
          <h3><KeyRound size={16} /> Recovery code</h3>
          <p>
            {hasRecoveryCode
              ? "You have a recovery code. Making a new one stops the old one working."
              : "You do not have a recovery code yet. Without one, a forgotten password cannot be reset."}
          </p>
          {statusFor("recovery")}
          <button type="button" className="secondary-action" disabled={busy !== null} onClick={makeRecoveryCode}>
            {busy === "recovery" ? "Creating…" : hasRecoveryCode ? "Make a new recovery code" : "Create a recovery code"}
          </button>
        </section>

        <section className="account-section">
          <h3><LogOut size={16} /> Sign out everywhere</h3>
          <p>Ends every session of this account, on every device, including this one.</p>
          {statusFor("signout")}
          <button type="button" className="secondary-action" disabled={busy !== null} onClick={signOutEverywhere}>
            {busy === "signout" ? "Signing out…" : "Sign out everywhere"}
          </button>
        </section>

        <form className="account-section danger" onSubmit={deleteAccount}>
          <h3><Trash2 size={16} /> Delete account</h3>
          <p>Deletes this account and all of its progress. This cannot be undone.</p>
          <label className="account-field">
            <span>Type <strong>{username}</strong> to confirm</span>
            <input value={confirmUsername} onChange={(event) => setConfirmUsername(event.target.value)} autoComplete="off" spellCheck={false} maxLength={100} />
          </label>
          {statusFor("delete")}
          <button type="submit" className="danger-action" disabled={busy !== null || !typedNameMatches}>
            {busy === "delete" ? "Deleting…" : "Delete account"}
          </button>
        </form>
      </section>
      {newCode && (
        <RecoveryCodeDialog code={newCode} username={username} heading="Your new recovery code" onDone={() => setNewCode(null)} />
      )}
    </div>
  );
}
