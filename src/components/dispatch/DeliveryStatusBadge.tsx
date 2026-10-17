import type { DeliveryPhase, DeliveryProgress } from "@/lib/dispatch/delivery-progress";
import { DeliveryIcon, type DeliveryIconName } from "./DeliveryIcon";
import styles from "./DispatchTerminal.module.css";

const phaseIcon: Record<DeliveryPhase, DeliveryIconName> = {
  searching: "search",
  assigned: "driver",
  picked_up: "truck",
  completed: "check",
  cancelled: "x",
};

/** Status pill: icon + text so the state never depends on color alone. */
export function DeliveryStatusBadge({ progress }: { progress: Pick<DeliveryProgress, "phase" | "badge"> }) {
  return (
    <span className={styles.deliveryBadge} data-phase={progress.phase}>
      <DeliveryIcon name={phaseIcon[progress.phase]} /> {progress.badge}
    </span>
  );
}
