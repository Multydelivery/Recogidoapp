import type { DriverAvailability } from "@/lib/driver/driver-types";
import styles from "./DriverDemo.module.css";

export function AvailabilityToggle({ availability, disabled = false, onChange }: {
  availability: DriverAvailability;
  disabled?: boolean;
  onChange: (availability: DriverAvailability) => void;
}) {
  const available = availability === "available";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={available}
      aria-label="Disponibilidad para recibir ofertas"
      className={styles.availabilityToggle}
      data-state={availability}
      disabled={disabled}
      onClick={() => onChange(available ? "unavailable" : "available")}
    >
      <span className={styles.toggleTrack} aria-hidden="true"><span className={styles.toggleThumb} /></span>
      <span className={styles.toggleText}>
        <span aria-hidden="true">{available ? "●" : "○"}</span> {available ? "Disponible" : "No disponible"}
      </span>
    </button>
  );
}
