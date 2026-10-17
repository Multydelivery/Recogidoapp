import type { ReactNode } from "react";
import { DeliveryIcon } from "./DeliveryIcon";
import styles from "./DispatchTerminal.module.css";

/** Discreet inline notice inside a card (not an error: the polite live region already announces changes). */
export function DeliveryAlert({ children, tone = "warning" }: { children: ReactNode; tone?: "warning" | "info" }) {
  return (
    <p className={styles.deliveryAlert} data-tone={tone}>
      <DeliveryIcon name={tone === "warning" ? "alert" : "search"} />
      <span>{children}</span>
    </p>
  );
}
