import { getJSON, setJSON } from "./redis.js";

export interface Holiday {
  fecha: string;
  tipo: string;
  nombre: string;
}

const FERIADOS_CACHE_TTL = 60 * 60 * 24 * 30;

const cacheKey = (year: number) => `feriados:AR:${year}`;

export async function getHolidays(year: number): Promise<Holiday[]> {
  const cached = await getJSON<Holiday[]>(cacheKey(year));
  if (cached && Array.isArray(cached)) return cached;

  const res = await fetch(`https://api.argentinadatos.com/v1/feriados/${year}`);
  if (!res.ok) {
    throw new Error(`argentinadatos fetch failed: ${res.status} ${res.statusText}`);
  }
  const holidays = (await res.json()) as Holiday[];
  await setJSON(cacheKey(year), holidays, FERIADOS_CACHE_TTL);
  return holidays;
}

export async function isHoliday(date: Date): Promise<boolean> {
  const iso = toISODate(date);
  const holidays = await getHolidays(date.getUTCFullYear());
  return holidays.some((h) => h.fecha === iso);
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
