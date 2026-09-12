import { CARD_PROMPT, CARD_SCHEMA, normalizeResult } from "./visionCommon.js";

function extractText(payload) {
  return payload?.candidates?.[0]?.content?.parts
    ?.map(p => p?.text || "")
    .join("")
    .trim() || "";
}

export async function analyzeWithGemini(buffer, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY_NOT_CONFIGURED");

  const model = process.env.GEMINI_VISION_MODEL || "gemini-3.8-flash";
  const started = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: CARD_PROMPT },
          {
            inlineData: {
              mimeType: mimeType || "image/jpeg",
              data: buffer.toString("base64")
            }
          }
        ]
      }],
      generationConfig: {
        responseFormat: {
          text: {
            mimeType: "application/json",
            schema: CARD_SCHEMA
          }
        }
      }
    })
  });

  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = { raw }; }

  if (!response.ok) {
    const msg = payload?.error?.message || payload?.raw || `HTTP_${response.status}`;
    throw new Error(`GEMINI_${response.status}: ${msg}`);
  }

  const text = extractText(payload);
  if (!text) throw new Error("GEMINI_EMPTY_OUTPUT");

  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("GEMINI_INVALID_JSON_OUTPUT"); }

  return {
    provider: "gemini",
    model,
    elapsed_ms: Date.now() - started,
    usage: payload?.usageMetadata || null,
    result: normalizeResult(parsed)
  };
}
