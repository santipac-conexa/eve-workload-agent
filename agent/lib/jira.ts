import { toISODate } from "./holidays.js";

export interface JiraCredentials {
  jiraBase: string;
  email: string;
  apiToken: string;
}

export interface AddWorklogInput extends JiraCredentials {
  issueKey: string;
  started: string;
  timeSpent: string;
}

export interface Worklog {
  id: string;
  author?: {
    accountId?: string;
    emailAddress?: string;
    displayName?: string;
  };
  started: string;
  timeSpent?: string;
  timeSpentSeconds?: number;
}

export interface AddWorklogResult {
  ok: boolean;
  status: number;
  worklogId?: string;
  error?: string;
  skipped?: boolean;
}

const API = "/rest/api/3";

/** Mapea la configuración del usuario a las credenciales que usa la API de Jira. */
export function credentialsFromConfig(config: {
  jiraBase: string;
  jiraEmail: string;
  jiraApiToken: string;
}): JiraCredentials {
  return { jiraBase: config.jiraBase, email: config.jiraEmail, apiToken: config.jiraApiToken };
}

function authHeaders({ email, apiToken }: JiraCredentials): Record<string, string> {
  const encoded = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return {
    authorization: `Basic ${encoded}`,
    "content-type": "application/json",
  };
}

export async function verifyToken(
  creds: JiraCredentials,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${creds.jiraBase}${API}/myself`, {
    headers: authHeaders(creds),
  });
  if (!res.ok) {
    return { ok: false, error: `${res.status} ${res.statusText}` };
  }
  return { ok: true };
}

export async function getWorklogs(creds: JiraCredentials, issueKey: string): Promise<Worklog[]> {
  const res = await fetch(`${creds.jiraBase}${API}/issue/${encodeURIComponent(issueKey)}/worklog`, {
    headers: authHeaders(creds),
  });
  if (!res.ok) {
    throw new Error(`getWorklogs failed for ${issueKey}: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { worklogs?: Worklog[] };
  return data.worklogs ?? [];
}

export function worklogExistsOnDate(worklogs: Worklog[], dateIso: string): boolean {
  return worklogs.some((w) => w.started?.startsWith(dateIso));
}

export interface MyWorklog {
  issueKey: string;
  date: string;
  timeSpent?: string;
  worklogId: string;
}

/**
 * Worklogs cargados por el propio usuario (filtrado por email del autor) en un
 * rango de fechas, recorriendo los issues que le pasen. Da visibilidad al agente
 * sobre qué ya está cargado en Jira, para no re-cargar ni inventar respuestas.
 */
export async function getMyWorklogs(
  creds: JiraCredentials,
  issueKeys: string[],
  fromIso: string,
  toIso: string,
): Promise<MyWorklog[]> {
  const distinct = [...new Set(issueKeys)];
  const perIssue = await Promise.all(
    distinct.map(async (issueKey) => {
      const worklogs = await getWorklogs(creds, issueKey);
      const items: MyWorklog[] = [];
      for (const w of worklogs) {
        const date = w.started?.slice(0, 10);
        if (!date || date < fromIso || date > toIso) continue;
        // Si Jira expone el email del autor, nos quedamos solo con los del usuario.
        if (w.author?.emailAddress && creds.email && w.author.emailAddress !== creds.email) {
          continue;
        }
        items.push({ issueKey, date, timeSpent: w.timeSpent, worklogId: w.id });
      }
      return items;
    }),
  );
  const out = perIssue.flat();
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

export async function addWorklog(input: AddWorklogInput): Promise<AddWorklogResult> {
  const creds: JiraCredentials = {
    jiraBase: input.jiraBase,
    email: input.email,
    apiToken: input.apiToken,
  };
  const existing = await getWorklogs(creds, input.issueKey);
  if (worklogExistsOnDate(existing, toISODate(new Date(input.started)))) {
    return { ok: true, skipped: true, status: 200 };
  }

  const res = await fetch(
    `${input.jiraBase}${API}/issue/${encodeURIComponent(input.issueKey)}/worklog`,
    {
      method: "POST",
      headers: authHeaders(creds),
      body: JSON.stringify({
        started: input.started,
        timeSpent: input.timeSpent,
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: `${res.status} ${res.statusText} ${text}`.trim(),
    };
  }
  const created = (await res.json()) as { id?: string };
  return { ok: true, status: res.status, worklogId: created.id };
}

export function toStarted(date: Date, addHours: number): string {
  const d = new Date(date.getTime() + addHours * 3600_000);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}:00.000-0300`;
}
