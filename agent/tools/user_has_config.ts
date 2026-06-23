import { defineTool } from "eve/tools";
import { z } from "zod";

import { getUserConfig, resolveSlackUserId, WEEKDAYS } from "../lib/users.js";

export default defineTool({
  description:
    "Chequeo rapido del estado de configuracion del usuario. Devuelve { configured, ready, missing }. Tool de lectura de output minimo: llamala al inicio de la conversacion para NO hablar de configuracion si el usuario ya esta listo. Solo pedí datos si 'ready' es false, y solo lo que diga 'missing'.",
  inputSchema: z.object({
    slackUserId: z
      .string()
      .optional()
      .describe("ID de usuario de Slack objetivo. Omitir cuando el usuario interactua por DM."),
  }),
  async execute(input, ctx) {
    const slackUserId = resolveSlackUserId(ctx, input.slackUserId);
    if (!slackUserId) {
      return { ok: false, error: "No se pudo identificar al usuario de Slack." };
    }

    const config = await getUserConfig(slackUserId);
    if (!config) {
      return {
        ok: true,
        configured: false,
        ready: false,
        missing: ["jiraBase", "jiraEmail", "jiraApiToken", "weeklyPlan"],
      };
    }

    const missing: string[] = [];
    if (!config.jiraBase) missing.push("jiraBase");
    // El email se autodetecta del Slack: solo falta si no hay ni jiraEmail ni el de Slack.
    if (!config.jiraEmail && !config.slackUserEmail) missing.push("jiraEmail");
    if (!config.jiraApiToken) missing.push("jiraApiToken");
    if (!WEEKDAYS.some((d) => config.weeklyPlan[d]?.issues?.length)) missing.push("weeklyPlan");

    return { ok: true, configured: true, ready: missing.length === 0, missing };
  },
});
