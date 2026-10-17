import type { DriverDelivery } from "@/lib/driver/driver-types";
import { driverTimeline } from "@/lib/driver/driver-demo";
import styles from "./DriverDemo.module.css";

const stateText = { done: "Completado", current: "Actual", upcoming: "Pendiente" } as const;
const stateSymbol = { done: "✓", current: "●", upcoming: "" } as const;

export function DriverTimeline({ status }: { status: DriverDelivery["status"] }) {
  return (
    <ol className={styles.timeline} aria-label="Progreso de la entrega">
      {driverTimeline(status).map((step) => (
        <li key={step.key} className={styles.timelineStep} data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}>
          <span className={styles.timelineMarker} aria-hidden="true">{stateSymbol[step.state]}</span>
          <span className={styles.timelineLabel}>
            {step.label}
            <span className={styles.timelineState}>{stateText[step.state]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
