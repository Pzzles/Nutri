// Pure helpers for validating and sanitizing Groq/LLM food-parse responses.
// Extracted so they can be unit-tested without the Deno HTTP runtime.

export const FORBIDDEN_KEYS = [
  "calories",
  "protein",
  "carbs",
  "fat",
  "fibre",
  "fiber",
  "macros",
] as const;

// Remove any item that smuggles nutrition values (FR-002 AC4).
export function filterForbiddenKeys(items: any[]): any[] {
  return items.filter((item) => {
    const keys = Object.keys(item ?? {}).map((k) => k.toLowerCase());
    return !keys.some((k) => (FORBIDDEN_KEYS as readonly string[]).includes(k));
  });
}

// Normalise fields that Groq sometimes returns as the string "null"
// instead of JSON null, and coerce quantity to a number.
export function sanitizeGroqItem(item: any): any {
  return {
    ...item,
    quantity:
      item.quantity === "null" || item.quantity === null
        ? null
        : Number(item.quantity),
    unit: item.unit === "null" || item.unit === "" ? null : item.unit,
  };
}
