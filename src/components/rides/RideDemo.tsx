"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { CarIcon, CheckIcon, DispatchIcon } from "@/components/icons";
import {
  canCancel, demoNotice, isServiceType, money, parseDollarInput, rideSteps, serviceLabels, statusLabels,
  type RideRequest,
} from "@/lib/rides/demo";
import { useRideDemo } from "@/lib/rides/useRideDemo";
import styles from "./RideDemo.module.css";

type Demo = ReturnType<typeof useRideDemo>;

function Frame({ demo, active, children }: { demo: Demo; active: "request" | "status" | "admin"; children: ReactNode }) {
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div lang="es" className={styles.shell}>
      <div className={styles.notice}><CheckIcon aria-hidden="true" />{demoNotice}</div>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a href="/rides/demo" className={styles.brand}>
            <Image src="/recogidoapplogo.png" alt="" width={48} height={48} />
            <span><strong>RECOGIDO</strong><span>RIDES · DEMO</span></span>
          </a>
          <nav aria-label="Navegación del demo de viajes" className={styles.nav}>
            <a href="/rides/demo" aria-current={active === "request" ? "page" : undefined}>Solicitar viaje</a>
            <a href="/rides/demo/status" aria-current={active === "status" ? "page" : undefined}>Mi solicitud</a>
            <a href="/admin/rides/demo" aria-current={active === "admin" ? "page" : undefined}>Dispatcher demo</a>
          </nav>
        </div>
      </header>
      <main className={styles.main}>
        <p className={styles.sessionNote}>Solo datos ficticios. Navega entre cliente y dispatcher en esta misma pestaña. La sesión no se comparte entre pestañas independientes.</p>
        {demo.error && <div role="alert" className={styles.error}>{demo.error}</div>}
        {!demo.ready ? <p role="status">Cargando sesión del demo…</p> : children}
        <footer className={styles.footer}>
          <p>Simulación local · Sin proveedores, mapas, mensajes ni pagos. La categoría médica no es un servicio de emergencias.</p>
          {confirmReset ? (
            <div className={styles.confirm} role="group" aria-label="Confirmar reinicio del demo">
              <p>¿Eliminar todas las solicitudes de Rides de esta pestaña? No afecta otros demos.</p>
              <button type="button" className={styles.danger} onClick={() => { if (demo.reset()) setConfirmReset(false); }}>Sí, reiniciar Rides</button>
              <button type="button" className={styles.secondary} onClick={() => setConfirmReset(false)}>Conservar sesión</button>
            </div>
          ) : <button type="button" className={styles.secondary} onClick={() => setConfirmReset(true)}>Reiniciar demo de Rides</button>}
        </footer>
      </main>
    </div>
  );
}

function Heading({ admin = false, title, children }: { admin?: boolean; title: string; children: ReactNode }) {
  const Icon = admin ? DispatchIcon : CarIcon;
  return (
    <div className={styles.heading}>
      <span className={styles.headingIcon}><Icon aria-hidden="true" /></span>
      <div><p className={styles.eyebrow}>{admin ? "OPERACIONES SIMULADAS" : "VIAJES ASISTIDOS POR RECOGIDO"}</p><h1>{title}</h1><p>{children}</p></div>
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? styles.wide : undefined}><span>{label}</span>{children}</label>;
}

function stringField(form: FormData, name: string) {
  const value = form.get(name);
  if (typeof value !== "string") throw new Error(`El campo ${name} no es válido.`);
  return value;
}

