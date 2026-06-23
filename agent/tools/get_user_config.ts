import { defineTool } from "eve/tools";
import { z } from "zod";

import { getUserConfig, resolveSlackUserId } from "../lib/users.js";

export default defineTool({
  description:
    "Devuelve la configuracion actual del usuario (Jira base, email, HiBob employeeId, plan semanal). No devuelve el API Token.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const slackUserId = resolveSlackUserId(ctx);
    if (!slackUserId) {
      return { ok: false, error: "No se pudo identificar al usuario de Slack." };
    }
    const config = await getUserConfig(slackUserId);
    if (!config) {
      return {
        ok: false,
        error:
          "No hay configuracion. Usa set_user_config con tu email + API Token de Jira, email de HiBob y plan semanal.",
      };
    }
    return {
      ok: true,
      slackUserId: config.slackUserId,
      jiraBase: config.jiraBase,
      hibobEmployeeId: config.hibobEmployeeId,
      weeklyPlan: config.weeklyPlan,
    };
  },
});
