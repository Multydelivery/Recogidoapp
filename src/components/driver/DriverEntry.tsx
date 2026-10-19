"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./DriverDemo.module.css";

export function DriverEntry() {
  const [slug, setSlug] = useState("");
  const router = useRouter();
  return (
    <main className={styles.main}>
      <h1 className={styles.panelTitle}>Recogido Conductor</h1>
      <p>Abra el enlace privado que le fue asignado o ingrese su identificador.</p>
      <form className={styles.card} onSubmit={(event) => {
        event.preventDefault();
        router.push(`/driver/${encodeURIComponent(slug)}`);
      }}>
        <label htmlFor="driver-slug">Identificador de conductor</label>
        <input id="driver-slug" value={slug} onChange={(event) => setSlug(event.target.value)}
          pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} autoCapitalize="none" autoCorrect="off" required />
        <button className={styles.primaryButton}>Continuar</button>
      </form>
    </main>
  );
}
