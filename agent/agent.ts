import { openai } from "@ai-sdk/openai";
import { defineAgent } from "eve";

// Provider directo de OpenAI (no pasa por el Vercel AI Gateway): se factura a la
// cuenta de OpenAI vía OPENAI_API_KEY y evita el rate limit del free tier del gateway.
export default defineAgent({
  model: openai("gpt-4.1"),
});
