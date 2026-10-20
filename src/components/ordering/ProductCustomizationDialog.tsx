"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  getConfiguredPriceCents,
  getModifierGroupError,
  getModifierSelectionErrors,
  priceToCents,
  selectionsFromModifiers,
  type ModifierSelections,
} from "@/lib/ordering/pricing";
import type { MenuItem, SelectedModifier } from "@/lib/ordering/types";
import styles from "./OrderingExperience.module.css";

type Props = {
  item: MenuItem | null;
  initialModifiers: SelectedModifier[];
  initialQuantity: number;
  initialSpecialInstructions: string;
  editingLineId: string | null;
  onClose: () => void;
  onSave: (
    modifiers: SelectedModifier[],
    quantity: number,
    specialInstructions: string,
  ) => boolean;
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function ProductCustomizationDialog({
  item,
  initialModifiers,
  initialQuantity,
  initialSpecialInstructions,
  editingLineId,
  onClose,
  onSave,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [selections, setSelections] = useState<ModifierSelections>(() =>
    selectionsFromModifiers(initialModifiers),
  );
  const [quantity, setQuantity] = useState(initialQuantity);
  const [specialInstructions, setSpecialInstructions] = useState(initialSpecialInstructions);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (item && !dialog.open) {
      dialog.showModal();
      titleRef.current?.focus();
    } else if (!item && dialog.open) {
      dialog.close();
    }
  }, [item]);

  const modifiers = useMemo(
    () => item ? item.modifierGroups.flatMap((group) =>
      (selections[group.id] ?? []).flatMap((optionId) => {
        const option = group.options.find((candidate) => candidate.id === optionId);
        if (!option || option.priceAdjustment === null || !option.available) return [];
        return [{
          groupId: group.id,
          optionId: option.id,
          nameEs: option.nameEs,
          nameEn: option.nameEn,
          priceAdjustmentCents: priceToCents(option.priceAdjustment),
        }];
      }),
    ) : [],
    [item, selections],
  );
  const errors = item ? getModifierSelectionErrors(item, selections) : [];
  const valid = Boolean(item && item.available && errors.length === 0);
  const unitPriceCents = item ? getConfiguredPriceCents(item, modifiers) : 0;

  const closeDialog = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
    onClose();
  };

  const toggleSelection = (groupId: string, optionId: string, singleChoice: boolean) => {
    setSaveError("");
    setSelections((current) => {
      const selected = current[groupId] ?? [];
      if (singleChoice) {
        return { ...current, [groupId]: selected[0] === optionId ? [] : [optionId] };
      }
      if (selected.includes(optionId)) {
        return { ...current, [groupId]: selected.filter((id) => id !== optionId) };
      }
      const group = item?.modifierGroups.find((candidate) => candidate.id === groupId);
      if (!group || selected.length >= group.maxSelections) return current;
      return { ...current, [groupId]: [...selected, optionId] };
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!item || !valid) return;
    if (onSave(modifiers, quantity, specialInstructions)) closeDialog();
    else setSaveError("No se pudo guardar esta configuración. Revisa el máximo de unidades del producto.");
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.customizeDialog}
      aria-labelledby="customize-title"
      aria-describedby="customize-description"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDialog();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
    >
      {item && (
        <form onSubmit={submit}>
          <header className={styles.customizeHeader}>
            <div>
              <p className={styles.eyebrow}>{editingLineId ? "EDITAR OPCIONES" : "PERSONALIZA TU PLATO"}</p>
              <h2 id="customize-title" ref={titleRef} tabIndex={-1}>{item.nameEs}</h2>
              <p className={styles.itemEnglish}>{item.nameEn}</p>
            </div>
            <button
              type="button"
              className={styles.dialogClose}
              onClick={closeDialog}
              aria-label="Cerrar personalización"
            >
              ×
            </button>
          </header>
          <p id="customize-description" className={styles.dialogDescription}>
            Precio base: {formatMoney(priceToCents(item.price))}
          </p>

          <div className={styles.customizeBody}>
            <label className={styles.customizeQuantity}>
              <span>Cantidad</span>
              <input
                type="number"
                min={1}
                max={20}
                step={1}
                value={quantity}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isInteger(value)) setQuantity(Math.max(1, Math.min(20, value)));
                }}
              />
            </label>

            <div className={styles.customizeGroups}>
              {item.modifierGroups.map((group) => {
                const groupError = getModifierGroupError(item, group.id, selections);
                const singleChoice = group.maxSelections === 1;
                const selected = selections[group.id] ?? [];
                const errorId = `customize-error-${group.id}`;

                return (
                  <fieldset
                    key={group.id}
                    className={styles.customizeGroup}
                    aria-describedby={groupError ? errorId : undefined}
                  >
                    <legend>
                      <span>{group.nameEs}</span>
                      {group.required && <span className={styles.requiredLabel}>Obligatorio</span>}
                      <span className={styles.itemEnglish}>{group.nameEn}</span>
                    </legend>
                    <div className={styles.customizeOptions}>
                      {group.options.map((option) => {
                        const id = `customize-${item.id}-${group.id}-${option.id}`;
                        const checked = selected.includes(option.id);
                        const disabled = !option.available ||
                          option.priceAdjustment === null ||
                          (!singleChoice && !checked && selected.length >= group.maxSelections);
                        return (
                          <label
                            key={option.id}
                            className={styles.customizeOption}
                            htmlFor={id}
                            data-disabled={disabled}
                          >
                            <input
                              id={id}
                              type={singleChoice ? "radio" : "checkbox"}
                              name={`customize-${item.id}-${group.id}`}
                              value={option.id}
                              checked={checked}
                              disabled={disabled}
                              required={singleChoice && group.required}
                              onChange={() => toggleSelection(group.id, option.id, singleChoice)}
                            />
                            <span className={styles.customizeOptionName}>
                              <strong>{option.nameEs}</strong>
                              <span>{option.nameEn}</span>
                              {option.recommended && <em>Recomendado</em>}
                            </span>
                            <span className={styles.customizeOptionPrice}>
                              {!option.available || option.priceAdjustment === null
                                ? "Precio por confirmar"
                                : option.priceAdjustment === 0
                                  ? "Incluido"
                                  : `+${formatMoney(priceToCents(option.priceAdjustment))}`}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {item.specialInstructionsEnabled && (
                      <label className={styles.customInstructions}>
                        <span>Instrucciones especiales (opcional)</span>
                        <textarea
                          value={specialInstructions}
                          maxLength={300}
                          rows={3}
                          onChange={(event) => setSpecialInstructions(event.target.value)}
                        />
                      </label>
                    )}
                    {group.maxSelections > 1 && (
                      <p className={styles.selectionLimit} aria-live="polite">
                        {(selections[group.id] ?? []).length >= group.maxSelections
                          ? `Máximo de ${group.maxSelections} opciones alcanzado. Deselecciona una para cambiar tu selección.`
                          : `Puedes elegir hasta ${group.maxSelections} adicionales.`}
                      </p>
                    )}
                    {groupError && (
                      <p id={errorId} className={styles.selectionError} role="status">
                        {groupError}
                      </p>
                    )}
                  </fieldset>
                );
              })}
            </div>
          </div>

          <footer className={styles.customizeFooter}>
            <p className={styles.configuredPrice} aria-live="polite" aria-atomic="true">
              Precio unitario: <strong>{formatMoney(unitPriceCents)}</strong>
            </p>
            {saveError && <p className={styles.selectionError} role="alert">{saveError}</p>}
            <div className={styles.dialogActions}>
              <button type="button" className={styles.secondaryButton} onClick={closeDialog}>
                Cancelar
              </button>
              <button type="submit" className={styles.primaryButton} disabled={!valid}>
                {editingLineId ? "Guardar opciones" : "Agregar al carrito"}
              </button>
            </div>
          </footer>
        </form>
      )}
    </dialog>
  );
}
