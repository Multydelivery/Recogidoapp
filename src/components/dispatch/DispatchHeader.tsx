import Image from "next/image";
import { formatClock } from "@/lib/dispatch/dispatch-queue";
import styles from "./DispatchTerminal.module.css";

export type TerminalConnection = "connected" | "syncing" | "offline";

const connectionText: Record<TerminalConnection, { label: string; symbol: string }> = {
  connected: { label: "Sistema conectado", symbol: "●" },
  syncing: { label: "Actualizando", symbol: "↻" },
  offline: { label: "Sin conexión", symbol: "!" },
};

export function DispatchHeader({ restaurantName, now, connection, muted, onToggleSound, onDisconnect, disconnectDisabled = false }: {
  restaurantName: string;
  now: number | null;
  connection: TerminalConnection | null;
  muted: boolean;
  onToggleSound: () => void;
  onDisconnect?: () => void;
  disconnectDisabled?: boolean;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>
            <Image src="/recogidoapplogo.png" alt="Recogido" width={44} height={44} priority />
          </span>
          <div className={styles.brandText}>
            <span>Recogido</span>
            <strong>{restaurantName}</strong>
          </div>
        </div>
        <div className={styles.headerStatus}>
          {connection && (
            <span className={styles.connection} data-state={connection}>
              <span aria-hidden="true">{connectionText[connection].symbol}</span>
              {connectionText[connection].label}
            </span>
          )}
          <time className={styles.clock} dateTime={now ? new Date(now).toISOString() : undefined} aria-label="Hora local">
            {now ? formatClock(now) : "--:--"}
          </time>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.ghostButton} aria-pressed={!muted} onClick={onToggleSound}>
            <span aria-hidden="true">{muted ? "🔇" : "🔔"}</span> {muted ? "Sonido apagado" : "Sonido activado"}
          </button>
          {onDisconnect && (
            <button type="button" className={styles.ghostButton} disabled={disconnectDisabled} onClick={onDisconnect}>
              Desconectar terminal
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
