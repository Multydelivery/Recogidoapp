"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { CarIcon, CheckIcon, DispatchIcon } from "@/components/icons";
import { canCancel, demoNotice, formatCents, isScenario, isServiceType, scenarioLabels,
  serviceLabels, statusLabels, type RideRequest } from "@/lib/rides/demo";
import { useRideDemo } from "@/lib/rides/useRideDemo";
import { EconomicsMetrics, PaymentDemo, PricingBreakdown, RideReceipt } from "./RideEconomics";
import { isRideException, publicRideNumber } from "@/lib/rides/progress";
import { RideArrivalEstimate, RideDriverCard, RideExceptionCard, RideMapPlaceholder, RideProgressSummary, RideProgressTimeline } from "./RideProgressTimeline";
import styles from "./RideDemo.module.css";

type Demo = ReturnType<typeof useRideDemo>;
function Frame({ demo, active, children }: { demo: Demo; active: "request" | "status" | "admin"; children: ReactNode }) {
  const [confirmReset, setConfirmReset] = useState(false);
  return <div lang="es" className={styles.shell}>
    <div className={styles.notice}><CheckIcon aria-hidden="true" />{demoNotice}</div>
    <header className={styles.header}><div className={styles.headerInner}>
      <a href="/rides/demo" className={styles.brand}><Image src="/recogidoapplogo.png" alt="" width={48} height={48} /><span><strong>RECOGIDO</strong><span>RIDES · DEMO</span></span></a>
      <nav aria-label="Navegación del demo de viajes" className={styles.nav}>
        <a href="/rides/demo" aria-current={active === "request" ? "page" : undefined}>Solicitar viaje</a>
        <a href="/rides/demo/status" aria-current={active === "status" ? "page" : undefined}>Mi solicitud</a>
        <a href="/admin/rides/demo" aria-current={active === "admin" ? "page" : undefined}>Dispatcher demo</a>
      </nav>
    </div></header>
    <main className={styles.main}>
      <p className={styles.sessionNote}>Solo datos ficticios. El simulador avanza automáticamente mientras alguna pantalla de Rides esté abierta. Navega en esta misma pestaña; las pestañas independientes no se sincronizan.</p>
      {demo.error && <div role="alert" className={styles.error}>{demo.error}</div>}
      {demo.notices.map((notice) => <p key={notice} role="status" className={styles.confirm}>{notice}</p>)}
      {!demo.ready ? <p role="status">Cargando sesión del demo…</p> : children}
      <footer className={styles.footer}>
        <p>Simulación local · Sin proveedores, mapas, mensajes ni pagos reales. El servicio médico no es para emergencias.</p>
        {confirmReset ? <div className={styles.confirm} role="group" aria-label="Confirmar reinicio del demo">
          <p>¿Eliminar las solicitudes demo de Rides de esta pestaña?</p>
          <button type="button" className={styles.danger} onClick={() => { if (demo.reset()) setConfirmReset(false); }}>Sí, reiniciar Rides</button>
          <button type="button" className={styles.secondary} onClick={() => setConfirmReset(false)}>Conservar sesión</button>
        </div> : <button type="button" className={styles.secondary} onClick={() => setConfirmReset(true)}>Reiniciar demo de Rides</button>}
      </footer>
    </main>
  </div>;
}
function Heading({ admin = false, title, children }: { admin?: boolean; title: string; children: ReactNode }) {
  const Icon = admin ? DispatchIcon : CarIcon;
  return <div className={styles.heading}><span className={styles.headingIcon}><Icon aria-hidden="true" /></span>
    <div><p className={styles.eyebrow}>{admin ? "SUPERVISIÓN POR EXCEPCIONES · DEMO" : "VIAJES ASISTIDOS POR RECOGIDO"}</p><h1>{title}</h1><p>{children}</p></div>
  </div>;
}
function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? styles.wide : undefined}><span>{label}</span>{children}</label>;
}
function field(form: FormData, name: string) {
  const value = form.get(name);
  if (typeof value !== "string") throw new Error(`Campo inválido: ${name}.`);
  return value;
}
function date(value: string) { return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function Badge({ ride }: { ride: RideRequest }) {
  return <span className={styles.badge} data-cancelled={["needs_attention", "payment_failed", "cancelled"].includes(ride.status)}>{statusLabels[ride.status]}</span>;
}
export function RideRequestDemo() {
  const router = useRouter();
  const demo = useRideDemo();
  const [timing, setTiming] = useState<"now" | "scheduled">("now");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const lock = useRef(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    try {
      const form = new FormData(event.currentTarget);
      const serviceType = field(form, "serviceType"), scenario = field(form, "scenario"), requestChannel = field(form, "requestChannel");
      if (!isServiceType(serviceType) || !isScenario(scenario) || !["web", "phone", "operator"].includes(requestChannel)) throw new Error("Selección inválida.");
      if (requestChannel !== "web" && requestChannel !== "phone" && requestChannel !== "operator") throw new Error("Canal inválido.");
      lock.current = true;
      const saved = demo.create({
        riderName: field(form, "riderName"), riderPhone: field(form, "riderPhone"),
        pickupAddress: field(form, "pickupAddress"), destinationAddress: field(form, "destinationAddress"),
        rideTiming: timing, scheduledAt: timing === "scheduled" ? new Date(field(form, "scheduledAt")).toISOString() : null,
        passengerCount: Number(field(form, "passengerCount")), serviceType, notes: field(form, "notes"), requestChannel, scenario,
      });
      if (saved) { setSubmitted(true); router.push("/rides/demo/status"); } else lock.current = false;
    } catch (cause) { lock.current = false; setError(cause instanceof Error ? cause.message : "No se pudo crear la cotización."); }
  }
  return <Frame demo={demo} active="request">
    <Heading title="Tu próximo viaje, coordinado.">Cotización automática, autorización de prueba y seguimiento sin pasos del dispatcher.</Heading>
    <div className={styles.workspace}>
      <section className={styles.card}>
        <h2>Solicitar cotización de prueba</h2>
        <p className={styles.muted}>Usa únicamente datos ficticios. * Campos obligatorios.</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {submitted && <p role="status">Cotización guardada. <a href="/rides/demo/status">Ver solicitud</a></p>}
        <form onSubmit={submit}><fieldset disabled={!demo.session || submitted} className={styles.fields}>
          <legend className={styles.srOnly}>Solicitud ficticia</legend>
          <Field label="Nombre del pasajero *"><input name="riderName" required maxLength={100} defaultValue="Cliente Demo" autoComplete="off" /></Field>
          <Field label="Teléfono ficticio *"><input name="riderPhone" type="tel" required maxLength={30} defaultValue="2015550100" autoComplete="off" /></Field>
          <Field label="Dirección de recogida *" wide><input name="pickupAddress" required maxLength={160} defaultValue="100 Calle Demo, Ciudad Ejemplo" autoComplete="off" /></Field>
          <Field label="Dirección de destino *" wide><input name="destinationAddress" required maxLength={160} defaultValue="200 Avenida Simulada, Ciudad Ejemplo" autoComplete="off" /></Field>
          <Field label="¿Cuándo deseas viajar? *"><select value={timing} onChange={(event) => setTiming(event.target.value === "scheduled" ? "scheduled" : "now")}><option value="now">Ahora</option><option value="scheduled">Programar</option></select></Field>
          <Field label="Fecha y hora local"><input name="scheduledAt" type="datetime-local" disabled={timing !== "scheduled"} required={timing === "scheduled"} /></Field>
          <Field label="Pasajeros (1–8) *"><input name="passengerCount" type="number" min={1} max={8} step={1} required defaultValue={1} /></Field>
          <Field label="Tipo de servicio *"><select name="serviceType">{Object.entries(serviceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Notas (sin datos sensibles)" wide><textarea name="notes" rows={3} maxLength={1000} /></Field>
          <div className={styles.wide}><details><summary>Opciones de desarrollo · Solo simulación</summary>
            <Field label="Escenario simulado"><select name="scenario" defaultValue="normal">{Object.entries(scenarioLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="Canal simulado"><select name="requestChannel" defaultValue="web"><option value="web">Web</option><option value="phone">Teléfono</option><option value="operator">Operador</option></select></Field>
            <p className={styles.muted}>Estimado ficticio fijo $25.00. Cada etapa tarda aproximadamente 1.5 segundos. También los viajes programados se aceleran para demostrar el flujo, no esperan la fecha real.</p>
          </details></div>
          <button type="submit" className={`${styles.primary} ${styles.wide}`}>Solicitar cotización demo</button>
        </fieldset></form>
      </section>
      <aside className={styles.card}><h2>Automático de principio a fin</h2><ol className={styles.instructions}>
        <li>Recibe una cotización calculada automáticamente.</li><li>Acepta precio y política.</li><li>Observa el viaje y el pago de prueba avanzar solos.</li><li>Consulta tu recibo; el dispatcher solo atiende excepciones.</li>
      </ol><p>Sin rutas calculadas, ubicación real ni mensajes externos.</p></aside>
    </div>
  </Frame>;
}
function RideDetails({ ride }: { ride: RideRequest }) {
  return <>
    <div className={styles.cardHeading}><h2>{ride.riderName}</h2><Badge ride={ride} /></div><p className={styles.identifier}>Viaje {publicRideNumber(ride.id)}</p>
    <dl className={styles.details}>
      <div><dt>Recogida</dt><dd>{ride.pickupAddress}</dd></div><div><dt>Destino</dt><dd>{ride.destinationAddress}</dd></div>
      <div><dt>Hora solicitada</dt><dd>{date(ride.scheduledAt ?? ride.createdAt)}{!ride.scheduledAt && " · Inmediato"}</dd></div>
      <div><dt>Servicio / pasajeros</dt><dd>{serviceLabels[ride.serviceType]} / {ride.passengerCount}</dd></div>
      <div><dt>Creada</dt><dd>{date(ride.createdAt)}</dd></div><div><dt>Canal</dt><dd>{ride.requestChannel}</dd></div>
      <div><dt>ETA actual</dt><dd><RideArrivalEstimate arrival={ride.estimatedArrival} /></dd></div>
      <div><dt>Precio autorizado</dt><dd>{formatCents(ride.authorizedAmountCents)}{ride.authorizedAmountCents === 0 && " · Aún no autorizado"}</dd></div>
      {ride.notes && <div className={styles.wide}><dt>Notas</dt><dd>{ride.notes}</dd></div>}
    </dl>
    <PricingBreakdown pricing={ride.pricing} />
    <RideDriverCard driver={ride.driver} estimatedArrival={ride.estimatedArrival} />
    <RideReceipt ride={ride} />
  </>;
}
function CancelRide({ demo, ride }: { demo: Demo; ride: RideRequest }) {
  const [confirm, setConfirm] = useState(false);
  if (!canCancel(ride)) return null;
  return confirm ? <div className={styles.confirm}><p>¿Cancelar esta solicitud demo? Se simulará cancelación gratuita; no hay un cargo real confirmado.</p>
    <button type="button" className={styles.danger} onClick={() => { if (demo.act(ride.id, { type: "cancel" })) setConfirm(false); }}>Sí, cancelar solicitud</button>
    <button type="button" className={styles.secondary} onClick={() => setConfirm(false)}>Conservar solicitud</button>
  </div> : <button type="button" className={styles.danger} onClick={() => setConfirm(true)}>Cancelar solicitud demo</button>;
}
export function RideStatusDemo() {
  const demo = useRideDemo();
  const ride = demo.session?.requests.find((item) => item.id === demo.session?.currentRideId);
  return <Frame demo={demo} active="status">
    <Heading title="Seguimiento de tu solicitud">El sistema simula automáticamente cada etapa. No se contacta a proveedores reales.</Heading>
    {!ride ? <section className={styles.card}><h2>No hay una solicitud actual</h2><a href="/rides/demo">Solicitar cotización demo</a></section> : <div className={styles.workspace}>
      <section className={styles.card} aria-label="Solicitud actual">
        <RideExceptionCard status={ride.status} />
        <RideDetails ride={ride} /><PaymentDemo ride={ride} demo={demo} />
        <RideMapPlaceholder origin={ride.pickupAddress} destination={ride.destinationAddress} />
        {ride.status === "needs_attention" && <div className={styles.confirm} role="status">
          <p>{ride.exceptionReason === "additional_payment_required" ? "El costo final supera el monto autorizado. Necesitamos tu consentimiento para el importe adicional." : "No pudimos completar una etapa automáticamente. El equipo de supervisión revisará esta solicitud de prueba."}</p>
          {ride.exceptionReason === "additional_payment_required" && ride.settlement && !ride.additionalPaymentConsentAt && <button type="button" className={styles.primary} onClick={() => demo.act(ride.id, { type: "consent_additional", amountCents: ride.settlement!.additionalPaymentRequiredCents })}>Autorizar pago adicional de prueba de {formatCents(ride.settlement.additionalPaymentRequiredCents)}</button>}
          {ride.additionalPaymentConsentAt && !ride.additionalPaymentApprovedAt && <p>Autorización adicional registrada. Pendiente de revisión por el equipo.</p>}
        </div>}
        <div className={styles.actions}>{!isRideException(ride.status) && <CancelRide key={ride.id} demo={demo} ride={ride} />}<a href="/admin/rides/demo">Ver supervisión demo</a></div>
      </section>
      <aside className={`${styles.card} ${ride.authorizedAmountCents > 0 ? styles.timelineAside : ""}`}>
        <RideProgressTimeline status={ride.status} events={ride.statusEvents} estimatedArrival={ride.estimatedArrival} progressStatus={ride.progressStatus} />
      </aside>
    </div>}
  </Frame>;
}
function ExceptionActions({ demo, ride }: { demo: Demo; ride: RideRequest }) {
  const [note, setNote] = useState("");
  if (!["needs_attention", "payment_failed"].includes(ride.status)) return null;
  return <section className={styles.operations} aria-label="Acciones de excepción">
    <h3>Atención requerida</h3><p>Motivo: {ride.exceptionReason ?? "payment_failed"}. {ride.operatorInterventionReason}</p>
    {["provider_unavailable", "booking_error"].includes(ride.exceptionReason ?? "") && <button type="button" className={styles.primary} onClick={() => demo.act(ride.id, { type: "retry_booking" })}>Reintentar reserva de prueba</button>}
    <form onSubmit={(event) => { event.preventDefault(); demo.act(ride.id, { type: "contact_customer", note }); }}>
      <label>Nota de contacto simulado<input required maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <button type="submit" className={styles.secondary}>Contactar cliente (registrar nota, sin enviar mensajes)</button>
    </form>
    {ride.contactNote && <p>Última nota: {ride.contactNote}</p>}
    {ride.exceptionReason === "additional_payment_required" && <>
      <p>Importe adicional: {formatCents(ride.settlement?.additionalPaymentRequiredCents ?? 0)}. {ride.additionalPaymentConsentAt ? "El cliente autorizó el importe exacto." : "Falta consentimiento del cliente; no se puede cobrar."}</p>
      {!ride.additionalPaymentApprovedAt && <button type="button" className={styles.primary} disabled={!ride.additionalPaymentConsentAt} onClick={() => demo.act(ride.id, { type: "approve_additional" })}>Aprobar pago adicional previamente autorizado</button>}
      {ride.additionalPaymentApprovedAt && <button type="button" className={styles.secondary} onClick={() => demo.act(ride.id, { type: "resolve_exception" })}>Marcar problema como resuelto</button>}
    </>}
    {["final_timeout", "webhook_error", "migration"].includes(ride.exceptionReason ?? "") && <p>No hay datos suficientes para cerrar esta solicitud con seguridad. No se inventa un costo final ni un pago.</p>}
    <CancelRide demo={demo} ride={ride} />
  </section>;
}
export function RideDispatcherDemo() {
  const demo = useRideDemo();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requests = demo.session?.requests ?? [];
  const selected = requests.find((ride) => ride.id === selectedId) ?? requests.find((ride) => ride.id === demo.session?.currentRideId) ?? requests[0];
  const groups = [
    { label: "Viajes activos", rides: requests.filter((ride) => !["settled", "cancelled", "needs_attention", "payment_failed"].includes(ride.status)) },
    { label: "Viajes finalizados", rides: requests.filter((ride) => ["settled", "cancelled"].includes(ride.status)) },
    { label: "Requieren atención", rides: requests.filter((ride) => ["needs_attention", "payment_failed"].includes(ride.status)) },
  ];
  return <Frame demo={demo} active="admin">
    <Heading admin title="Supervisión de viajes">Los viajes normales avanzan y cierran solos. Este panel público de prueba solo interviene ante excepciones.</Heading>
    <EconomicsMetrics requests={requests} />
    <div className={styles.adminWorkspace}>
      <div>{groups.map((group) => <section className={`${styles.card} ${styles.metrics}`} key={group.label} aria-label={group.label}>
        <h2>{group.label} ({group.rides.length})</h2>
        {!group.rides.length && <p className={styles.muted}>Sin solicitudes en esta lista.</p>}
        <ul className={styles.queue}>{group.rides.map((ride) => <li key={ride.id}><button type="button" aria-pressed={selected?.id === ride.id} onClick={() => setSelectedId(ride.id)}><strong>{ride.riderName}</strong><RideProgressSummary ride={ride} /><span>{ride.pickupAddress} → {ride.destinationAddress}</span></button></li>)}</ul>
      </section>)}<a href="/rides/demo">Crear otra cotización demo</a></div>
      {selected ? <section className={styles.card} aria-label="Detalle de solicitud">
        <RideDetails ride={selected} />
        <RideProgressTimeline status={selected.status} events={selected.statusEvents} estimatedArrival={selected.estimatedArrival} progressStatus={selected.progressStatus} />
        <p className={styles.muted}>Escenario: {scenarioLabels[selected.scenario]} · Intervención: {selected.operatorInterventionRequired ? "Sí" : "No"} · Duplicados ignorados: {selected.duplicateEventsIgnored} · Cierres: {selected.settlementCount}.</p>
        <a className={styles.linkButton} href="/rides/demo/status" onClick={(event) => { if (!demo.select(selected.id)) event.preventDefault(); }}>Ver esta solicitud como cliente</a>
        <ExceptionActions key={selected.id} demo={demo} ride={selected} />
      </section> : <section className={styles.card}><h2>Listo para supervisar</h2><p>Crea una cotización ficticia para observar el recorrido automático.</p></section>}
    </div>
  </Frame>;
}
