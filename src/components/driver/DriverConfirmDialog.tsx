"use client";

import { useEffect, useRef } from "react";
import styles from "./DriverDemo.module.css";

export function DriverConfirmDialog({ open, title, description, confirmLabel, busy, onConfirm, onCancel, confirmDisabled = false }: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  busy: boolean;
  confirmDisabled?: boolean;
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
      aria-labelledby="driver-dialog-title"
      aria-describedby={description ? "driver-dialog-description" : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="driver-dialog-title" className={styles.dialogTitle}>{title}</h2>
      {description && <p id="driver-dialog-description" className={styles.dialogText}>{description}</p>}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.primaryButton} disabled={busy || confirmDisabled} onClick={onConfirm}>
          {busy && <span className={styles.spinner} aria-hidden="true" />}
          {busy ? "COMPLETANDO…" : confirmLabel}
        </button>
        <button ref={cancelButton} type="button" className={styles.secondaryButton} disabled={busy} onClick={onCancel}>
          Volver
        </button>
      </div>
    </dialog>
  );
}
