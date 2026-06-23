import { defineTool } from "eve/tools";
import { z } from "zod";

import { credentialsFromConfig, getMyWorklogs } from "../lib/jira.js";
import { getUserConfig, resolveSlackUserId, WEEKDAYS } from "../lib/users.js";
import { currentWeekRangeIso } from "../lib/workdays.js";

const schema = z.object({
  from: z.string().optional().describe("Fecha desde (YYYY-MM-DD). Default: lunes de esta semana."),
  to: z.string().optional().describe("Fecha hasta (YYYY-MM-DD). Default: viernes de esta semana."),
  slackUserId: z
    .string()
    .optional()
    .describe("ID de usuario de Slack objetivo. Omitir cuando el usuario interactua por DM."),
});

export default defineTool({
  description:
    "Lista los worklogs que el usuario YA cargo en Jira (filtrado por su email) para los issues de su plan, en un rango (default semana actual L-V). Tool de lectura: usala para saber que esta cargado antes de responder o cargar. No escribe en Jira.",
  inputSchema: schema,
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

    const week = currentWeekRangeIso();
    const fromIso = input.from ?? week.fromIso;
    const toIso = input.to ?? week.toIso;

    const issueKeys = [
      ...new Set(WEEKDAYS.flatMap((d) => user.weeklyPlan[d].issues.map((i) => i.issueKey))),
    ];
    if (issueKeys.length === 0) {
      return { ok: true, from: fromIso, to: toIso, items: [], note: "El plan semanal no tiene issues." };
    }

    const items = await getMyWorklogs(credentialsFromConfig(user), issueKeys, fromIso, toIso);
    return { ok: true, from: fromIso, to: toIso, items };
  },
});
