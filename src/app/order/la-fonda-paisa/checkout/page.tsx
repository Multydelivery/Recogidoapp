import type { Metadata } from "next";
import menu from "@/data/la-fonda-paisa-menu.json";
import phaseOne from "@/data/la-fonda-paisa-modifiers-phase-1.json";
import { CheckoutPage } from "@/components/ordering/CheckoutPage";
import { resolveModifierGroupRefs } from "@/lib/ordering/catalog";

const resolvedMenu = resolveModifierGroupRefs(menu, phaseOne);

export const metadata: Metadata = {
  title: "Checkout de demostración | La Fonda Paisa",
  description: "Revisa tu pedido de demostración de La Fonda Paisa con Recogido.",
};

export default function LaFondaPaisaCheckoutPage() {
  return (
    <CheckoutPage
      restaurant={resolvedMenu.restaurant}
      items={resolvedMenu.items}
    />
  );
}
