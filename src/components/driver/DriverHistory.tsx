import type { DriverHistoryItem } from "@/lib/driver/driver-types";
import { formatDriverTime, formatDuration, orderLabel } from "@/lib/driver/driver-demo";
import styles from "./DriverDemo.module.css";

export function DriverHistory({ items }: { items: DriverHistoryItem[] }) {
  if (items.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.emptyTitle}>Aún no hay entregas finalizadas</p>
        <p>Las entregas completadas durante esta sesión aparecerán aquí.</p>
      </div>
    );
  }
  return (
    <ul className={styles.list} aria-label="Últimas entregas finalizadas">
      {items.map((item) => (
        <li key={`${item.offerId}-${item.completedAt}`} className={styles.historyItem}>
          <div className={styles.cardTop}>
            <p className={styles.historyOrder}>{orderLabel(item.orderNumber)}</p>
            <span className={styles.statusChip} data-status="completed"><span aria-hidden="true">✓</span> Completada</span>
          </div>
          <p className={styles.restaurant}>{item.restaurantName}</p>
          <dl className={styles.historyFacts}>
            <div><dt>Asignada</dt><dd><time dateTime={item.assignedAt}>{formatDriverTime(item.assignedAt)}</time></dd></div>
            <div><dt>Recogida</dt><dd><time dateTime={item.pickedUpAt}>{formatDriverTime(item.pickedUpAt)}</time></dd></div>
            <div><dt>Finalizada</dt><dd><time dateTime={item.completedAt}>{formatDriverTime(item.completedAt)}</time></dd></div>
            <div><dt>Duración total</dt><dd>{formatDuration(item.durationMs)}</dd></div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