export function RideRequestDemo() {
  const router = useRouter();
  const demo = useRideDemo();
  const [timing, setTiming] = useState<"now" | "scheduled">("now");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const submitting = useRef(false);
  const current = demo.session?.requests.find((ride) => ride.id === demo.session?.currentRideId);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    try {
      const form = new FormData(event.currentTarget);
      const serviceType = stringField(form, "serviceType");
      if (!isServiceType(serviceType)) throw new Error("Selecciona un servicio válido.");
      const scheduledAt = timing === "scheduled" ? new Date(stringField(form, "scheduledAt")).toISOString() : null;
      submitting.current = true;
      const saved = demo.create({
        riderName: stringField(form, "riderName"), riderPhone: stringField(form, "riderPhone"),
        pickupAddress: stringField(form, "pickupAddress"), destinationAddress: stringField(form, "destinationAddress"),
        rideTiming: timing, scheduledAt,
        passengerCount: Number(stringField(form, "passengerCount")), serviceType,
        notes: stringField(form, "notes"),
      });
      if (saved) {
        setSubmitted(true);
        router.push("/rides/demo/status");
      } else submitting.current = false;
    } catch (cause) {
      submitting.current = false;
      setError(cause instanceof Error ? cause.message : "No se pudo crear la solicitud.");
    }
  }

  return (
    <Frame demo={demo} active="request">
      <Heading title="Tu próximo viaje, coordinado.">Solicita asistencia y revisa una cotización antes de aprobar. Todo en modo demostrativo.</Heading>
      <div className={styles.workspace}>
        <section className={styles.card} aria-labelledby="request-title">
          <h2 id="request-title">Solicitar un viaje de prueba</h2>
          <p className={styles.muted}>Los campos están precargados con datos ficticios. Los campos marcados con * son obligatorios.</p>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          {submitted && <p role="status">Solicitud guardada. Abriendo seguimiento… <a href="/rides/demo/status">Ver solicitud</a></p>}
          <form onSubmit={submit}>
            <fieldset disabled={!demo.session || submitted} className={styles.fields}>
              <legend className={styles.srOnly}>Datos ficticios de la solicitud</legend>
              <Field label="Nombre del pasajero *"><input name="riderName" required maxLength={100} autoComplete="off" defaultValue="Cliente Demo" /></Field>
              <Field label="Teléfono ficticio *"><input name="riderPhone" type="tel" required maxLength={30} autoComplete="off" defaultValue="2015550100" /></Field>
              <Field label="Dirección de recogida *" wide><input name="pickupAddress" required maxLength={160} autoComplete="off" defaultValue="100 Calle Demo, Ciudad Ejemplo" /></Field>
              <Field label="Dirección de destino *" wide><input name="destinationAddress" required maxLength={160} autoComplete="off" defaultValue="200 Avenida Simulada, Ciudad Ejemplo" /></Field>
              <Field label="¿Cuándo deseas viajar? *">
                <select value={timing} onChange={(event) => setTiming(event.target.value === "scheduled" ? "scheduled" : "now")}>
                  <option value="now">Ahora</option><option value="scheduled">Programar</option>
                </select>
              </Field>
              <Field label={timing === "scheduled" ? "Fecha y hora local *" : "Fecha y hora (solo programados)"}>
                <input name="scheduledAt" type="datetime-local" required={timing === "scheduled"} disabled={timing !== "scheduled"} />
              </Field>
              <Field label="Pasajeros (1–8) *"><input name="passengerCount" type="number" min={1} max={8} step={1} required defaultValue={1} /></Field>
              <Field label="Tipo de servicio *">
                <select name="serviceType" defaultValue="on_demand">{Object.entries(serviceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              </Field>
              <Field label="Notas de asistencia (opcional, sin datos sensibles)" wide><textarea name="notes" rows={3} maxLength={1000} placeholder="Ejemplo ficticio: ayuda para identificar el vehículo." /></Field>
              <button type="submit" className={`${styles.primary} ${styles.wide}`}>Crear solicitud demo</button>
            </fieldset>
          </form>
        </section>
        <aside className={styles.card}>
          <h2>Así funciona el demo</h2>
          <ol className={styles.instructions}>
            <li>Crea una solicitud con datos ficticios.</li>
            <li>Abre el dispatcher en esta pestaña para revisar y cotizar.</li>
            <li>Regresa a Mi solicitud para aprobar el precio.</li>
            <li>Simula la reserva, asignación y finalización desde el dispatcher.</li>
          </ol>
          {current && <p>Solicitud actual: <strong>{statusLabels[current.status]}</strong>. <a href="/rides/demo/status">Ver seguimiento</a></p>}
          <p className={styles.muted}>No se calcula una ruta ni una tarifa real. Los precios de prueba se ingresan manualmente en USD.</p>
        </aside>
      </div>
    </Frame>
  );
}

function Badge({ status }: { status: RideRequest["status"] }) {
  return <span className={styles.badge} data-cancelled={status === "cancelled"}>{statusLabels[status]}</span>;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function RideDetails({ ride, admin = false }: { ride: RideRequest; admin?: boolean }) {
  return (
    <>
      <div className={styles.cardHeading}><h2>{ride.riderName}</h2><Badge status={ride.status} /></div>
      <p className={styles.identifier}>{ride.id}</p>
      <dl className={styles.details}>
        <div><dt>Recogida</dt><dd>{ride.pickupAddress}</dd></div>
        <div><dt>Destino</dt><dd>{ride.destinationAddress}</dd></div>
        <div><dt>Salida</dt><dd>{ride.rideTiming === "scheduled" && ride.scheduledAt ? dateLabel(ride.scheduledAt) : "Ahora"}</dd></div>
        <div><dt>Servicio / pasajeros</dt><dd>{serviceLabels[ride.serviceType]} / {ride.passengerCount}</dd></div>
        <div><dt>Teléfono ficticio</dt><dd>{ride.riderPhone}</dd></div>
        <div><dt>Origen</dt><dd>Web · demo local</dd></div>
        <div><dt>Creada</dt><dd>{dateLabel(ride.createdAt)}</dd></div>
        <div><dt>Actualizada</dt><dd>{dateLabel(ride.updatedAt)}</dd></div>
        {ride.notes && <div className={styles.wide}><dt>Notas</dt><dd>{ride.notes}</dd></div>}
      </dl>
      <div className={styles.quote}>
        <span>Precio al cliente (USD, simulado)</span><strong>{money(ride.customerPriceCents)}</strong>
        {admin && <p>Costo estimado del proveedor: {money(ride.estimatedProviderCostCents)} · Margen estimado: {money(ride.estimatedMarginCents)}</p>}
        {admin && ride.estimatedMarginCents !== null && ride.estimatedMarginCents < 0 && <p className={styles.loss}>Atención: esta cotización tiene margen negativo.</p>}
        <p>No se cobrará este importe.</p>
      </div>
      {ride.providerReference && <p className={styles.identifier}>Referencia simulada: {ride.providerReference}</p>}
      {ride.driverName && <div className={styles.driver}><CarIcon aria-hidden="true" /><div><strong>{ride.driverName}</strong><p>{ride.vehicleDescription} · Placa: {ride.vehiclePlate}</p><p>Conductor y vehículo ficticios. No hay ubicación en tiempo real.</p></div></div>}
    </>
  );
}

function CancelRide({ demo, ride }: { demo: Demo; ride: RideRequest }) {
  const [confirm, setConfirm] = useState(false);
  if (!canCancel(ride)) return null;
  return confirm ? (
    <div role="group" aria-label="Confirmar cancelación" className={styles.confirm}>
      <p>¿Cancelar esta solicitud de prueba?</p>
      <button type="button" className={styles.danger} onClick={() => { if (demo.act(ride.id, { type: "cancel" })) setConfirm(false); }}>Sí, cancelar solicitud</button>
      <button type="button" className={styles.secondary} onClick={() => setConfirm(false)}>Conservar solicitud</button>
    </div>
  ) : <button type="button" className={styles.danger} onClick={() => setConfirm(true)}>Cancelar solicitud demo</button>;
}

export function RideStatusDemo() {
  const demo = useRideDemo();
  const ride = demo.session?.requests.find((item) => item.id === demo.session?.currentRideId);
  const step = ride ? rideSteps.findIndex((status) => status === ride.status) : -1;
  return (
    <Frame demo={demo} active="status">
      <Heading title="Seguimiento de tu solicitud">El dispatcher actualiza manualmente esta simulación. No se ha contactado a ningún proveedor.</Heading>
      {!ride ? <section className={styles.card}><h2>No hay una solicitud actual</h2><p>Crea una solicitud ficticia para empezar.</p><a className={styles.linkButton} href="/rides/demo">Solicitar viaje demo</a></section> : (
        <div className={styles.workspace}>
          <section className={styles.card} aria-label="Solicitud actual" aria-live="polite">
            <RideDetails ride={ride} />
            {ride.status === "quoted" && <div className={styles.confirm}>
              <p>Aprobarás el precio simulado de <strong>{money(ride.customerPriceCents)}</strong>. Esto no realiza una reserva ni un pago.</p>
              <button type="button" className={styles.primary} onClick={() => demo.act(ride.id, { type: "approve" })}>Aprobar precio demo</button>
            </div>}
            {ride.status === "customer_approved" && <p className={styles.success}>Precio aprobado. El dispatcher puede simular la reserva.</p>}
            {["requested", "reviewing"].includes(ride.status) && <p className={styles.muted}>Pendiente de cotización. Abre el dispatcher demo en esta pestaña para continuar.</p>}
            {ride.status === "completed" && <p className={styles.success}>Simulación completada. No se realizó ningún viaje ni cobro.</p>}
            {ride.status === "cancelled" && <p>Esta solicitud está cancelada. Puedes crear otra solicitud demo.</p>}
            <div className={styles.actions}><CancelRide key={ride.id} demo={demo} ride={ride} /><a href="/admin/rides/demo">Continuar como dispatcher demo</a></div>
          </section>
          <aside className={styles.card} aria-label="Etapas del viaje">
            <h2>Etapas de la simulación</h2>
            {ride.status === "cancelled" ? <p>No hay más pasos: solicitud cancelada.</p> : <ol className={styles.timeline}>
              {rideSteps.map((status, index) => <li key={status} data-reached={index <= step} aria-current={status === ride.status ? "step" : undefined}>
                <span aria-hidden="true">{index < step ? "✓" : index + 1}</span><div>{statusLabels[status]}{status === ride.status && <strong>Estado actual</strong>}</div>
              </li>)}
            </ol>}
            <p className={styles.muted}>Se muestra la secuencia del demo, no un historial de eventos ni una ubicación real.</p>
          </aside>
        </div>
      )}
    </Frame>
  );
}

function DispatcherActions({ demo, ride }: { demo: Demo; ride: RideRequest }) {
  const [error, setError] = useState<string | null>(null);
  function quote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const form = new FormData(event.currentTarget);
      const providerCostCents = parseDollarInput(stringField(form, "cost"));
      const customerPriceCents = parseDollarInput(stringField(form, "price"));
      if (providerCostCents === null) throw new Error("Costo proveedor: ingresa dólares válidos, por ejemplo $18.50, con hasta dos decimales y un máximo de $1,000,000.00.");
      if (customerPriceCents === null) throw new Error("Precio cliente: ingresa dólares válidos, por ejemplo $21.00, con hasta dos decimales y un máximo de $1,000,000.00.");
      demo.act(ride.id, { type: "quote", providerCostCents, customerPriceCents });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo preparar la cotización.");
    }
  }
  function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    demo.act(ride.id, {
      type: "assign", driverName: stringField(form, "driverName"),
      vehicleDescription: stringField(form, "vehicleDescription"), vehiclePlate: stringField(form, "vehiclePlate"),
    });
  }
  return (
    <section className={styles.operations} aria-labelledby="actions-title">
      <h3 id="actions-title">Acciones del dispatcher</h3>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {ride.status === "requested" && <button type="button" className={styles.primary} onClick={() => demo.act(ride.id, { type: "review" })}>Revisar solicitud</button>}
      {["reviewing", "quoted"].includes(ride.status) && <form onSubmit={quote} className={styles.fields}>
        <Field label="Costo proveedor (USD) *"><input name="cost" type="text" inputMode="decimal" required aria-describedby="ride-dollar-help" placeholder="$18.50" defaultValue={ride.estimatedProviderCostCents === null ? "20.00" : (ride.estimatedProviderCostCents / 100).toFixed(2)} /></Field>
        <Field label="Precio cliente (USD) *"><input name="price" type="text" inputMode="decimal" required aria-describedby="ride-dollar-help" placeholder="$21.00" defaultValue={ride.customerPriceCents === null ? "28.00" : (ride.customerPriceCents / 100).toFixed(2)} /></Field>
        <p id="ride-dollar-help" className={`${styles.muted} ${styles.wide}`}>Escribe dólares, no centavos: 18.50, $18.50, 21 o 21.00. Sin separadores de miles; máximo dos decimales. El margen se calcula como precio menos costo.</p>
        <button type="submit" className={styles.primary}>{ride.status === "quoted" ? "Actualizar cotización demo" : "Enviar cotización demo"}</button>
      </form>}
      {ride.status === "quoted" && <p>Esperando aprobación. <a href="/rides/demo/status" onClick={(event) => { if (!demo.select(ride.id)) event.preventDefault(); }}>Ver como cliente para aprobar</a></p>}
      {ride.status === "customer_approved" && <button type="button" className={styles.primary} onClick={() => demo.act(ride.id, { type: "book", providerReference: `RESERVA-DEMO-${ride.id.slice(-8)}` })}>Simular reserva (sin proveedor)</button>}
      {ride.status === "booked" && <form onSubmit={assign} className={styles.fields}>
        <Field label="Conductor ficticio *"><input name="driverName" required maxLength={100} defaultValue="Conductor Demo" /></Field>
        <Field label="Vehículo ficticio *"><input name="vehicleDescription" required maxLength={160} defaultValue="Sedán demo azul" /></Field>
        <Field label="Placa ficticia *"><input name="vehiclePlate" required maxLength={30} defaultValue="DEMO-001" /></Field>
        <button type="submit" className={styles.primary}>Asignar conductor demo</button>
      </form>}
      {["driver_assigned", "arriving", "picked_up"].includes(ride.status) && <button type="button" className={styles.primary} onClick={() => demo.act(ride.id, { type: "advance" })}>
        {ride.status === "driver_assigned" ? "Simular conductor en camino" : ride.status === "arriving" ? "Simular pasajero a bordo" : "Completar viaje demo"}
      </button>}
      {["completed", "cancelled"].includes(ride.status) && <p>Solicitud cerrada. No admite más cambios.</p>}
      <div className={styles.actions}><CancelRide demo={demo} ride={ride} /></div>
    </section>
  );
}

