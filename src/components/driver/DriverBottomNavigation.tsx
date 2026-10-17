import type { DriverTab } from "@/lib/driver/driver-types";
import styles from "./DriverDemo.module.css";

const tabs: { id: DriverTab; label: string; icon: string }[] = [
  { id: "offers", label: "Ofertas", icon: "◎" },
  { id: "active", label: "Entrega activa", icon: "➜" },
  { id: "history", label: "Historial", icon: "☰" },
];

export function DriverBottomNavigation({ current, counts, onSelect }: {
  current: DriverTab;
  counts: Record<DriverTab, number>;
  onSelect: (tab: DriverTab) => void;
}) {
  return (
    <nav className={styles.bottomNav} aria-label="Secciones del conductor">
      <ul>
        {tabs.map((tab) => (
          <li key={tab.id}>
            <button
              type="button"
              className={styles.navButton}
              aria-current={current === tab.id ? "page" : undefined}
              aria-controls={`driver-panel-${tab.id}`}
              onClick={() => onSelect(tab.id)}
            >
              <span className={styles.navIcon} aria-hidden="true">{tab.icon}</span>
              <span className={styles.navLabel}>{tab.label}</span>
              {counts[tab.id] > 0 && (
                <span className={styles.navCount}>
                  {counts[tab.id]}<span className="sr-only"> {counts[tab.id] === 1 ? "elemento" : "elementos"}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
