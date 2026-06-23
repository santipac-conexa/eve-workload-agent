import { defineTool } from "eve/tools";
import { z } from "zod";

import { getHolidays } from "../lib/holidays.js";

const schema = z.object({
  year: z.number().int().min(2000).max(2100).optional(),
});

export default defineTool({
  description:
    "Lista los feriados nacionales de Argentina para un anio (desde argentinadatos.com). Por defecto el anio actual.",
  inputSchema: schema,
  async execute({ year }) {
    const y = year ?? new Date().getFullYear();
    const holidays = await getHolidays(y);
    return { ok: true, year: y, count: holidays.length, holidays };
  },
});
