import {
  ANTHROPOMETRY_SITE_CODES,
  ANTHROPOMETRY_MAX_READING_TENTHS,
  ANTHROPOMETRY_MIN_READING_TENTHS,
  AnthropometryValidationError,
  type AnthropometrySiteInput,
} from "./anthropometry.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SITE_ORDER = new Map<string, number>(
  ANTHROPOMETRY_SITE_CODES.map((siteCode, index) => [siteCode, index]),
);
const SITE_SET = new Set<string>(ANTHROPOMETRY_SITE_CODES);

export function optionalUuid(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new AnthropometryValidationError("VALIDATION_ERROR", `${field} must be a UUID`);
  }
  return value;
}

export function normalizeNotes(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new AnthropometryValidationError("VALIDATION_ERROR", "notes must be text");
  }
  const notes = value.trim();
  if (notes.length > 500) {
    throw new AnthropometryValidationError(
      "VALIDATION_ERROR",
      "notes must be 500 characters or fewer",
    );
  }
  return notes || null;
}

export function normalizeSites(value: unknown): AnthropometrySiteInput[] {
  if (!Array.isArray(value)) {
    throw new AnthropometryValidationError("VALIDATION_ERROR", "sites must be an array");
  }

  const seen = new Set<string>();
  const sites: AnthropometrySiteInput[] = value.map((raw) => {
    if (!raw || typeof raw !== "object") {
      throw new AnthropometryValidationError("VALIDATION_ERROR", "Each site must be an object");
    }
    const item = raw as Record<string, unknown>;
    const siteCode = item.site_code;
    if (typeof siteCode !== "string" || !SITE_SET.has(siteCode)) {
      throw new AnthropometryValidationError(
        "UNKNOWN_SITE",
        `Unknown anthropometric site: ${String(siteCode)}`,
        typeof siteCode === "string" ? siteCode : null,
      );
    }
    if (seen.has(siteCode)) {
      throw new AnthropometryValidationError(
        "DUPLICATE_SITE",
        `Duplicate anthropometric site: ${siteCode}`,
        siteCode,
      );
    }
    seen.add(siteCode);

    if (!Array.isArray(item.readings_cm) || item.readings_cm.length > 3) {
      throw new AnthropometryValidationError(
        "INVALID_READING_COUNT",
        "Draft sites may contain zero to three readings",
        siteCode,
      );
    }

    const readingsCm = item.readings_cm.map((rawReading) => {
      if (typeof rawReading !== "number" || !Number.isFinite(rawReading)) {
        throw new AnthropometryValidationError(
          "READING_OUT_OF_RANGE",
          "Readings must be finite numbers between 5.0 and 300.0 cm",
          siteCode,
        );
      }
      const scaled = rawReading * 10;
      const tenths = Math.round(scaled);
      if (Math.abs(scaled - tenths) > 1e-8) {
        throw new AnthropometryValidationError(
          "INVALID_READING_PRECISION",
          "Readings must be recorded to one decimal place",
          siteCode,
        );
      }
      if (
        tenths < ANTHROPOMETRY_MIN_READING_TENTHS ||
        tenths > ANTHROPOMETRY_MAX_READING_TENTHS
      ) {
        throw new AnthropometryValidationError(
          "READING_OUT_OF_RANGE",
          "Readings must be between 5.0 and 300.0 cm",
          siteCode,
        );
      }
      return tenths / 10;
    });

    return { site_code: siteCode, readings_cm: readingsCm };
  });

  return sites.sort(
    (left, right) => SITE_ORDER.get(left.site_code)! - SITE_ORDER.get(right.site_code)!,
  );
}

export function flattenReadings(sites: readonly AnthropometrySiteInput[]) {
  return sites.flatMap((site) =>
    site.readings_cm.map((valueCm, index) => ({
      site_code: site.site_code,
      reading_number: index + 1,
      value_cm: valueCm,
    }))
  );
}

export async function sha256Canonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function parseMeasuredAt(value: unknown, required: boolean): Date | null {
  if (value == null || value === "") {
    if (required) {
      throw new AnthropometryValidationError(
        "VALIDATION_ERROR",
        "measured_at is required when finalizing a session",
      );
    }
    return null;
  }
  if (typeof value !== "string") {
    throw new AnthropometryValidationError(
      "VALIDATION_ERROR",
      "measured_at must be a valid ISO timestamp",
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AnthropometryValidationError(
      "VALIDATION_ERROR",
      "measured_at must be a valid ISO timestamp",
    );
  }
  return date;
}
