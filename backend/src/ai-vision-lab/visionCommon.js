export const CARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tcg: { type: "string", description: "Trading card game visible or inferred: Pokemon, Yu-Gi-Oh!, Magic, Digimon, One Piece, Lorcana, other, unknown." },
    printed_name: { type: "string", description: "Literal card name exactly as visually printed. Never autocorrect." },
    printed_set_code: { type: "string", description: "Literal visible set code. Empty if unreadable." },
    printed_collector_number: { type: "string", description: "Literal visible collector/card number. Empty if unreadable." },
    printed_language: { type: "string", description: "Language visible on the card." },
    printed_rarity: { type: "string", description: "Literal rarity if visible; otherwise empty." },
    observed_text: {
      type: "array",
      items: { type: "string" },
      description: "Short pieces of text actually visible in the image. Do not invent."
    },
    identification_name: { type: "string", description: "Best proposed card identity. Keep separate from literal transcription." },
    identification_set: { type: "string", description: "Best proposed set identity, or empty." },
    identification_number: { type: "string", description: "Best proposed collector/card number, or empty." },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    ambiguous: { type: "boolean" },
    notes: { type: "string", description: "Brief note about glare, blur, sleeve, crop, uncertainty, or conflicting evidence." }
  },
  required: [
    "tcg","printed_name","printed_set_code","printed_collector_number",
    "printed_language","printed_rarity","observed_text","identification_name",
    "identification_set","identification_number","confidence","ambiguous","notes"
  ]
};

export const CARD_PROMPT = `
You are the visual identification engine for GMX, a trading-card inventory application.

CRITICAL RULES:
1. READ LITERALLY before identifying. Never silently autocorrect a visible card name.
2. Keep OBSERVATION separate from IDENTIFICATION.
3. If the image visibly says "D.Human", printed_name must be exactly "D.Human"; do not replace it with a semantically similar name.
4. Prefer visible evidence: printed name, set code, collector number, rarity, language, layout and artwork.
5. If a field cannot be read, return an empty string rather than inventing a value.
6. confidence is confidence in the proposed exact identity, not merely confidence that this is a trading card.
7. Set ambiguous=true whenever multiple exact cards/variants remain plausible.
8. Do not estimate prices.
9. Do not claim external catalog verification; this request only analyzes the supplied image.
10. Return only data matching the requested schema.
`;

export function bufferToDataUrl(buffer, mimeType) {
  return `data:${mimeType || "image/jpeg"};base64,${buffer.toString("base64")}`;
}

export function normalizeResult(x = {}) {
  return {
    tcg: String(x.tcg || "unknown"),
    printed_name: String(x.printed_name || ""),
    printed_set_code: String(x.printed_set_code || ""),
    printed_collector_number: String(x.printed_collector_number || ""),
    printed_language: String(x.printed_language || ""),
    printed_rarity: String(x.printed_rarity || ""),
    observed_text: Array.isArray(x.observed_text) ? x.observed_text.map(String).slice(0, 30) : [],
    identification_name: String(x.identification_name || ""),
    identification_set: String(x.identification_set || ""),
    identification_number: String(x.identification_number || ""),
    confidence: Math.max(0, Math.min(100, Number(x.confidence || 0))),
    ambiguous: Boolean(x.ambiguous),
    notes: String(x.notes || "")
  };
}

export function compareVisionResults(a, b) {
  const norm = v => String(v || "").trim().toLocaleLowerCase();
  const same = (x, y) => norm(x) !== "" && norm(x) === norm(y);

  const fields = {
    printed_name: same(a.printed_name, b.printed_name),
    set_code: same(a.printed_set_code, b.printed_set_code),
    collector_number: same(a.printed_collector_number, b.printed_collector_number),
    identification_name: same(a.identification_name, b.identification_name),
    identification_set: same(a.identification_set, b.identification_set),
    identification_number: same(a.identification_number, b.identification_number)
  };

  const weighted = [
    [fields.printed_name, 25],
    [fields.collector_number, 25],
    [fields.set_code, 15],
    [fields.identification_name, 15],
    [fields.identification_number, 15],
    [fields.identification_set, 5]
  ];

  const agreement = weighted.reduce((sum, [ok, w]) => sum + (ok ? w : 0), 0);

  return {
    agreement,
    fields,
    recommended: agreement >= 80 && !a.ambiguous && !b.ambiguous
      ? "CONSENSUS"
      : "REVIEW",
    warning: agreement < 80
      ? "Los motores no coinciden lo suficiente. No confirmar automaticamente."
      : ""
  };
}
