import { buildTimeline, type DeliveryOrderView } from "@/lib/dispatch/delivery-progress";
import { DeliveryTimelineStep } from "./DeliveryTimelineStep";
import styles from "./DispatchTerminal.module.css";

/** Four-step progress: vertical on phones, horizontal on tablets and desktops (CSS only). */
export function DeliveryTimeline({ order }: { order: DeliveryOrderView }) {
  return (
    <ol className={styles.timeline} data-phase={order.progress.phase} aria-label={`Progreso del pedido #${order.orderNumber}`}>
      {buildTimeline(order).map((step) => <DeliveryTimelineStep key={step.key} step={step} />)}
    </ol>
  );
}
