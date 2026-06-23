import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  getUserConfig,
  resolveSlackUserId,
  setUserConfig,
  WEEKDAYS,
  type UserConfig,
  type Weekday,
} from "../lib/users.js";

const issueSchema = z.object({
  issueKey: z.string().min(1),
  hours: z.number().positive(),
});

const schema = z.object({
  issues: z
    .array(issueSchema)
    .min(1)
    .describe(
      "Set de issues+horas que se aplica a CADA dia elegido. Ej: [{issueKey:'IE-728', hours:9}]. Deberia sumar 9h por dia.",
    ),
  days: z
    .array(z.enum(["mon", "tue", "wed", "thu", "fri"]))
    .optional()
    .describe("Dias a configurar. Default: lunes a viernes."),
  slackUserId: z
    .string()
    .optional()
    .describe("ID de usuario de Slack objetivo. Omitir cuando el usuario interactua por DM."),
});

export default defineTool({
  description:
    "Configura el plan semanal UNIFORME: aplica el mismo set de issues+horas a todos los dias indicados (default L-V). Usala para el caso comun 'tantas horas en tal issue todos los dias' en vez de armar el plan dia por dia. Requiere que el usuario ya tenga credenciales (set_user_config). No escribe en Jira.",
  inputSchema: schema,
  async execute(input, ctx) {
    const slackUserId = resolveSlackUserId(ctx, input.slackUserId);
    if (!slackUserId) {
      return { ok: false, error: "No se pudo identificar al usuario de Slack." };
    }

    const existing = await getUserConfig(slackUserId);
    if (!existing) {
      return {
        ok: false,
        error: "No hay configuracion. Corré set_user_config primero (jiraBase, jiraEmail, jiraApiToken).",
      };
    }

    const days: Weekday[] = input.days?.length ? (input.days as Weekday[]) : [...WEEKDAYS];
    const issues = input.issues.map((i) => ({ issueKey: i.issueKey, hours: i.hours }));

    const weeklyPlan = { ...existing.weeklyPlan };
    for (const d of days) {
      weeklyPlan[d] = { issues: issues.map((i) => ({ ...i })) };
    }

    const updated: UserConfig = { ...existing, weeklyPlan };
    await setUserConfig(updated);

    const totalPerDay = issues.reduce((s, i) => s + i.hours, 0);
    return { ok: true, days, totalPerDay, issues };
  },
});
