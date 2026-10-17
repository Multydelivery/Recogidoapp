import { useId, type ReactNode } from "react";
import { formatOrderNumber, type DeliveryOrderView } from "@/lib/dispatch/delivery-progress";
import { formatClock } from "@/lib/dispatch/dispatch-queue";
import { DeliveryAlert } from "./DeliveryAlert";
import { DeliveryStatusBadge } from "./DeliveryStatusBadge";
import { DeliveryTimeline } from "./DeliveryTimeline";
import styles from "./DispatchTerminal.module.css";

function clock(value?: string) {
  return value && Number.isFinite(Date.parse(value)) ? formatClock(value) : null;
}

/**
 * One trackable order (#E814C7-01) with its status badge and timeline.
 * Only public data is rendered: order number, restaurant and driver names, and times.
 */
export function DeliveryOrderCard({ order, restaurantName, meta, children, headingLevel = 3, showAlert = true }: {
  order: DeliveryOrderView;
  restaurantName?: string;
  /** Extra line under the times (e.g. elapsed time). */
  meta?: ReactNode;
  /** Actions or notices rendered at the bottom of the card. */
  children?: ReactNode;
  headingLevel?: 3 | 4;
  /** Groups show the "still searching" notice once for the whole request instead of on every card. */
  showAlert?: boolean;
}) {
  const titleId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h4";
  const { progress } = order;
  const created = clock(order.createdAt);
  const updated = clock(order.updatedAt);
  const finishedAt = progress.phase === "cancelled" ? order.cancelledAt : progress.phase === "completed" ? order.completedAt : undefined;
  const finished = clock(finishedAt);
  const position = order.totalDeliveries > 1
    ? `Entrega ${order.deliveryNumber} de ${order.totalDeliveries}`
    : order.deliveriesInOrder > 1 ? `${order.deliveriesInOrder} entregas · un conductor` : null;
  return (
    <article className={styles.orderCard} data-phase={progress.phase} aria-labelledby={titleId}>
      <header className={styles.orderHeader}>
        <div className={styles.orderIdentity}>
          <span className={styles.orderEyebrow}>Orden</span>
          <Heading id={titleId} className={styles.orderNumber}>{formatOrderNumber(order.orderNumber)}</Heading>
          {position && <span className={styles.orderPosition}>{position}</span>}
        </div>
        <DeliveryStatusBadge progress={progress} />
      </header>
      {restaurantName && <p className={styles.orderRestaurant}>{restaurantName}</p>}
      {progress.showDriver && order.driverName && (
        <p className={styles.orderDriver}>Conductor: <strong>{order.driverName}</strong></p>
      )}
      <p className={styles.orderMessage}>{progress.message}</p>
      {showAlert && progress.alert && <DeliveryAlert>{progress.alert}</DeliveryAlert>}
      <DeliveryTimeline order={order} />
      <p className={styles.orderTimes}>
        {created && <span>Creada <time dateTime={order.createdAt}>{created}</time></span>}
        {finished && finishedAt && (
          <span>{progress.phase === "cancelled" ? "Cancelada" : "Completada"} <time dateTime={finishedAt}>{finished}</time></span>
        )}
        {!finished && updated && order.updatedAt && updated !== created && (
          <span>Actualizada <time dateTime={order.updatedAt}>{updated}</time></span>
        )}
        {meta}
      </p>
      {children}
    </article>
  );
}
