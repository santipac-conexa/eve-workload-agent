import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

import { addWorklog, credentialsFromConfig } from "../lib/jira.js";
import { getUserConfig, resolveSlackUserId } from "../lib/users.js";
import { buildWeekScoped } from "../lib/workdays.js";

const schema = z.object({
  scope: z
    .enum(["week", "today"])
    .optional()
    .describe(
      "'week' = carga toda la semana L-V (default). 'today' = solo hoy. Es idempotente: omite los dias ya cargados, asi que 'lo que falta' = scope 'week'.",
    ),
  slackUserId: z
    .string()
    .optional()
    .describe("ID de usuario de Slack objetivo. Omitir cuando el usuario interactua por DM."),
});

export default defineTool({
  description:
    "Carga en Jira los worklogs de la semana ('week') o solo de hoy ('today') en UNA sola aprobacion. Idempotente: omite los dias que ya tienen worklog. Antes de llamarla, mostra el preview_week_load para que el usuario sepa que se va a cargar. Requiere aprobacion humana.",
  inputSchema: schema,
  needsApproval: always(),
  async execute(input, ctx) {
    const slackUserId = resolveSlackUserId(ctx, input.slackUserId);
    if (!slackUserId) {
      return { ok: false, error: "No se pudo identificar al usuario de Slack." };
    }
    const user = await getUserConfig(slackUserId);
    if (!user) {
      return { ok: false, error: "No hay configuracion. Usa set_user_config primero." };
    }
    if (!user.jiraApiToken) {
      return { ok: false, error: "Falta el API Token de Jira. Usa set_user_config." };
    }

    const { entries } = await buildWeekScoped(user, input.scope ?? "week");
    if (entries.length === 0) {
      return {
        ok: true,
        loaded: [],
        skippedExisting: [],
        failed: [],
        summary: "No hay entradas para cargar en ese rango (finde/feriado/sin plan).",
      };
    }

    const creds = credentialsFromConfig(user);
    const loaded: { date: string; issueKey: string; hours: number; worklogId?: string }[] = [];
    const skippedExisting: { date: string; issueKey: string }[] = [];
    const failed: { date: string; issueKey: string; error?: string }[] = [];

    const results = await Promise.all(
      entries.map(async (e) => ({
        e,
        res: await addWorklog({ ...creds, issueKey: e.issueKey, started: e.started, timeSpent: `${e.hours}h` }),
      })),
    );
    for (const { e, res } of results) {
      if (!res.ok) {
        failed.push({ date: e.date, issueKey: e.issueKey, error: res.error });
      } else if (res.skipped) {
        skippedExisting.push({ date: e.date, issueKey: e.issueKey });
      } else {
        loaded.push({ date: e.date, issueKey: e.issueKey, hours: e.hours, worklogId: res.worklogId });
      }
    }

    const parts: string[] = [];
    if (loaded.length) parts.push(`Cargados ${loaded.length}: ${loaded.map((l) => `${l.date} ${l.hours}h ${l.issueKey}`).join(", ")}.`);
    if (skippedExisting.length) parts.push(`Ya estaban cargados ${skippedExisting.length}: ${skippedExisting.map((s) => s.date).join(", ")}.`);
    if (failed.length) parts.push(`Fallaron ${failed.length}: ${failed.map((f) => `${f.date} (${f.error})`).join(", ")}.`);

    return {
      ok: failed.length === 0,
      loaded,
      skippedExisting,
      failed,
      summary: parts.join(" ") || "Nada para cargar.",
    };
  },
});
