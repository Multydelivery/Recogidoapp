import Image from "next/image";
import type { DriverAvailability } from "@/lib/driver/driver-types";
import { AvailabilityToggle } from "./AvailabilityToggle";
import styles from "./DriverDemo.module.css";

export function DriverHeader({ firstName, availability, activeCount, maxActive, onAvailabilityChange, live = false, availabilityDisabled = false }: {
  firstName: string;
  availability: DriverAvailability;
  activeCount: number;
  maxActive: number;
  onAvailabilityChange: (availability: DriverAvailability) => void;
  live?: boolean;
  availabilityDisabled?: boolean;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <div className={styles.brandRow}>
          <span className={styles.brandIcon}>
            <Image src="/recogidoapplogo.png" alt="" width={36} height={36} priority />
          </span>
          <div className={styles.brandText}>
            <span>Recogido</span>
            <strong>Hola, {firstName}</strong>
          </div>
          <span className={styles.demoBadge}>
            <span aria-hidden="true">◆</span> {live ? "Sistema conectado" : "Modo de demostración"}
          </span>
        </div>
        <AvailabilityToggle availability={availability} disabled={availabilityDisabled} onChange={onAvailabilityChange} />
        <p className={styles.capacity} data-full={activeCount >= maxActive}>
          <span>Capacidad activa: <strong>{activeCount} de {maxActive}</strong></span>
          <span className={styles.capacityMeter} aria-hidden="true">
            {Array.from({ length: maxActive }, (_, index) => (
              <span key={index} data-filled={index < activeCount} />
            ))}
          </span>
        </p>
      </div>
    </header>
  );
}
