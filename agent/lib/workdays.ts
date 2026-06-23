import {
  dayWorkFraction,
  filterWhosOutForEmployee,
  getWhosOut,
  isHibobConfigured,
  type WhosOutItem,
} from "./hibob.js";
import { getHolidays, toISODate } from "./holidays.js";
import { toStarted } from "./jira.js";
import { type UserConfig, weekdayForDate } from "./users.js";

export interface WorklogEntry {
  date: string;
  issueKey: string;
  hours: number;
  started: string;
  reason?: string;
}

export interface BuildWeekResult {
  entries: WorklogEntry[];
  skippedDays: { date: string; reason: string }[];
  summary: string;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/** Rango ISO (lunes a viernes) de la semana actual. */
export function currentWeekRangeIso(): { fromIso: string; toIso: string } {
  const start = startOfWeek(new Date());
  const end = new Date(start.getTime() + 4 * 24 * 3600_000);
  return { fromIso: toISODate(start), toIso: toISODate(end) };
}

export async function buildWeek(user: UserConfig, weekStart?: Date): Promise<BuildWeekResult> {
  const start = weekStart ?? startOfWeek(new Date());
  const end = new Date(start.getTime() + 4 * 24 * 3600_000);

  const fromIso = toISODate(start);
  const toIso = toISODate(end);

  const years = new Set([start.getFullYear(), end.getFullYear()]);
  const holidaysByYear = await Promise.all([...years].map((y) => getHolidays(y)));
  const holidayDates = new Set(holidaysByYear.flat().map((h) => h.fecha));

  // HiBob es opcional: sin credenciales o sin employeeId, no se descuenta time-off.
  let userOff: WhosOutItem[] = [];
  if (isHibobConfigured() && user.hibobEmployeeId) {
    const whosout = await getWhosOut(fromIso, toIso);
    userOff = filterWhosOutForEmployee(whosout, user.hibobEmployeeId);
  }

  const entries: WorklogEntry[] = [];
  const skipped: { date: string; reason: string }[] = [];

  for (let i = 0; i < 5; i++) {
    const date = new Date(start.getTime() + i * 24 * 3600_000);
    const dateIso = toISODate(date);
    const wd = weekdayForDate(date);
    if (!wd) {
      skipped.push({ date: dateIso, reason: "Fin de semana" });
      continue;
    }

    if (holidayDates.has(dateIso)) {
      skipped.push({ date: dateIso, reason: "Feriado AR" });
      continue;
    }

    const offItems = userOff.filter((it) => coversDate(it, dateIso));
    const fraction = comboFraction(offItems, dateIso);
    if (fraction <= 0) {
      skipped.push({
        date: dateIso,
        reason: "Time off completo (HiBob)",
      });
      continue;
    }

    const dayPlan = user.weeklyPlan[wd];
    if (!dayPlan?.issues?.length) {
      skipped.push({ date: dateIso, reason: "Sin plan configurado" });
      continue;
    }

    let hoursOffset = 9;
    for (const item of dayPlan.issues) {
      const scaledHours = Math.round(item.hours * fraction * 100) / 100;
      if (scaledHours <= 0) continue;
      const startedDate = new Date(date);
      entries.push({
        date: dateIso,
        issueKey: item.issueKey,
        hours: scaledHours,
        started: toStarted(startedDate, hoursOffset),
      });
      hoursOffset += scaledHours;
    }

    if (fraction < 1) {
      const last = entries[entries.length - 1];
      if (last) last.reason = `Time off parcial (fracción ${fraction})`;
    }
  }

  const summary = renderSummary(entries, skipped);
  return { entries, skippedDays: skipped, summary };
}

export type WeekScope = "week" | "today";

/**
 * buildWeek acotado por scope. "today" deja solo la entrada del día actual
 * (misma base de fecha que buildWeek). "week" devuelve la semana completa.
 * La carga es idempotente, así que "lo que falta" se resuelve con scope "week".
 */
export async function buildWeekScoped(
  user: UserConfig,
  scope: WeekScope = "week",
  weekStart?: Date,
): Promise<BuildWeekResult> {
  const full = await buildWeek(user, weekStart);
  if (scope !== "today") return full;

  const todayIso = toISODate(new Date());
  const entries = full.entries.filter((e) => e.date === todayIso);
  const skippedDays = full.skippedDays.filter((s) => s.date === todayIso);
  return { entries, skippedDays, summary: renderSummary(entries, skippedDays) };
}

function coversDate(item: WhosOutItem, dateIso: string): boolean {
  if (item.type === "hours") return item.date === dateIso;
  const start = item.startDate ?? "";
  const end = item.endDate ?? start;
  return dateIso >= start && dateIso <= end;
}

function comboFraction(items: WhosOutItem[], dateIso: string): number {
  if (items.length === 0) return 1;
  let fraction = 1;
  for (const it of items) {
    fraction = Math.min(fraction, dayWorkFraction(it, dateIso));
  }
  return Math.round(fraction * 100) / 100;
}

function renderSummary(
  entries: WorklogEntry[],
  skipped: { date: string; reason: string }[],
): string {
  if (entries.length === 0 && skipped.length === 0) {
    return "No hay días hábiles para cargar esta semana.";
  }
  const lines: string[] = [];
  if (entries.length > 0) {
    lines.push("Cargas a aprobar:");
    const byDate = new Map<string, WorklogEntry[]>();
    for (const e of entries) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date)!.push(e);
    }
    for (const [date, items] of byDate) {
      const total = items.reduce((s, i) => s + i.hours, 0);
      const detail = items.map((i) => `${i.hours}h → ${i.issueKey}`).join(", ");
      lines.push(`- ${date} (${total}h): ${detail}`);
    }
  }
  if (skipped.length > 0) {
    lines.push("Días omitidos:");
    for (const s of skipped) lines.push(`- ${s.date}: ${s.reason}`);
  }
  return lines.join("\n");
}
