import { defineTool } from "eve/tools";
import { z } from "zod";

import { getUserConfig, resolveSlackUserId } from "../lib/users.js";
import { buildWeekScoped } from "../lib/workdays.js";

export default defineTool({
  description:
    "Previsualiza (sin escribir en Jira) los worklogs a cargar: dias habiles L-V, excluye finde, feriados AR y time off de HiBob (si esta configurado), reparte horas segun el plan. scope='week' (toda la semana) o 'today' (solo hoy). Tool de lectura: usala libremente antes de cargar. Desde un schedule pasa slackUserId explicito.",
  inputSchema: z.object({
    scope: z
      .enum(["week", "today"])
      .optional()
      .describe("'week' = semana actual L-V (default). 'today' = solo el dia de hoy."),
    slackUserId: z
      .string()
      .optional()
      .describe(
        "ID de usuario de Slack objetivo. Omitir cuando el propio usuario interactua por DM/mention.",
      ),
  }),
  async execute(input, ctx) {
    const slackUserId = resolveSlackUserId(ctx, input.slackUserId);
    if (!slackUserId) {
      return { ok: false, error: "No se pudo identificar al usuario de Slack." };
    }
    const user = await getUserConfig(slackUserId);
    if (!user) {
      return {
        ok: false,
        error: "No hay configuracion. Usa set_user_config primero.",
      };
    }
    const result = await buildWeekScoped(user, input.scope ?? "week");
    return { ok: true, scope: input.scope ?? "week", ...result };
  },
});
