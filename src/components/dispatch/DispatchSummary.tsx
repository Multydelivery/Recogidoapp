import type { DeliveryBoardSummary } from "@/lib/dispatch/delivery-progress";
import styles from "./DispatchTerminal.module.css";

/** Four indicators computed only from loaded data (active queue + real history). */
export function DispatchSummary({ counts }: { counts: DeliveryBoardSummary }) {
  const unit = (value: number) => value === 1 ? "entrega" : "entregas";
  const items = [
    { key: "searching", label: "Buscando", value: counts.searching },
    { key: "assigned", label: "Asignadas", value: counts.assigned },
    { key: "on-the-way", label: "En camino", value: counts.onTheWay },
    { key: "completed", label: "Completadas hoy", value: counts.completedToday },
  ];
  return (
    <section className={styles.summary} aria-label="Resumen operativo">
      {items.map((item) => (
        <div key={item.key} className={styles.summaryItem} data-kind={item.key}>
          <span className={styles.summaryLabel}>{item.label}</span>
          <strong className={styles.summaryValue}>{item.value}</strong>
          <span className={styles.summaryUnit}>{unit(item.value)}</span>
        </div>
      ))}
    </section>
  );
}
