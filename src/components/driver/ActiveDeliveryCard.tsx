import type { DriverDelivery } from "@/lib/driver/driver-types";
import { assignmentModeLabel, driverStatusText, formatDriverTime, orderLabel } from "@/lib/driver/driver-demo";
import { DriverTimeline } from "./DriverTimeline";
import styles from "./DriverDemo.module.css";

export function ActiveDeliveryCard({ delivery, loading, disabled, onConfirmPickup, onRequestCompletion }: {
  delivery: Omit<DriverDelivery, "assignedAt"> & { assignedAt?: string };
  loading: boolean;
  disabled: boolean;
  onConfirmPickup: () => void;
  onRequestCompletion: () => void;
}) {
  const label = orderLabel(delivery.orderNumber);
  const status = driverStatusText[delivery.status];
  const headingId = `active-${delivery.offerId}-title`;
  return (
    <article className={`${styles.card} ${styles.activeCard}`} data-status={delivery.status}
      aria-labelledby={headingId} aria-busy={loading}>
      <div className={styles.cardTop}>
        <h3 id={headingId} className={styles.orderNumber}>{label}</h3>
        <span className={styles.statusChip} data-status={delivery.status}>
          <span aria-hidden="true">{delivery.status === "picked_up" ? "➜" : "✓"}</span> {status.label}
        </span>
      </div>
      <p className={styles.restaurant}>{delivery.restaurantName}</p>
      <p className={styles.statusDetail}>{status.detail}</p>
      <dl className={styles.facts}>
        <div><dt>Asignación</dt><dd>{delivery.assignmentLabel} · {assignmentModeLabel(delivery.assignmentMode)}</dd></div>
        <div><dt>Conductor</dt><dd>{delivery.driverName}</dd></div>
        <div><dt>Asignada</dt><dd>{delivery.assignedAt ? <time dateTime={delivery.assignedAt}>{formatDriverTime(delivery.assignedAt)}</time> : "—"}</dd></div>
        {delivery.pickedUpAt && (
          <div><dt>Recogida</dt><dd><time dateTime={delivery.pickedUpAt}>{formatDriverTime(delivery.pickedUpAt)}</time></dd></div>
        )}
      </dl>
      <DriverTimeline status={delivery.status} />
      <div className={styles.cardActions}>
        {(delivery.status === "accepted" || delivery.status === "assigned") && (
          <button type="button" className={styles.primaryButton} disabled={disabled} onClick={onConfirmPickup}>
            {loading && <span className={styles.spinner} aria-hidden="true" />}
            {loading ? "CONFIRMANDO…" : "CONFIRMAR RECOGIDA"}
          </button>
        )}
        {delivery.status === "picked_up" && (
          <button type="button" className={styles.primaryButton} disabled={disabled} onClick={onRequestCompletion}>
            {loading && <span className={styles.spinner} aria-hidden="true" />}
            {loading ? "COMPLETANDO…" : "COMPLETAR ENTREGA"}
          </button>
        )}
      </div>
    </article>
  );
}
