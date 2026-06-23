import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

import { getUserConfig, resolveSlackUserId, setUserConfig, type UserConfig } from "../lib/users.js";

const issueAllocationSchema = z.object({
  issueKey: z.string().min(1),
  hours: z.number().positive(),
});

const dayPlanSchema = z.object({ issues: z.array(issueAllocationSchema) });

function emptyPlan(): UserConfig["weeklyPlan"] {
  return {
    mon: { issues: [] },
    tue: { issues: [] },
    wed: { issues: [] },
    thu: { issues: [] },
    fri: { issues: [] },
  };
}

const schema = z.object({
  jiraBase: z
    .string()
    .url()
    .describe("Base URL del Jira Cloud, ej https://conexa-tech.atlassian.net (sin /browse/...)"),
  jiraEmail: z
    .string()
    .email()
    .optional()
    .describe(
      "Email de la cuenta de Jira Cloud. Slack normalmente NO lo provee, así que pediselo al usuario y pasalo acá. Si se omite, se intenta usar el email capturado de Slack (puede no existir).",
    ),
  jiraApiToken: z
    .string()
    .min(1)
    .describe(
      "API Token de Jira Cloud (generar en https://id.atlassian.com/manage-profile/security/api-tokens)",
    ),
  weeklyPlan: z
    .object({
      mon: dayPlanSchema,
      tue: dayPlanSchema,
      wed: dayPlanSchema,
      thu: dayPlanSchema,
      fri: dayPlanSchema,
    })
    .optional()
    .describe(
      "Opcional. Para el caso comun (mismas horas e issue todos los dias) usá set_uniform_plan en vez de armar este objeto a mano.",
    ),
});

export default defineTool({
  description:
    "Crea o actualiza las credenciales de Jira del usuario (base, email, API Token). El plan semanal es opcional acá: para configurarlo facil, usá set_uniform_plan despues. Requiere aprobacion humana porque guarda credenciales.",
  inputSchema: schema,
  needsApproval: always(),
  async execute(input, ctx) {
    const slackUserId = resolveSlackUserId(ctx);
    if (!slackUserId) {
      return { ok: false, error: "No se pudo identificar al usuario de Slack." };
    }

    const existing = await getUserConfig(slackUserId);

    // El email de Jira = email de Slack (mismo usuario). Se autodetecta; solo se pide si falta.
    const jiraEmail = input.jiraEmail || existing?.slackUserEmail || existing?.jiraEmail;
    if (!jiraEmail) {
      return {
        ok: false,
        error:
          "No pude detectar tu email automáticamente desde Slack. Pasámelo explícitamente (el de tu cuenta de Jira).",
      };
    }

    const config: UserConfig = {
      slackUserId,
      slackChannelId: existing?.slackChannelId ?? "",
      slackUserEmail: existing?.slackUserEmail ?? "",
      jiraBase: input.jiraBase.replace(/\/$/, ""),
      jiraEmail,
      jiraApiToken: input.jiraApiToken,
      hibobEmployeeId: existing?.hibobEmployeeId,
      weeklyPlan: input.weeklyPlan ?? existing?.weeklyPlan ?? emptyPlan(),
    };

    await setUserConfig(config);
    return {
      ok: true,
      slackUserId,
      jiraBase: config.jiraBase,
      jiraEmail: config.jiraEmail,
      days: Object.keys(config.weeklyPlan),
    };
  },
});
