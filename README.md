# time-tracker

Agente de carga automática de workload (worklogs) a Jira Cloud, construido con el framework [eve](https://vercel.com/docs/ai-gateway) de Vercel. Respeta feriados nacionales de Argentina y, **opcionalmente**, el time-off registrado en HiBob, y requiere aprobación humana por Slack antes de cualquier carga.

## Diagrama de flujo

<img width="1672" height="941" alt="diagram" src="https://github.com/user-attachments/assets/1869a67d-b1c9-409a-b100-d66794a49684" />


## Cómo funciona

Todos los lunes a las 10:00 AR (`cron: 0 13 * * 1` UTC), un schedule dispara un mensaje por Slack a cada usuario configurado. El agente:

1. Previsualiza la carga de la semana con `preview_week_load` — recorre Lun→Vie y, para cada día, excluye:
   - Fines de semana (sábado/domingo)
   - Feriados nacionales de Argentina ([argentinadatos.com](https://argentinadatos.com/docs/operations/get-feriados), cualquier `tipo`: inamovible/trasladable/puente)
   - Time-off aprobado en HiBob (`GET /timeoff/whosout` con `includeWorkingRequests=false`, así WFH/viaje de negocio no cuentan como ausencia) — **solo si HiBob está configurado** (`HIBOB_SERVICE_USER_ID`/`HIBOB_SERVICE_USER_TOKEN`). Sin esas env vars el agente carga la semana completa, igual respetando finde y feriados AR.
2. Para medios días off, escala las horas proporcionalmente según el plan semanal del usuario.
3. Encadena los worklogs del día consecutivamente desde 09:00 (offset `-0300`), sin lunch, hasta 18:00 — 9h efectivas por día.
4. Pregunta por Slack con botones **Aprobar** / **Desaprobar** (human-in-the-loop durable).
5. Solo tras aprobación, carga cada worklog a Jira Cloud con el API Token del usuario (Basic auth `email:token`). Es idempotente: si ya existe un worklog en esa fecha para ese issue, lo omite.

## Arquitectura

```
Schedule (Lun 10:00 AR)
    │
    ▼
[receive(slack)] → por cada usuario configurado en Redis:
    ├─ get_holidays(year)            ← caché Redis || argentinadatos
    ├─ getWhosOut(employeeId)        ← HiBob (Basic auth service user)
    ├─ buildWeek(user, weekStart)    ← días hábiles L-V menos feriados AR y time-off
    │     └─ encadena items desde 09:00, escala proporcional si medio día
    └─ load_worklogs(scope)          ← needsApproval: una sola aprobación; idempotente
            POST {JIRA_BASE}/rest/api/3/issue/{key}/worklog
            Authorization: Basic base64({email}:{apiToken})
            { started, timeSpent }
```

### Fuentes externas

- **Feriados AR**: `GET https://api.argentinadatos.com/v1/feriados/{year}` — cacheado en Redis bajo `feriados:AR:{year}` (TTL 30 días).
- **HiBob**: HTTP directo con service user (Basic auth). `GET /v1/timeoff/whosout` cacheado en Redis 1h. `POST /v1/people/search` para resolver Slack→employeeId.
- **Jira Cloud**: API Token por usuario (Basic auth `email:token`). `POST /rest/api/3/issue/{key}/worklog`, idempotente con `GET` previo. El `JIRA_BASE` es solo el host (ej `https://conexa-tech.atlassian.net`); el issue key va en el `weeklyPlan`, no en la base URL.

### Store

[Upstash Redis](https://upstash.com) guarda la config por usuario y las cachés de feriados/time-off (persiste entre sesiones, ya que `defineState` de eve es solo per-session).

## Estructura del proyecto

```
agent/
├── agent.ts                       # defineAgent con model openai/gpt-4.1-mini
├── instructions.md                # Prompt del agente (reglas de feriados, HITL, offsets)
├── channels/
│   ├── eve.ts                     # HTTP channel (local + Vercel OIDC)
│   └── slack.ts                   # Slack channel vía Vercel Connect
├── lib/
│   ├── redis.ts                   # Cliente Upstash (getJSON/setJSON/TTL)
│   ├── users.ts                   # UserConfig + weeklyPlan, persistencia en Redis
│   ├── holidays.ts                # getHolidays(year) + isHoliday(date)
│   ├── hibob.ts                   # getWhosOut, getEmployeeByEmail, dayWorkFraction
│   ├── jira.ts                    # addWorklog (idempotente), getWorklogs, getMyWorklogs, verifyToken
│   └── workdays.ts                # buildWeek / buildWeekScoped: feriados + HiBob + plan
├── tools/
│   ├── user_has_config.ts         # Estado de setup { configured, ready, missing } (chequeo inicial)
│   ├── set_user_config.ts         # Credenciales de Jira (needsApproval; plan opcional)
│   ├── set_uniform_plan.ts        # Plan semanal uniforme (mismo issue+horas L-V)
│   ├── get_user_config.ts         # Consulta config (sin exponer PAT)
│   ├── preview_week_load.ts       # Previsualiza (scope week|today, no escribe Jira)
│   ├── load_worklogs.ts           # Carga batch (scope week|today, needsApproval, idempotente)
│   ├── get_my_worklogs.ts         # Lo que ya está cargado en Jira (visibilidad)
│   └── get_holidays.ts            # Inspección de feriados AR
├── schedules/
│   └── weekly_worklog.ts          # Cron Lun 10:00 AR → receive(slack) por usuario
```

## Configuración

### Variables de entorno

| Variable                   | Requerida    | Descripción                                                                  |
| -------------------------- | ------------ | --------------------------------------------------------------------------- |
| `OPENAI_API_KEY`           | sí           | API key de OpenAI. El modelo usa el provider directo (`openai("gpt-4.1")`), no el AI Gateway: el consumo se factura a esta cuenta |
| `REDIS_REST_URL`           | sí           | URL REST de Upstash Redis                                                    |
| `REDIS_REST_TOKEN`         | sí           | Token REST de Upstash Redis                                                  |
| `SLACK_CONNECT_UID`        | solo prod    | UID del cliente Slack Connect, ej `slack/time-tracker` (defecto). No hace falta en local |
| `HIBOB_SERVICE_USER_ID`    | opcional     | Service user ID de HiBob. Sin él, no se descuenta time-off                   |
| `HIBOB_SERVICE_USER_TOKEN` | opcional     | Token del service user de HiBob                                              |

Las credenciales de Jira NO son env vars: son **por usuario** y se cargan vía `set_user_config` (se guardan en Redis). `.env*` está en `.gitignore`.

### Configuración por usuario

Cada usuario se configura a sí mismo por DM al bot de Slack, llamando a `set_user_config`:

El onboarding son dos pasos: `set_user_config` (credenciales) + `set_uniform_plan` (plan). Las credenciales (Jira Cloud):

```jsonc
{
  "jiraBase": "https://conexa-tech.atlassian.net", // solo el host
  "jiraEmail": "santi@empresa.com",                // Slack no lo provee: se pide
  "jiraApiToken": "<API Token de Jira Cloud>"
}
```

El plan, para el caso típico (mismo issue y horas todos los días), con `set_uniform_plan`:

```jsonc
{ "issues": [{ "issueKey": "IE-728", "hours": 9 }] } // L-V por defecto
```

Para un reparto distinto por día, `set_user_config` acepta un `weeklyPlan` completo (`mon..fri`, varios issues por día). La distribución/suma de horas es responsabilidad del usuario; el agente no valida que sumen 9h.

### Slack (Vercel Connect)

El canal Slack usa [Vercel Connect](https://vercel.com/docs/connect) para manejar tokens y webhook verification:

```bash
npm install -g vercel@latest && export FF_CONNECT_ENABLED=1
vercel connect create slack --triggers
vercel connect detach <uid> --yes
vercel connect attach <uid> --triggers --trigger-path /eve/v1/slack --yes
```

No hay `SLACK_BOT_TOKEN` ni `SLACK_SIGNING_SECRET` sueltos; los maneja Connect.

### Scopes del bot Slack

El bot necesita suscribirse a estos eventos y pedir estos scopes:

- **Eventos**: `app_mention`, `message.im`
- **Scopes**: `app_mentions:read`, `im:history`, `im:write`, `users:read`, `users:read.email` (para capturar el email del DM y resolver el `slackChannelId` + `slackUserEmail`)

Cuando un usuario abre un DM con el bot por primera vez, el canal guarda automáticamente su `slackChannelId` (y `slackUserEmail` si el scope de email está) en Redis. El schedule semanal entrega el mensaje de aprobación a ese DM — privado, nadie más ve la conversación.

## Uso local (sin Slack, con tu propia OpenAI key)

Pensado para que cada teammate use el agente **con su propia cuenta de OpenAI** (su consumo, no el del deploy compartido) y sin depender de Slack. La conversación va por el TUI de eve.

1. Cloná el repo y `npm install`.
2. Creá un `.env.local` con lo mínimo (sin Slack, sin HiBob):
   ```bash
   OPENAI_API_KEY=sk-...          # tu propia key → tu costo
   REDIS_REST_URL=https://...     # tu propio Upstash (free tier alcanza)
   REDIS_REST_TOKEN=...
   ```
   > Usá **tu propio** Upstash: si compartís el Redis del deploy, tu config local puede pisarse con la de otros (la clave se deriva del principal local). Aislás key **y** estado.
3. `npm run dev` → entrás al TUI interactivo. El canal de Slack queda inerte (no recibe webhooks en local), así que no molesta.
4. En el TUI, chateá con el agente igual que por DM:
   - Configurá: pasale tu base de Jira, email y API Token → aprobás el `set_user_config` con `y`.
   - Plan: "9h en IE-728 de lunes a viernes".
   - Cargá: "cargá mis horas de hoy" / "cargá la semana".

Las aprobaciones de las tools de escritura se confirman inline (`y`/`n`) en el TUI, igual que los botones de Slack.

## Scripts

| Comando             | Descripción                             |
| ------------------- | --------------------------------------- |
| `npm run dev`       | `eve dev` — runtime local con TUI       |
| `npm run build`     | `eve build` — compila a `.eve/`         |
| `npm run start`     | `eve start` — sirve el build production |
| `npm run typecheck` | `tsc` — verificación de tipos           |
| `npm run lint`      | `oxlint`                                |

## Modelo

`openai("gpt-4.1")` vía **provider directo** del AI SDK (`@ai-sdk/openai`), no el AI Gateway — el consumo se factura a la `OPENAI_API_KEY` del entorno. Se eligió gpt-4.1 (full) sobre mini por confiabilidad siguiendo instrucciones y orquestando tools. Cambialo en `agent/agent.ts`.

## Seguridad

- El PAT de Jira es por usuario y se guarda en Redis (no en el repo). `set_user_config` requiere aprobación humana.
- Los worklogs quedan registrado a nombre del dueño del PAT.
- La aprobación llega por **DM privado** entre cada usuario y el bot. Nadie ve ni puede clickear la carga de otro.
- Para que el schedule envíe el DM, el usuario debe abrir **una vez** una conversación DM con el bot (el canal captura y guarda el `slackChannelId` en Redis al recibir el primer `message.im`).
- Nunca se loguea ni devuelve el PAT en las tools.

## Deploy en Vercel

```bash
VERCEL_USE_EXPERIMENTAL_FRAMEWORKS=1 vercel deploy --prod
```

`VERCEL_USE_EXPERIMENTAL_FRAMEWORKS=1` permite que el CLI reconozca eve como framework. Los schedules se convierten en Vercel Cron Jobs (evaluados en UTC).
