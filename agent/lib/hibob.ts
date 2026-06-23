import { setJSON, getJSON } from "./redis.js";

export interface WhosOutItem {
  requestId?: number;
  employeeId?: string;
  employeeDisplayName?: string;
  policyType?: string;
  policyTypeDisplayName?: string;
  status?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  startPortion?: "all_day" | "morning" | "afternoon";
  endPortion?: "all_day" | "morning" | "afternoon";
  dayPortion?: "morning" | "afternoon";
  date?: string;
  hoursOnDate?: number;
  dailyHours?: number;
}

const WHOSOUT_CACHE_TTL = 60 * 60;

/**
 * HiBob es opcional. Si no hay credenciales del service user, el agente
 * ignora el time-off y carga la semana completa (igual respeta feriados AR y finde).
 */
export function isHibobConfigured(): boolean {
  return Boolean(process.env.HIBOB_SERVICE_USER_ID && process.env.HIBOB_SERVICE_USER_TOKEN);
}

function authHeader(): string {
  const id = process.env.HIBOB_SERVICE_USER_ID;
  const token = process.env.HIBOB_SERVICE_USER_TOKEN;
  if (!id || !token) {
    throw new Error("HIBOB_SERVICE_USER_ID and HIBOB_SERVICE_USER_TOKEN are required.");
  }
  return `Basic ${Buffer.from(`${id}:${token}`).toString("base64")}`;
}

const BASE = "https://api.hibob.com/v1";

export async function getWhosOut(fromIso: string, toIso: string): Promise<WhosOutItem[]> {
  const cacheKey = `hibob:whosout:${fromIso}:${toIso}`;
  const cached = await getJSON<WhosOutItem[]>(cacheKey);
  if (cached) return cached;

  const url = new URL(`${BASE}/timeoff/whosout`);
  url.searchParams.set("from", fromIso);
  url.searchParams.set("to", toIso);
  url.searchParams.set("includePending", "false");
  url.searchParams.set("includeWorkingRequests", "false");

  const res = await fetch(url, {
    headers: { authorization: authHeader() },
  });
  if (!res.ok) {
    throw new Error(`HiBob whosout failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as unknown;
  const items = Array.isArray(body) ? (body as WhosOutItem[]) : [];
  await setJSON(cacheKey, items, WHOSOUT_CACHE_TTL);
  return items;
}

export interface HibobEmployee {
  id: string;
  displayName?: string;
  email?: string;
}

export async function getEmployeeByEmail(email: string): Promise<HibobEmployee | null> {
  const res = await fetch(`${BASE}/people/search`, {
    method: "POST",
    headers: {
      authorization: authHeader(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fields: ["displayName", "email"],
      filters: { email: { values: [email] } },
    }),
  });
  if (!res.ok) {
    throw new Error(`HiBob people search failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { employees?: HibobEmployee[] };
  return data.employees?.[0] ?? null;
}

export function filterWhosOutForEmployee(items: WhosOutItem[], employeeId: string): WhosOutItem[] {
  return items.filter((it) => it.employeeId === employeeId);
}

export function dayWorkFraction(item: WhosOutItem, dateIso: string): number {
  if (!item || item.status !== "Approved") return 1;
  const type = item.type;
  if (type === "days") {
    const start = item.startDate ?? "";
    const end = item.endDate ?? start;
    if (!start || !end) return 1;
    if (dateIso < start || dateIso > end) return 1;
    const isStart = dateIso === start;
    const isEnd = dateIso === end;
    if (!isStart && !isEnd) return 0; // dia intermedio: full off
    let off: number;
    if (isStart && isEnd) {
      // mismo dia: combinar porciones morning/afternoon
      const morningOff = item.startPortion === "morning" || item.endPortion === "morning";
      const afternoonOff = item.startPortion === "afternoon" || item.endPortion === "afternoon";
      if (
        item.startPortion === "all_day" ||
        item.endPortion === "all_day" ||
        (morningOff && afternoonOff)
      ) {
        off = 1;
      } else if (morningOff || afternoonOff) {
        off = 0.5;
      } else {
        off = 1; // sin porciones explicitas => full dia
      }
    } else if (isStart) {
      off = item.startPortion === "all_day" || !item.startPortion ? 1 : 0.5;
    } else {
      off = item.endPortion === "all_day" || !item.endPortion ? 1 : 0.5;
    }
    return 1 - off;
  }
  if (type === "portionOnRange") {
    if (dateIso < (item.startDate ?? "") || dateIso > (item.endDate ?? "")) return 1;
    const portion = item.dayPortion === "morning" ? 0.5 : item.dayPortion === "afternoon" ? 0.5 : 0;
    return 1 - portion;
  }
  if (type === "hoursOnRange") {
    if (dateIso < (item.startDate ?? "") || dateIso > (item.endDate ?? "")) return 1;
    const hoursOff = item.dailyHours ?? 0;
    return Math.max(0, 1 - hoursOff / 9);
  }
  if (type === "hours") {
    if (item.date !== dateIso) return 1;
    const hoursOff = item.hoursOnDate ?? 0;
    return Math.max(0, 1 - hoursOff / 9);
  }
  return 1;
}
