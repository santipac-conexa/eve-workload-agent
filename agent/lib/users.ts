import { getJSON, setJSON } from "./redis.js";

export interface IssueAllocation {
  issueKey: string;
  hours: number;
}

export interface DayPlan {
  issues: IssueAllocation[];
}

export interface UserConfig {
  slackUserId: string;
  slackChannelId: string;
  slackUserEmail: string;
  jiraBase: string;
  jiraEmail: string;
  jiraApiToken: string;
  /** Opcional: solo presente si HiBob está configurado y se resolvió desde el email. */
  hibobEmployeeId?: string;
  weeklyPlan: {
    mon: DayPlan;
    tue: DayPlan;
    wed: DayPlan;
    thu: DayPlan;
    fri: DayPlan;
  };
}

export type Weekday = keyof UserConfig["weeklyPlan"];

export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

const USER_KEY = (slackUserId: string) => `user:${slackUserId}`;
const USER_INDEX_KEY = "users:index";

function userKey(slackUserId: string): string {
  return USER_KEY(slackUserId);
}

export async function getUserConfig(slackUserId: string): Promise<UserConfig | null> {
  return getJSON<UserConfig>(userKey(slackUserId));
}

export async function setUserConfig(config: UserConfig): Promise<void> {
  await setJSON(userKey(config.slackUserId), config);
  const index = (await getJSON<string[]>(USER_INDEX_KEY)) ?? [];
  if (!index.includes(config.slackUserId)) {
    index.push(config.slackUserId);
    await setJSON(USER_INDEX_KEY, index);
  }
}

export async function upsertSlackInfo(args: {
  slackUserId: string;
  slackChannelId: string;
  slackUserEmail?: string;
}): Promise<UserConfig> {
  const existing = await getUserConfig(args.slackUserId);
  const updated: UserConfig = {
    slackUserId: args.slackUserId,
    slackChannelId: args.slackChannelId,
    slackUserEmail: args.slackUserEmail ?? existing?.slackUserEmail ?? "",
    jiraBase: existing?.jiraBase ?? "",
    jiraEmail: existing?.jiraEmail ?? "",
    jiraApiToken: existing?.jiraApiToken ?? "",
    hibobEmployeeId: existing?.hibobEmployeeId,
    weeklyPlan: existing?.weeklyPlan ?? {
      mon: { issues: [] },
      tue: { issues: [] },
      wed: { issues: [] },
      thu: { issues: [] },
      fri: { issues: [] },
    },
  };
  await setUserConfig(updated);
  return updated;
}

export async function listUserIds(): Promise<string[]> {
  return (await getJSON<string[]>(USER_INDEX_KEY)) ?? [];
}

export async function listUserConfigs(): Promise<UserConfig[]> {
  const ids = await listUserIds();
  const configs = await Promise.all(ids.map(getUserConfig));
  return configs.filter((c): c is UserConfig => c !== null);
}

/**
 * Clave canónica del usuario en Redis: el id crudo de Slack, que es el último
 * segmento del principalId (`slack:[team:]U123` → `U123`). Normaliza para que
 * `onDirectMessage` (que usa el userId crudo) y las tools (que reciben el
 * principalId) coincidan SIEMPRE en la misma clave, sin importar si el
 * principalId trae teamId o no. Sin esto, la config se guarda y se lee bajo
 * claves distintas y "se pierde" entre conversaciones.
 */
export function slackUserIdFromPrincipal(principalId: string | null | undefined): string | null {
  if (!principalId) return null;
  const id = principalId.split(":").pop();
  return id && id.length > 0 ? id : null;
}

/** Contexto mínimo del que una tool extrae el principal de Slack de la sesión. */
export interface SlackPrincipalContext {
  session: { auth?: { current?: { principalId?: string | null } | null } | null };
}

/**
 * Resuelve el `slackUserId` de una tool: usa el explícito (p. ej. el que pasa el
 * schedule) o, si no, el derivado del principal de la sesión. Centraliza el patrón
 * `input.slackUserId || slackUserIdFromPrincipal(...)` repetido en todas las tools.
 */
export function resolveSlackUserId(
  ctx: SlackPrincipalContext,
  explicit?: string | null,
): string | null {
  return explicit || slackUserIdFromPrincipal(ctx.session.auth?.current?.principalId);
}

export function weekdayForDate(date: Date): Weekday | null {
  // date is local AR time; JS getDay() returns 0=Sunday..6=Saturday
  const day = date.getDay();
  switch (day) {
    case 1:
      return "mon";
    case 2:
      return "tue";
    case 3:
      return "wed";
    case 4:
      return "thu";
    case 5:
      return "fri";
    default:
      return null;
  }
}
