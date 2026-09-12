import { createWorker } from "tesseract.js";
import { listCards } from "../repositories/tcgRepository.js";

function clean(v = "") {
  return String(v ?? "").trim();
}

function compact(v = "") {
  return clean(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function words(v = "") {
  return clean(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function similarity(a, b) {
  const A = compact(a);
  const B = compact(b);

  if (!A || !B) return 0;
  if (A === B) return 1;

  if (A.includes(B) || B.includes(A)) {
    return Math.min(A.length, B.length) / Math.max(A.length, B.length);
  }

  const wa = new Set(words(a));
  const wb = new Set(words(b));

  let intersection = 0;
  for (const token of wa) {
    if (wb.has(token)) intersection += 1;
  }

  const union = new Set([...wa, ...wb]).size || 1;
  return intersection / union;
}

function likelyCode(value = "") {
  const text = clean(value).toUpperCase();
  const match = text.match(/\b[A-Z0-9]{2,8}[- ][A-Z0-9]{2,8}\b/);
  return match ? match[0].replace(/\s+/g, "-") : "";
}

function usefulLines(text = "") {
  return String(text)
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && x.length <= 90)
    .filter((x) => /[\p{L}0-9]/u.test(x));
}

function titleCandidates(lines) {
  const bad =
    /^(ATK|DEF|HP|BASIC|STAGE|TRAINER|ENERGY|SPELL|TRAP|MONSTER|CARTA|MAGICA|TRAMPA|CRIATURA|INSTANT|SORCERY|ENCHANTMENT|LAND)\b/i;

  return lines
    .slice(0, 18)
    .filter((x) => !bad.test(x))
    .filter((x) => x.replace(/[^\p{L}]/gu, "").length >= 3)
    .sort((a, b) => {
      const as =
        (a.length >= 4 && a.length <= 45 ? 2 : 0) +
        (a === a.toUpperCase() ? 0.2 : 0);

      const bs =
        (b.length >= 4 && b.length <= 45 ? 2 : 0) +
        (b === b.toUpperCase() ? 0.2 : 0);

      return bs - as;
    })
    .slice(0, 8);
}

async function runOcr(buffer) {
  let worker;

  try {
    worker = await createWorker(["spa", "eng"]);
  } catch {
    worker = await createWorker("eng");
  }

  try {
    const result = await worker.recognize(buffer);

    return {
      text: clean(result?.data?.text),
      confidence: Number(result?.data?.confidence || 0),
      lines: usefulLines(result?.data?.text || "")
    };
  } finally {
    await worker.terminate();
  }
}

async function localCatalog(ocr) {
  const lines = ocr.lines || [];
  const names = titleCandidates(lines);
  const code = lines.map(likelyCode).find(Boolean) || "";
  const queries = [...new Set(names.slice(0, 5))];

  const rows = [];

  for (const q of queries) {
    try {
      const result = await listCards({ search: q, limit: 60 });

      for (const row of result?.rows || []) {
        rows.push(row);
      }
    } catch {
      // El laboratorio local debe seguir aun si una consulta individual falla.
    }
  }

  const seen = new Set();
  const scored = [];

  for (const row of rows) {
    const key = clean(
      row.id_carta ||
        row.external_id ||
        `${row.nombre || row.name}|${row.codigo || row.collector_number || ""}`
    );

    if (seen.has(key)) continue;
    seen.add(key);

    const cardName = clean(
      row.nombre ||
        row.name ||
        row.nombre_carta ||
        ""
    );

    const cardCode = clean(
      row.codigo ||
        row.collector_number ||
        row.numero_coleccion ||
        row.set_code ||
        ""
    );

    let nameScore = 0;
    let observed = "";

    for (const line of names) {
      const score = similarity(line, cardName);

      if (score > nameScore) {
        nameScore = score;
        observed = line;
      }
    }

    const codeScore =
      code &&
      cardCode &&
      compact(code) === compact(cardCode)
        ? 1
        : 0;

    const total = Math.min(
      1,
      nameScore * 0.78 + codeScore * 0.22
    );

    scored.push({
      score: Number(total.toFixed(4)),
      exact_name:
        Boolean(compact(observed)) &&
        compact(observed) === compact(cardName),
      exact_code: Boolean(codeScore),
      observed_name: observed,
      observed_code: code,
      card: row
    });
  }

  scored.sort((a, b) => b.score - a.score);

  return {
    observed_name: names[0] || "",
    observed_code: code,
    candidates: scored.slice(0, 12),
    confirmed:
      scored.length > 0 &&
      scored[0].score >= 0.93 &&
      (scored[0].exact_name || scored[0].exact_code)
  };
}

async function ollamaVision(buffer) {
  const base = "http://127.0.0.1:11434";
  const model = clean(
    process.env.OLLAMA_VISION_MODEL || "qwen2.5vl:3b"
  );

  try {
    const tags = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(1200)
    });

    if (!tags.ok) {
      throw new Error("OLLAMA_NOT_READY");
    }
  } catch {
    return {
      available: false,
      model,
      error: "OLLAMA_NO_DISPONIBLE"
    };
  }

  const prompt = [
    "Analiza esta carta TCG SIN INTERNET.",
    "Primero transcribe literalmente lo visible.",
    "No autocorrijas nombres.",
    "Mantener observacion e identificacion separadas.",
    'Devuelve SOLO JSON con estas claves:',
    '{"printed_name":"","collector_number":"","set_code":"","language":"","tcg":"","proposed_identity":"","ambiguous":true,"notes":""}'
  ].join("\n");

  try {
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          {
            role: "user",
            content: prompt,
            images: [buffer.toString("base64")]
          }
        ],
        options: {
          temperature: 0
        }
      }),
      signal: AbortSignal.timeout(120000)
    });

    const text = await response.text();

    if (!response.ok) {
      return {
        available: true,
        model,
        error: `OLLAMA_${response.status}: ${text.slice(0, 500)}`
      };
    }

    const json = JSON.parse(text);

    let data = {};

    try {
      data = JSON.parse(json?.message?.content || "{}");
    } catch {
      data = {
        raw: json?.message?.content || ""
      };
    }

    return {
      available: true,
      model,
      data
    };
  } catch (error) {
    return {
      available: true,
      model,
      error: error?.message || String(error)
    };
  }
}

export async function analyzeLocalCard(
  buffer,
  mimeType = "image/jpeg"
) {
  const started = Date.now();

  const ocr = await runOcr(buffer);
  const catalog = await localCatalog(ocr);
  const vision = await ollamaVision(buffer, mimeType);

  return {
    provider: "LOCAL",
    cost: "$0",
    api_key_required: false,
    internet_required: false,
    elapsed_ms: Date.now() - started,
    ocr,
    catalog,
    vision
  };
}