"use client";

import { Check, Copy, Download, KeyRound } from "lucide-react";
import { useId, useState } from "react";

import { useDialogBehavior } from "@/lib/use-motion";

/**
 * Shows a recovery code exactly once, after sign-up, after a password reset, and when the account
 * panel makes a new one. The user can copy it or download it as a text file, and must tick
 * "I have saved this code" before continuing: there is no other way to see it again.
 *
 * It is an `alertdialog`, so a dialog underneath (the account panel) ignores Escape while it is
 * open, and Escape here does nothing until the box is ticked.
 */
export function RecoveryCodeDialog({
  code,
  username,
  heading = "Save your recovery code",
  onDone,
}: {
  code: string;
  username: string;
  heading?: string;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const dialogRef = useDialogBehavior(() => {
    if (saved) onDone();
  });
  const id = useId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  function download() {
    const text = [
      "Doom Flix recovery code",
      "",
      `Username: ${username}`,
      `Recovery code: ${code}`,
      "",
      "Use it on the sign-in screen (Forgot password?) to set a new password.",
      "Each code works once; a new one is shown after you use it.",
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `doom-flix-recovery-code-${username}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="confirmation-shell">
      <div className="confirmation-backdrop" aria-hidden="true" />
      <section
        ref={dialogRef}
        className="confirmation-dialog recovery-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        tabIndex={-1}
      >
        <div className="confirmation-icon"><KeyRound size={22} /></div>
        <p className="eyebrow">RECOVERY CODE</p>
        <h2 id={`${id}-title`}>{heading}</h2>
        <p id={`${id}-description`}>If you forget your password, this code is the only way back into your account. It is shown only now.</p>
        <output className="recovery-code" aria-label={`Recovery code ${code.split("").join(" ")}`}>{code}</output>
        <div className="recovery-actions">
          <button type="button" className="secondary-action" onClick={copy}>
            {copied === "copied" ? <Check size={16} /> : <Copy size={16} />}
            {copied === "copied" ? "Copied" : "Copy"}
          </button>
          <button type="button" className="secondary-action" onClick={download}><Download size={16} /> Download</button>
        </div>
        {copied === "failed" && <div className="recovery-hint" role="status">Copying is blocked here. Select the code and copy it, or download it.</div>}
        <label className="recovery-confirm">
          <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
          <span>I have saved this code somewhere safe</span>
        </label>
        <div className="confirmation-actions">
          <button type="button" className="primary-action" disabled={!saved} onClick={onDone}>Continue</button>
        </div>
      </section>
    </div>
  );
}
