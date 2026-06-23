import { defineSchedule } from "eve/schedules";

import slack from "../channels/slack.js";
import { listUserConfigs } from "../lib/users.js";

export default defineSchedule({
  cron: "0 13 * * 1",
  async run({ receive, waitUntil, appAuth }) {
    const users = await listUserConfigs();
    if (users.length === 0) {
      console.warn("[weekly_worklog] No hay usuarios configurados en Redis (users:index).");
      return;
    }

    for (const user of users) {
      if (!user.slackChannelId) {
        console.warn(
          `[weekly_worklog] ${user.slackUserId} sin slackChannelId (no abrio DM con el bot). Saltando.`,
        );
        continue;
      }
      if (!user.jiraApiToken) {
        console.warn(
          `[weekly_worklog] ${user.slackUserId} con config incompleta (falta Jira PAT/email). Saltando.`,
        );
        continue;
      }

      const message =
        `Carga semanal de workload para <@${user.slackUserId}>.\n` +
        `1) Llama a preview_week_load con slackUserId="${user.slackUserId}" (scope "week") y mostrá el resumen (entries + skippedDays).\n` +
        `2) Si hay entries, llamá load_worklogs con slackUserId="${user.slackUserId}" y scope "week". Esa tool pide la aprobación humana (una sola) y es idempotente.\n` +
        `3) Cuando termine, contame el resultado (cargados / ya estaban / fallidos).\n` +
        `4) Si no hay entries (semana toda feriada/de licencia), avisame y no cargues nada.\n` +
        `No interactues con otros usuarios; este turno es solo para <@${user.slackUserId}>.`;

      waitUntil(
        receive(slack, {
          message,
          target: { channelId: user.slackChannelId },
          auth: appAuth,
        }),
      );
    }
  },
});
