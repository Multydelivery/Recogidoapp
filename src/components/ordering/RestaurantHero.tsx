"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { CarIcon } from "@/components/icons";
import type { Restaurant } from "@/lib/ordering/types";
import styles from "./RestaurantHero.module.css";

type Props = {
  restaurant: Restaurant;
  heroImageUrl: string | null;
  onDialogOpenChange?: (open: boolean) => void;
};

function LocationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  );
}

export function RestaurantHero({
  restaurant,
  heroImageUrl,
  onDialogOpenChange,
}: Props) {
  const imageIsLocal = Boolean(heroImageUrl?.startsWith("/") && !heroImageUrl.startsWith("//"));
  const imageSource = imageIsLocal ? heroImageUrl : null;
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoading, setImageLoading] = useState(imageIsLocal);
  const addressDialogRef = useRef<HTMLDialogElement>(null);

  const openAddressDialog = () => {
    addressDialogRef.current?.showModal();
    onDialogOpenChange?.(true);
  };
  const closeAddressDialog = () => {
    if (addressDialogRef.current?.open) addressDialogRef.current.close();
    onDialogOpenChange?.(false);
  };

  return (
    <>
      <section className={styles.hero} aria-labelledby="restaurant-title">
        <div className={styles.heroVisual} data-image-loading={imageLoading}>
          {imageSource && !imageFailed && (
            <Image
              className={styles.heroImage}
              src={imageSource}
              alt=""
              fill
              priority
              sizes="(max-width: 800px) 100vw, 1200px"
              onLoad={() => setImageLoading(false)}
              onError={() => {
                setImageLoading(false);
                setImageFailed(true);
              }}
            />
          )}
          {(!imageIsLocal || imageFailed) && (
            <div className={styles.placeholder}>
              <span className={styles.placeholderIcon} aria-hidden="true"><CarIcon /></span>
              <span className={styles.placeholderCaption}>Foto del restaurante próximamente</span>
            </div>
          )}
          {imageLoading && !imageFailed && (
            <span className={styles.loadingStatus} role="status">Cargando imagen del restaurante</span>
          )}
          <div className={styles.imageOverlay} aria-hidden="true" />
          <div className={styles.heroContent}>
            <span className={styles.deliveryBadge}>
              <CarIcon aria-hidden="true" />
              Entrega local con Recogido
            </span>
            <h1 id="restaurant-title">{restaurant.name}</h1>
            <p>{restaurant.cuisine} <span aria-hidden="true">•</span> {restaurant.address.city}, {restaurant.address.state}</p>
          </div>
        </div>
        <button
          type="button"
          className={styles.addressButton}
          aria-label="Ingresar dirección de entrega"
          onClick={openAddressDialog}
        >
          <span className={styles.locationIcon}><LocationIcon /></span>
          <span className={styles.addressButtonText}>
            <strong>Ingresa tu dirección</strong>
            <span>Para consultar disponibilidad de entrega</span>
          </span>
          <svg className={styles.addressArrow} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </section>

      <dialog
        ref={addressDialogRef}
        className={styles.addressDialog}
        aria-labelledby="address-dialog-title"
        onClose={() => onDialogOpenChange?.(false)}
        onCancel={(event) => {
          event.preventDefault();
          closeAddressDialog();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeAddressDialog();
        }}
      >
        <div className={styles.dialogIcon}><LocationIcon /></div>
        <h2 id="address-dialog-title">Dirección de entrega</h2>
        <p>La validación de direcciones estará disponible próximamente.</p>
        <button type="button" onClick={closeAddressDialog}>
          Entendido
        </button>
      </dialog>
    </>
  );
}
