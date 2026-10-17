import type { DriverNotification as DriverNotificationValue } from "@/lib/driver/driver-types";
import styles from "./DriverDemo.module.css";

const toneSymbol = { success: "✓", info: "i", error: "!" } as const;

/** Both live regions stay mounted so screen readers announce every new message. */
export function DriverNotification({ notification, onDismiss }: {
  notification: DriverNotificationValue | null;
  onDismiss: () => void;
}) {
  const isError = notification?.tone === "error";
  const content = notification && (
    <div className={styles.toast} data-tone={notification.tone} key={notification.id}>
      <span className={styles.toastIcon} aria-hidden="true">{toneSymbol[notification.tone]}</span>
      <p>{notification.message}</p>
      <button type="button" className={styles.toastClose} onClick={onDismiss} aria-label="Cerrar aviso">×</button>
    </div>
  );
  return (
    <div className={styles.toastRegion}>
      <div role="status" aria-live="polite" aria-atomic="true">{!isError && content}</div>
      <div role="alert" aria-live="assertive" aria-atomic="true">{isError && content}</div>
    </div>
  );
}
