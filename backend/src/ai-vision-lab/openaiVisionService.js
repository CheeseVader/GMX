import { CARD_PROMPT, CARD_SCHEMA, bufferToDataUrl, normalizeResult } from "./visionCommon.js";

function extractText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

export async function analyzeWithOpenAI(buffer, mimeType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY_NOT_CONFIGURED");

  const model = process.env.OPENAI_VISION_MODEL || "gpt-5.6-terra";
  const started = Date.now();

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: CARD_PROMPT },
          { type: "input_image", image_url: bufferToDataUrl(buffer, mimeType), detail: "high" }
        ]
      }],
      text: {
        format: {
          type: "json_schema",
          name: "gmx_tcg_card_identification",
          strict: true,
          schema: CARD_SCHEMA
        }
      }
    })
  });

  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = { raw }; }

  if (!response.ok) {
    const msg = payload?.error?.message || payload?.raw || `HTTP_${response.status}`;
    throw new Error(`OPENAI_${response.status}: ${msg}`);
  }

  const text = extractText(payload);
  if (!text) throw new Error("OPENAI_EMPTY_OUTPUT");

  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("OPENAI_INVALID_JSON_OUTPUT"); }

  return {
    provider: "openai",
    model,
    elapsed_ms: Date.now() - started,
    usage: payload?.usage || null,
    result: normalizeResult(parsed)
  };
}
