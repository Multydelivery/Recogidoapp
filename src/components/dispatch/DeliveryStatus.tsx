import type { Ref } from "react";
import { CarIcon, CheckIcon, DispatchIcon } from "@/components/icons";
import type { DemoRequest } from "@/lib/dispatch/demo-types";
import styles from "./DispatchDemo.module.css";

interface DeliveryStatusProps {
  request: DemoRequest;
  headingRef: Ref<HTMLHeadingElement>;
}

const steps = ["Solicitud recibida", "Oferta enviada", "Buscando conductor", "Conductor asignado"];

export function DeliveryStatus({ request, headingRef }: DeliveryStatusProps) {
  const assigned = request.status === "assigned";
  const cancelled = request.status === "cancelled";
  const title = cancelled
    ? "SOLICITUD CANCELADA"
    : assigned
      ? "CONDUCTOR ASIGNADO"
      : "SOLICITUD ENVIADA";

  return (
    <div className={`${styles.statusPanel} ${cancelled ? styles.cancelledPanel : styles.successPanel}`}>
      <div className={styles.statusIcon} aria-hidden="true">
        {cancelled ? <span>×</span> : assigned ? <CarIcon /> : <CheckIcon />}
      </div>
      <h1 className={styles.statusTitle} tabIndex={-1} ref={headingRef}>{title}</h1>
      <p className={styles.deliveryTotal}>
        {request.deliveryCount} {request.deliveryCount === 1 ? "ENTREGA" : "ENTREGAS"}
      </p>
      {assigned ? (
        <p className={styles.driverName}>{request.driverName}</p>
      ) : cancelled ? (
        <p>La búsqueda se detuvo. Puedes crear una nueva solicitud.</p>
      ) : (
        <p className={styles.searching}><DispatchIcon aria-hidden="true" /> BUSCANDO CONDUCTOR</p>
      )}
      <p className={styles.requestId}>Solicitud: <span>{request.requestId}</span></p>
      {!cancelled && (
        <ol className={styles.progress} aria-label="Progreso de la solicitud">
          {steps.map((step, index) => {
            const complete = assigned || index < 2;
            const current = assigned ? index === 3 : index === 2;
            return (
              <li key={step} aria-current={current ? "step" : undefined}>
                <span className={complete || current ? styles.activeStep : styles.pendingStep} aria-hidden="true">
                  {complete ? <CheckIcon /> : index + 1}
                </span>
                <span>{step}<span className="sr-only">{complete ? ": completado" : current ? ": en curso" : ": pendiente"}</span></span>
                {index < steps.length - 1 && <span className={styles.stepArrow} aria-hidden="true">→</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
