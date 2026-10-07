import type { ReactNode } from "react";
import { DispatchIcon, RestaurantIcon } from "@/components/icons";
import { formatDemoTime } from "@/lib/dispatch/demo-types";
import styles from "./DispatchDemo.module.css";

export function DispatchFrame({ restaurantName, now, connected = true, children }: {
  restaurantName: string;
  now: string | null;
  connected?: boolean;
  children: ReactNode;
}) {
  return (
    <div lang="es" className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}><DispatchIcon aria-hidden="true" /></span>
            <div><strong>RECOGIDO</strong><span>DISPATCH</span></div>
          </div>
          <div className={styles.restaurant}><RestaurantIcon aria-hidden="true" /><div><span>Restaurante</span><strong>{restaurantName}</strong></div></div>
          <div className={styles.connection}>
            <span><i aria-hidden="true" data-offline={!connected} /> {connected ? "En línea" : "Sin verificar"}</span>
            <time dateTime={now ?? undefined} aria-label="Hora actual">{now ? formatDemoTime(now) : "--:--"}</time>
          </div>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.workspaceHeading}>
          <p>Panel de restaurante <span>/ Despacho de entregas</span></p>
          <span className={styles.demoBadge}>MODO DEMO</span>
        </div>
        {children}
        <footer className={styles.footer}>
          <span>RECOGIDO DISPATCH <span>· Terminal de restaurante</span></span>
          <span>Demo local. Sin Twilio, Make ni APIs externas.</span>
        </footer>
      </main>
    </div>
  );
}
