import type { ReactNode } from "react";
import Image from "next/image";
import { RestaurantIcon } from "@/components/icons";
import { formatDemoTime } from "@/lib/dispatch/demo-types";
import styles from "./DispatchDemo.module.css";

export function DispatchFrame({ restaurantName, now, connected = true, mockMode = true, connectionFailed = false, children }: {
  restaurantName: string;
  now: string | null;
  connected?: boolean;
  mockMode?: boolean;
  connectionFailed?: boolean;
  children: ReactNode;
}) {
  return (
    <div lang="es" className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}>
              <Image src="/recogidoapplogo.png" alt="" width={56} height={56} priority />
            </span>
            <div><strong>RECOGIDO</strong><span>DISPATCH</span></div>
          </div>
          <div className={styles.restaurant}><RestaurantIcon aria-hidden="true" /><div><span>Restaurante</span><strong>{restaurantName}</strong></div></div>
          <div className={styles.connection}>
            <span><i aria-hidden="true" data-offline={!connected} /> {connectionFailed ? "Sin conexión" : connected ? mockMode ? "En línea" : "Sistema conectado" : "Sin verificar"}</span>
            <time dateTime={now ?? undefined} aria-label="Hora actual">{now ? formatDemoTime(now) : "--:--"}</time>
          </div>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.workspaceHeading}>
          <p>Panel de restaurante <span>/ Despacho de entregas</span></p>
          <span className={styles.demoBadge}>{mockMode ? "Modo de demostración" : connectionFailed ? "Sin conexión" : connected ? "Sistema conectado" : "Sin verificar"}</span>
        </div>
        {children}
        <footer className={styles.footer}>
          <span>RECOGIDO DISPATCH <span>· Terminal de restaurante</span></span>
          <span>{mockMode ? "Demo local. Sin Twilio, Make ni APIs externas." : "Operaciones mediante el servicio central."}</span>
        </footer>
      </main>
    </div>
  );
}
