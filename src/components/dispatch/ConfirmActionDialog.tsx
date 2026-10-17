"use client";

import { useEffect, useRef } from "react";
import styles from "./DispatchTerminal.module.css";

export function ConfirmActionDialog({ open, title, description, confirmLabel, cancelLabel = "Volver", tone = "primary", busy = false, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof element.showModal === "function" && !element.open) element.showModal();
    cancelButton.current?.focus();
    return () => {
      if (element.open) element.close();
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="confirm-dialog-title" className={styles.dialogTitle}>{title}</h2>
      <p id="confirm-dialog-description" className={styles.dialogText}>{description}</p>
      <div className={styles.dialogActions}>
        <button ref={cancelButton} type="button" className={styles.secondaryButton} disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className={tone === "danger" ? styles.dangerButton : styles.primaryButtonInline} disabled={busy} onClick={onConfirm}>
          {busy && <span className={styles.spinner} aria-hidden="true" />}
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
