import type { CalculatedItem } from "./types";

export function scaleMacros(item: CalculatedItem, newGrams: number): CalculatedItem {
  const scale = newGrams / item.portion_g;
  return {
    ...item,
    portion_g: newGrams,
    portion_source: "explicit",
    history_use_count: null,
    quantity: newGrams,
    unit: "g",
    calories: Math.round(item.calories * scale * 10) / 10,
    protein_g: Math.round(item.protein_g * scale * 10) / 10,
    carbs_g: Math.round(item.carbs_g * scale * 10) / 10,
    fat_g: Math.round(item.fat_g * scale * 10) / 10,
    fibre_g: item.fibre_g != null ? Math.round(item.fibre_g * scale * 10) / 10 : null,
  };
}
