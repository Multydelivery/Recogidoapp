import type { Metadata } from "next";
import menu from "@/data/la-fonda-paisa-menu.json";
import phaseOne from "@/data/la-fonda-paisa-modifiers-phase-1.json";
import { OrderingExperience } from "@/components/ordering/OrderingExperience";
import { resolveModifierGroupRefs } from "@/lib/ordering/catalog";

const resolvedMenu = resolveModifierGroupRefs(menu, phaseOne);
const heroImageUrl: string | null = null;

export const metadata: Metadata = {
  title: "La Fonda Paisa | Ordena con Recogido",
  description:
    "Explora el menú de La Fonda Paisa en Englewood y prepara tu pedido con Recogido.",
};

export default function LaFondaPaisaOrderPage() {
  return (
    <OrderingExperience
      restaurant={resolvedMenu.restaurant}
      categories={resolvedMenu.categories}
      items={resolvedMenu.items}
      heroImageUrl={heroImageUrl}
    />
  );
}