export function RideDispatcherDemo() {
  const demo = useRideDemo();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const requests = demo.session?.requests ?? [];
  const filtered = requests.filter((ride) => filter === "all" || ride.status === filter);
  const selected = filtered.find((ride) => ride.id === selectedId) ??
    filtered.find((ride) => ride.id === demo.session?.currentRideId) ?? filtered[0];
  const active = requests.filter((ride) => !["completed", "cancelled"].includes(ride.status)).length;
  return (
    <Frame demo={demo} active="admin">
      <Heading admin title="Dispatcher de viajes">Panel público de demostración. No es un administrador de producción y no requiere credenciales.</Heading>
      <div className={styles.stats} aria-label="Resumen de solicitudes"><span><strong>{requests.length}</strong> solicitudes</span><span><strong>{active}</strong> activas</span><span><strong>{requests.filter((ride) => ride.status === "completed").length}</strong> completadas</span></div>
      <div className={styles.adminWorkspace}>
        <section className={styles.card} aria-labelledby="queue-title">
          <h2 id="queue-title">Solicitudes de esta sesión</h2>
          <Field label="Filtrar por estado"><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Todos los estados</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          {!filtered.length && <p className={styles.muted}>{requests.length ? "No hay solicitudes con este estado." : "Aún no hay solicitudes. Crea una desde el formulario del cliente."}</p>}
          <ul className={styles.queue}>{filtered.map((ride) => <li key={ride.id}>
            <button type="button" aria-pressed={selected?.id === ride.id} onClick={() => setSelectedId(ride.id)}>
              <strong>{ride.riderName}</strong><Badge status={ride.status} /><span>{ride.pickupAddress} → {ride.destinationAddress}</span><small>{dateLabel(ride.createdAt)}</small>
            </button>
          </li>)}</ul>
          <a href="/rides/demo">Crear otra solicitud demo</a>
        </section>
        {selected ? <section className={styles.card} aria-label="Detalle de la solicitud seleccionada">
          <RideDetails ride={selected} admin />
          <a className={styles.linkButton} href="/rides/demo/status" onClick={(event) => { if (!demo.select(selected.id)) event.preventDefault(); }}>Ver esta solicitud como cliente</a>
          <DispatcherActions key={`${selected.id}-${selected.status}`} demo={demo} ride={selected} />
        </section> : <section className={styles.card}><h2>{requests.length ? "Sin resultados para este filtro" : "Todo listo para probar"}</h2><p>{requests.length ? "Selecciona otro estado para consultar las solicitudes de esta sesión." : "Las solicitudes aparecerán aquí al crearlas en esta misma pestaña. No se cargan datos de producción."}</p></section>}
      </div>
    </Frame>
  );
}
