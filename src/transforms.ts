export const TRANSFORM_NAMES = [
  "trim",
  "lowercase",
  "uppercase",
  "email",
  "phone",
  "date",
  "number",
  "domain",
  "split_first",
  "split_last",
] as const;

export type TransformName = (typeof TRANSFORM_NAMES)[number];

export type TransformResult = { ok: true; value: string } | { ok: false; message: string };

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export function applyTransform(name: TransformName, input: string): TransformResult {
  switch (name) {
    case "trim":
      return { ok: true, value: input.trim() };
    case "lowercase":
      return { ok: true, value: input.toLowerCase() };
    case "uppercase":
      return { ok: true, value: input.toUpperCase() };
    case "email":
      return normalizeEmail(input);
    case "phone":
      return normalizePhone(input);
    case "date":
      return normalizeDate(input);
    case "number":
      return normalizeNumber(input);
    case "domain":
      return normalizeDomain(input);
    case "split_first":
      return { ok: true, value: splitName(input).first };
    case "split_last":
      return { ok: true, value: splitName(input).last };
    default: {
      const exhaustive: never = name;
      return { ok: false, message: `unknown transform ${exhaustive}` };
    }
  }
}

export function lookupValueMap(map: Record<string, string>, value: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(map, value)) return map[value];
  const lowered = value.toLowerCase();
  for (const [key, mapped] of Object.entries(map)) {
    if (key.toLowerCase() === lowered) return mapped;
  }
  return undefined;
}

function normalizeEmail(input: string): TransformResult {
  const value = input.trim().toLowerCase();
  if (!value) return { ok: true, value: "" };
  if (!EMAIL.test(value)) return { ok: false, message: `invalid email "${input.trim()}"` };
  return { ok: true, value };
}

function normalizePhone(input: string): TransformResult {
  const original = input.trim();
  if (!original) return { ok: true, value: "" };
  const withoutExtension = original.replace(/\s*(?:ext\.?|extension|x)\s*\d+\s*$/i, "");
  const hasPlus = withoutExtension.trim().startsWith("+");
  const digits = withoutExtension.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    return { ok: false, message: `invalid phone "${original}"` };
  }
  if (hasPlus) return { ok: true, value: `+${digits}` };
  if (digits.length === 11 && digits.startsWith("1")) return { ok: true, value: `+${digits}` };
  if (digits.length === 10) return { ok: true, value: `+1${digits}` };
  return { ok: true, value: `+${digits}` };
}

function normalizeDomain(input: string): TransformResult {
  let value = input.trim().toLowerCase();
  if (!value) return { ok: true, value: "" };
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.split("/")[0]?.split("?")[0]?.split("#")[0] ?? "";
  value = value.replace(/\.$/, "");
  if (!DOMAIN.test(value)) return { ok: false, message: `invalid domain "${input.trim()}"` };
  return { ok: true, value };
}

function normalizeNumber(input: string): TransformResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: "" };
  const value = trimmed.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(value)) return { ok: false, message: `invalid number "${trimmed}"` };
  return { ok: true, value: String(Number(value)) };
}

function normalizeDate(input: string): TransformResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: "" };
  const parsed = parseDateParts(trimmed);
  if (!parsed) return { ok: false, message: `invalid date "${trimmed}"` };
  const timestamp = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const check = new Date(timestamp);
  if (
    check.getUTCFullYear() !== parsed.year ||
    check.getUTCMonth() !== parsed.month - 1 ||
    check.getUTCDate() !== parsed.day
  ) {
    return { ok: false, message: `invalid date "${trimmed}"` };
  }
  return { ok: true, value: String(timestamp) };
}

function parseDateParts(value: string): { year: number; month: number; day: number } | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (us) return { year: Number(us[3]), month: Number(us[1]), day: Number(us[2]) };
  const named = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (!month) return null;
    return { year: Number(named[3]), month, day: Number(named[1]) };
  }
  return null;
}

function splitName(input: string): { first: string; last: string } {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}
