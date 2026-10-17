import type { DriverDelivery } from "@/lib/driver/driver-types";
import { ActiveDeliveryCard } from "./ActiveDeliveryCard";
import styles from "./DriverDemo.module.css";

/** One independent card per active delivery; each advances assigned → picked_up → completed on its own. */
export function ActiveDeliveries({ deliveries, pendingOfferId, busy, onConfirmPickup, onRequestCompletion }: {
  deliveries: DriverDelivery[];
  pendingOfferId: string | null;
  busy: boolean;
  onConfirmPickup: (delivery: DriverDelivery) => void;
  onRequestCompletion: (delivery: DriverDelivery) => void;
}) {
  return (
    <ul className={styles.list} aria-label={`${deliveries.length} ${deliveries.length === 1 ? "entrega activa" : "entregas activas"}`}>
      {deliveries.map((delivery) => (
        <li key={delivery.offerId}>
          <ActiveDeliveryCard
            delivery={delivery}
            loading={pendingOfferId === delivery.offerId}
            disabled={busy}
            onConfirmPickup={() => onConfirmPickup(delivery)}
            onRequestCompletion={() => onRequestCompletion(delivery)}
          />
        </li>
      ))}
    </ul>
  );
}
