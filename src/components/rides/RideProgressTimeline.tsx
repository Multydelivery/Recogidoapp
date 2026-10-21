import { CarIcon, CheckIcon } from "@/components/icons";
import type { RideRequest, RideStatus } from "@/lib/rides/demo";
import { arrivalText, exceptionPresentation, getRideTimeline, isRideException, publicRideNumber,
  publicStatusLabels, ridePresentation, rideTime, type RideArrival, type RideDriver, type RideStatusEvent } from "@/lib/rides/progress";
import styles from "./RideDemo.module.css";

type TimelineProps = {
  status: RideStatus;
  events: RideStatusEvent[];
  estimatedArrival: RideArrival | null;
  progressStatus?: RideStatus;
};
export function RideArrivalEstimate({ arrival }: { arrival: RideArrival | null }) {
  return <span className={styles.arrival}>
    <span>{arrivalText(arrival)}</span>
    {arrival && <span>Llegada estimada: <time dateTime={arrival.arrivesAt}>{rideTime(arrival.arrivesAt)}</time></span>}
  </span>;
}
export function RideProgressTimeline({ status, events, estimatedArrival, progressStatus = status }: TimelineProps) {
  const presentation = ridePresentation(status);
  const steps = getRideTimeline(status, events, progressStatus);
  return <section className={styles.progressPanel} aria-label="Etapas del viaje">
    <div className={styles.progressHeading} aria-live="polite" aria-atomic="true">
      <p className={styles.eyebrow}>SEGUIMIENTO · DEMO</p>
      <h2>{presentation.heading}</h2><p>{presentation.description}</p>
    </div>
    <ol className={styles.timeline} aria-label="Progreso del viaje">
      {steps.map((step, index) => <li key={step.status} data-phase={step.phase}
        data-current={step.current} aria-current={step.current ? "step" : undefined}>
        <span className={styles.stepCircle} aria-hidden="true">{step.phase === "completed" ? <CheckIcon /> : index + 1}</span>
        <div className={styles.stepContent}>
          <strong>{step.label}</strong>
          <span className={styles.stepState}>{step.phase === "completed" ? "Completada" : step.phase === "current" ? "Etapa actual" : "Pendiente"}</span>
          {step.occurredAt && step.phase !== "pending" && <time dateTime={step.occurredAt}>{rideTime(step.occurredAt)}</time>}
          {step.phase === "completed" && !step.occurredAt && <span>Hora no registrada en la versión anterior</span>}
          {step.phase === "current" && <RideArrivalEstimate arrival={estimatedArrival} />}
        </div>
      </li>)}
    </ol>
    <p className={styles.muted}>Actualización automática y acelerada. Sin ubicación real ni sonidos.</p>
  </section>;
}
export function RideDriverCard({ driver, estimatedArrival }: { driver: RideDriver | null; estimatedArrival: RideArrival | null }) {
  if (!driver) return null;
  return <section className={styles.driverCard} aria-label="Conductor de demostración">
    <span className={styles.driverAvatar} aria-hidden="true"><CarIcon /></span>
    <div><h3>{driver.publicName}</h3><p>Perfil y vehículo de demostración</p>
      <dl className={styles.driverDetails}>
        <div><dt>Vehículo</dt><dd>{driver.vehicle}</dd></div>
        <div><dt>Color</dt><dd>{driver.color ?? "No registrado"}</dd></div>
        <div><dt>Placa demo</dt><dd>{driver.plate}</dd></div>
      </dl>
      {estimatedArrival && <RideArrivalEstimate arrival={estimatedArrival} />}
      <p className={styles.muted}>Datos ficticios. El demo no permite llamar ni enviar mensajes al conductor.</p>
    </div>
  </section>;
}
export function RideExceptionCard({ status }: { status: RideStatus }) {
  if (!isRideException(status)) return null;
  return <section className={styles.exceptionCard} aria-label="Aviso sobre la solicitud">
    <h2>{exceptionPresentation[status].label}</h2><p>{exceptionPresentation[status].description}</p>
    <div className={styles.actions}><a className={styles.linkButton} href="/rides/demo">Solicitar otro viaje</a>
      <a className={styles.secondary} href="/rides/demo">Volver al inicio</a></div>
  </section>;
}
export function RideProgressSummary({ ride }: { ride: RideRequest }) {
  const steps = getRideTimeline(ride.status, ride.statusEvents, ride.progressStatus);
  const reached = steps.filter((step) => step.phase !== "pending").length;
  return <span className={styles.progressSummary}>
    <strong>{publicRideNumber(ride.id)}</strong>
    <span>{publicStatusLabels[ride.status]}</span>
    <span>Última actualización: <time dateTime={ride.updatedAt}>{rideTime(ride.updatedAt)}</time></span>
    <span>{arrivalText(ride.estimatedArrival)}</span>
    <span>Avance: {reached} de {steps.length} etapas</span>
    <span className={styles.progressTrack} aria-hidden="true"><span style={{ width: `${reached / steps.length * 100}%` }} /></span>
    {isRideException(ride.status) && <strong>{ride.status === "cancelled" ? "Cancelado" : "Atención requerida"}</strong>}
  </span>;
}
export function RideMapPlaceholder({ origin, destination }: { origin: string; destination: string }) {
  return <figure className={styles.demoMap} aria-label={`Mapa de demostración. Origen: ${origin}. Destino: ${destination}. Ruta ilustrativa, sin ubicación real.`}>
    <div className={styles.mapRoute} aria-hidden="true"><span>Origen</span><span className={styles.routeLine} />
      <span className={styles.mapVehicle}><CarIcon /></span><span className={styles.routeLine} /><span>Destino</span></div>
    <figcaption><strong>Mapa de demostración</strong><span>Origen: {origin}</span><span>Destino: {destination}</span>
      <span>Línea ilustrativa; no representa distancias ni ubicación del vehículo.</span></figcaption>
  </figure>;
}
