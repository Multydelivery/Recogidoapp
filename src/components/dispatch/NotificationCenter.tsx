"use client";

import { useEffect } from "react";
import type { DispatchNotification } from "@/lib/dispatch/dispatch-notifications";
import styles from "./DispatchTerminal.module.css";

const toneSymbol: Record<DispatchNotification["tone"], string> = {
  success: "✓",
  warning: "⏱",
  info: "i",
  danger: "!",
};

function Toast({ notification, onDismiss, durationMs }: {
  notification: DispatchNotification;
  onDismiss: (id: string) => void;
  durationMs: number;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notification.id), durationMs);
    return () => clearTimeout(timer);
  }, [notification.id, onDismiss, durationMs]);

  return (
    <li className={styles.toast} data-tone={notification.tone}>
      <span className={styles.toastIcon} aria-hidden="true">{toneSymbol[notification.tone]}</span>
      <div>
        <strong>{notification.title}</strong>
        {notification.detail && <p>{notification.detail}</p>}
      </div>
      <button type="button" className={styles.toastClose} onClick={() => onDismiss(notification.id)} aria-label="Cerrar aviso">×</button>
    </li>
  );
}

export function NotificationCenter({ notifications, onDismiss, durationMs = 8000 }: {
  notifications: readonly DispatchNotification[];
  onDismiss: (id: string) => void;
  durationMs?: number;
}) {
  return (
    <div className={styles.notificationCenter} aria-live="polite" aria-relevant="additions" aria-label="Avisos">
      <ul>
        {notifications.map((notification) => (
          <Toast key={notification.id} notification={notification} onDismiss={onDismiss} durationMs={durationMs} />
        ))}
      </ul>
    </div>
  );
}
