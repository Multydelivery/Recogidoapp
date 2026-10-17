import type { DispatchRequest } from "@/lib/dispatch/dispatch-types";
import styles from "./DispatchTerminal.module.css";

export function DeliveryProgress({ request }: { request: DispatchRequest }) {
  const label = `${request.assignedDeliveries} de ${request.totalDeliveries} entregas asignadas`;
  return (
    <div className={styles.progressBlock}>
      <dl className={styles.progressCounts}>
        <div><dt>Solicitadas</dt><dd>{request.totalDeliveries}</dd></div>
        <div><dt>Asignadas</dt><dd>{request.assignedDeliveries}</dd></div>
        <div><dt>Pendientes</dt><dd>{request.remainingDeliveries}</dd></div>
      </dl>
      <progress className={styles.progressBar} max={Math.max(1, request.totalDeliveries)} value={request.assignedDeliveries} aria-label={label} />
      <p className={styles.progressText}>{label}</p>
    </div>
  );
}
