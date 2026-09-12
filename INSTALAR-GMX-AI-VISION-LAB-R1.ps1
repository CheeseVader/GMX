param(
    [string]$ProjectRoot = "C:\Users\igarcia\Videos\GMX-BRAND-NUEVO"
)

$ErrorActionPreference = "Stop"

function Info($m) { Write-Host "[GMX AI VISION] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[AVISO] $m" -ForegroundColor Yellow }

$Backend = Join-Path $ProjectRoot "backend"
$Src = Join-Path $Backend "src"
$Server = Join-Path $Src "server.js"
$Routes = Join-Path $Src "routes"
$Lab = Join-Path $Src "ai-vision-lab"
$Public = Join-Path $Lab "public"
$Env = Join-Path $Backend ".env"
$EnvExample = Join-Path $Backend ".env.example"

if (!(Test-Path $ProjectRoot)) { throw "No existe ProjectRoot: $ProjectRoot" }
if (!(Test-Path $Server)) { throw "No se encontro backend\src\server.js en $ProjectRoot" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Backup = Join-Path $ProjectRoot "BACKUP-AI-VISION-LAB-R1-$stamp"
New-Item -ItemType Directory -Force -Path $Backup | Out-Null
Copy-Item $Server (Join-Path $Backup "server.js") -Force
if (Test-Path $Env) { Copy-Item $Env (Join-Path $Backup ".env") -Force }

New-Item -ItemType Directory -Force -Path $Routes,$Lab,$Public | Out-Null

Info "Creando servicio comun..."

$common = @'
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
'@
Set-Content -Path (Join-Path $Lab "visionCommon.js") -Value $common -Encoding UTF8

Info "Creando servicio OpenAI..."

$openai = @'
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
'@
Set-Content -Path (Join-Path $Lab "openaiVisionService.js") -Value $openai -Encoding UTF8

Info "Creando servicio Gemini..."

$gemini = @'
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
'@
Set-Content -Path (Join-Path $Lab "geminiVisionService.js") -Value $gemini -Encoding UTF8

Info "Creando router aislado..."

$route = @'
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeWithOpenAI } from "../ai-vision-lab/openaiVisionService.js";
import { analyzeWithGemini } from "../ai-vision-lab/geminiVisionService.js";
import { compareVisionResults } from "../ai-vision-lab/visionCommon.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const labHtml = path.resolve(__dirname, "../ai-vision-lab/public/index.html");

function enabled(_req, res, next) {
  if (String(process.env.AI_VISION_LAB_ENABLED || "true").toLowerCase() !== "true") {
    return res.status(404).json({ success: false, error: "AI_VISION_LAB_DISABLED" });
  }
  next();
}

function imageOnly(req, res, next) {
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) {
    return res.status(415).json({ success: false, error: "IMAGE_CONTENT_TYPE_REQUIRED" });
  }
  next();
}

const imageBody = express.raw({
  type: ["image/jpeg","image/png","image/webp","image/gif"],
  limit: "12mb"
});

router.use(enabled);

router.get("/", (_req, res) => res.sendFile(labHtml));

router.get("/status", (_req, res) => {
  res.json({
    success: true,
    enabled: true,
    providers: {
      openai: {
        configured: Boolean(process.env.OPENAI_API_KEY),
        model: process.env.OPENAI_VISION_MODEL || "gpt-5.6-terra"
      },
      gemini: {
        configured: Boolean(process.env.GEMINI_API_KEY),
        model: process.env.GEMINI_VISION_MODEL || "gemini-3.8-flash"
      }
    }
  });
});

router.post("/analyze/openai", imageOnly, imageBody, async (req, res) => {
  try {
    const data = await analyzeWithOpenAI(req.body, req.headers["content-type"]);
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(502).json({ success: false, error: e?.message || String(e) });
  }
});

router.post("/analyze/gemini", imageOnly, imageBody, async (req, res) => {
  try {
    const data = await analyzeWithGemini(req.body, req.headers["content-type"]);
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(502).json({ success: false, error: e?.message || String(e) });
  }
});

router.post("/analyze/compare", imageOnly, imageBody, async (req, res) => {
  try {
    const mime = req.headers["content-type"];
    const [oa, gm] = await Promise.allSettled([
      analyzeWithOpenAI(req.body, mime),
      analyzeWithGemini(req.body, mime)
    ]);

    const openai = oa.status === "fulfilled"
      ? oa.value
      : { provider: "openai", success: false, error: oa.reason?.message || String(oa.reason) };

    const gemini = gm.status === "fulfilled"
      ? gm.value
      : { provider: "gemini", success: false, error: gm.reason?.message || String(gm.reason) };

    let comparison = null;
    if (oa.status === "fulfilled" && gm.status === "fulfilled") {
      comparison = compareVisionResults(oa.value.result, gm.value.result);
    }

    res.json({
      success: oa.status === "fulfilled" || gm.status === "fulfilled",
      openai,
      gemini,
      comparison
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

export default router;
'@
Set-Content -Path (Join-Path $Routes "aiVisionLab.js") -Value $route -Encoding UTF8

Info "Creando interfaz AI Vision Lab..."

$html = @'
<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>GMX · AI Vision Lab</title>
  <style>
    :root{font-family:Inter,Segoe UI,Arial,sans-serif;color:#eaf0ff;background:#0b1020}
    *{box-sizing:border-box}
    body{margin:0;background:linear-gradient(145deg,#0a0f1d,#111a31);min-height:100vh}
    .wrap{max-width:1320px;margin:auto;padding:24px}
    .top{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:18px}
    h1{margin:0;font-size:28px}.sub{opacity:.72;margin-top:5px}
    .badge{padding:8px 12px;border:1px solid #31415f;border-radius:999px;background:#11192b;font-size:12px}
    .card{background:rgba(17,25,43,.92);border:1px solid #293a59;border-radius:18px;padding:18px;box-shadow:0 16px 50px #0005}
    .grid{display:grid;grid-template-columns:minmax(320px,.8fr) 1.2fr;gap:18px}
    .preview{min-height:480px;display:grid;place-items:center;border:1px dashed #405270;border-radius:14px;background:#080d18;overflow:hidden}
    .preview img{width:100%;height:100%;max-height:620px;object-fit:contain}
    input[type=file]{width:100%;padding:13px;margin-top:14px;border-radius:12px;border:1px solid #354868;background:#0b1221;color:#fff}
    .buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
    button{border:0;border-radius:12px;padding:13px 12px;font-weight:700;cursor:pointer;background:#6d7cff;color:white}
    button:nth-child(2){background:#34a853}button:nth-child(3){background:#7d55e7}
    button:disabled{opacity:.45;cursor:not-allowed}
    .providers{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .provider{background:#0b1221;border:1px solid #2c3d5c;border-radius:14px;padding:15px;min-height:340px}
    .provider h2{font-size:17px;margin:0 0 12px}.muted{opacity:.6}.error{color:#ff9191;white-space:pre-wrap}
    .row{display:grid;grid-template-columns:145px 1fr;gap:8px;padding:7px 0;border-bottom:1px solid #1e2a42;font-size:14px}
    .row:last-child{border-bottom:0}.label{opacity:.62}.value{word-break:break-word;font-weight:600}
    .literal{color:#a8c8ff}.confidence{font-size:24px;font-weight:800}
    .compare{margin-top:14px}
    .meter{height:12px;background:#1c2942;border-radius:99px;overflow:hidden}.meter>div{height:100%;background:#8696ff;width:0}
    pre{white-space:pre-wrap;background:#070b13;border-radius:10px;padding:10px;max-height:190px;overflow:auto;font-size:11px}
    @media(max-width:900px){.grid,.providers{grid-template-columns:1fr}.buttons{grid-template-columns:1fr}.preview{min-height:330px}}
  </style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div>
      <h1>GMX · AI Vision Lab</h1>
      <div class="sub">Prueba aislada de reconocimiento de cartas · lectura literal ≠ identificación</div>
    </div>
    <div id="status" class="badge">Comprobando APIs…</div>
  </div>

  <div class="grid">
    <section class="card">
      <div id="preview" class="preview"><div class="muted">Selecciona una fotografía de una carta</div></div>
      <input id="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" />
      <div class="buttons">
        <button id="btnOpenAI" disabled>Analizar OpenAI</button>
        <button id="btnGemini" disabled>Analizar Gemini</button>
        <button id="btnCompare" disabled>Comparar ambos</button>
      </div>
      <p class="muted" style="font-size:12px">La foto se envía al proveedor seleccionado. Las API keys permanecen únicamente en el backend de GMX.</p>
    </section>

    <section class="card">
      <div class="providers">
        <div class="provider">
          <h2>OpenAI <span id="oaModel" class="muted"></span></h2>
          <div id="openai"><div class="muted">Sin análisis.</div></div>
        </div>
        <div class="provider">
          <h2>Gemini <span id="gmModel" class="muted"></span></h2>
          <div id="gemini"><div class="muted">Sin análisis.</div></div>
        </div>
      </div>

      <div class="provider compare">
        <h2>Comparación</h2>
        <div id="comparison"><div class="muted">Usa “Comparar ambos” para medir coincidencia.</div></div>
      </div>
    </section>
  </div>
</div>

<script>
const $ = s => document.querySelector(s);
let file = null;

function esc(v){
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[c]);
}

function row(label,value,klass=""){
  return `<div class="row"><div class="label">${esc(label)}</div><div class="value ${klass}">${esc(value || "—")}</div></div>`;
}

function resultHtml(data){
  if(!data) return '<div class="muted">Sin resultado.</div>';
  if(data.success === false || data.error) return `<div class="error">${esc(data.error || "Error")}</div>`;
  const r = data.result || {};
  return `
    ${row("Tiempo", `${data.elapsed_ms ?? "?"} ms`)}
    ${row("Nombre impreso", r.printed_name, "literal")}
    ${row("Set/código impreso", r.printed_set_code, "literal")}
    ${row("Número impreso", r.printed_collector_number, "literal")}
    ${row("Idioma", r.printed_language)}
    ${row("Rareza", r.printed_rarity)}
    ${row("TCG", r.tcg)}
    ${row("Identificación", r.identification_name)}
    ${row("Set propuesto", r.identification_set)}
    ${row("Número propuesto", r.identification_number)}
    ${row("Ambigua", r.ambiguous ? "Sí" : "No")}
    ${row("Confianza", `${r.confidence ?? 0}%`, "confidence")}
    ${row("Notas", r.notes)}
    <details style="margin-top:10px"><summary>Texto observado</summary><pre>${esc((r.observed_text || []).join("\n"))}</pre></details>
  `;
}

function compareHtml(c){
  if(!c) return '<div class="muted">No fue posible comparar ambos motores.</div>';
  return `
    ${row("Coincidencia", `${c.agreement}%`, "confidence")}
    <div class="meter"><div style="width:${Math.max(0,Math.min(100,c.agreement))}%"></div></div>
    ${row("Decisión", c.recommended === "CONSENSUS" ? "Consenso suficiente para validar después con catálogo" : "Revisión necesaria")}
    ${row("Nombre impreso coincide", c.fields?.printed_name ? "Sí" : "No")}
    ${row("Número coincide", c.fields?.collector_number ? "Sí" : "No")}
    ${row("Set coincide", c.fields?.set_code ? "Sí" : "No")}
    ${c.warning ? `<div class="error" style="margin-top:10px">${esc(c.warning)}</div>` : ""}
  `;
}

async function status(){
  try{
    const r = await fetch("/ai-vision-lab/status");
    const j = await r.json();
    if(!j.success) throw new Error(j.error || "status");
    $("#status").textContent =
      `OpenAI ${j.providers.openai.configured ? "✓" : "✗"} · Gemini ${j.providers.gemini.configured ? "✓" : "✗"}`;
    $("#oaModel").textContent = `· ${j.providers.openai.model}`;
    $("#gmModel").textContent = `· ${j.providers.gemini.model}`;
  }catch(e){
    $("#status").textContent = "Lab no disponible";
  }
}

$("#file").addEventListener("change", e => {
  file = e.target.files?.[0] || null;
  const enabled = !!file;
  ["#btnOpenAI","#btnGemini","#btnCompare"].forEach(x => $(x).disabled = !enabled);
  if(file){
    const url = URL.createObjectURL(file);
    $("#preview").innerHTML = `<img src="${url}" alt="Carta seleccionada">`;
  }
});

async function call(endpoint){
  if(!file) return null;
  const r = await fetch(endpoint,{
    method:"POST",
    headers:{"Content-Type":file.type || "image/jpeg"},
    body:file
  });
  const j = await r.json().catch(()=>({success:false,error:`HTTP ${r.status}`}));
  return j;
}

async function runOne(which){
  const btns = [...document.querySelectorAll("button")];
  btns.forEach(b=>b.disabled=true);
  try{
    if(which==="openai"){
      $("#openai").innerHTML='<div class="muted">Analizando…</div>';
      const j = await call("/ai-vision-lab/analyze/openai");
      $("#openai").innerHTML=resultHtml(j);
    }else{
      $("#gemini").innerHTML='<div class="muted">Analizando…</div>';
      const j = await call("/ai-vision-lab/analyze/gemini");
      $("#gemini").innerHTML=resultHtml(j);
    }
  }finally{
    btns.forEach(b=>b.disabled=!file);
  }
}

$("#btnOpenAI").onclick=()=>runOne("openai");
$("#btnGemini").onclick=()=>runOne("gemini");
$("#btnCompare").onclick=async()=>{
  const btns=[...document.querySelectorAll("button")];
  btns.forEach(b=>b.disabled=true);
  $("#openai").innerHTML='<div class="muted">Analizando…</div>';
  $("#gemini").innerHTML='<div class="muted">Analizando…</div>';
  $("#comparison").innerHTML='<div class="muted">Comparando…</div>';
  try{
    const j=await call("/ai-vision-lab/analyze/compare");
    $("#openai").innerHTML=resultHtml(j.openai);
    $("#gemini").innerHTML=resultHtml(j.gemini);
    $("#comparison").innerHTML=compareHtml(j.comparison);
  }finally{
    btns.forEach(b=>b.disabled=!file);
  }
};
status();
</script>
</body>
</html>
'@
Set-Content -Path (Join-Path $Public "index.html") -Value $html -Encoding UTF8

Info "Agregando configuracion .env..."

$envBlock = @'

# ===== GMX AI VISION LAB R1 =====
AI_VISION_LAB_ENABLED=true
OPENAI_API_KEY=
OPENAI_VISION_MODEL=gpt-5.6-terra
GEMINI_API_KEY=
GEMINI_VISION_MODEL=gemini-3.8-flash
# ===== /GMX AI VISION LAB R1 =====
'@

foreach ($f in @($Env,$EnvExample)) {
    if (!(Test-Path $f)) { New-Item -ItemType File -Force -Path $f | Out-Null }
    $txt = Get-Content $f -Raw
    if ($txt -notmatch "AI_VISION_LAB_ENABLED") {
        Add-Content -Path $f -Value $envBlock -Encoding UTF8
        Ok "Configuracion agregada a $f"
    } else {
        Warn "AI Vision ya tenia variables en $f; no se duplicaron."
    }
}

Info "Integrando ruta en server.js..."

$serverText = Get-Content $Server -Raw

if ($serverText -notmatch "aiVisionLabRouter") {
    $importLine = "import aiVisionLabRouter from './routes/aiVisionLab.js';"
    if ($serverText.Contains("import express from 'express';")) {
        $serverText = $serverText.Replace(
            "import express from 'express';",
            "import express from 'express';`r`n$importLine"
        )
    } elseif ($serverText.Contains('import express from "express";')) {
        $serverText = $serverText.Replace(
            'import express from "express";',
            'import express from "express";' + "`r`n" + $importLine
        )
    } else {
        $serverText = $importLine + "`r`n" + $serverText
    }

    $mount = "app.use('/ai-vision-lab', aiVisionLabRouter);"
    $marker = "if (process.env.NODE_ENV === 'production') {"
    if ($serverText.Contains($marker)) {
        $serverText = $serverText.Replace($marker, "$mount`r`n`r`n$marker")
    } else {
        $listenIndex = $serverText.IndexOf("app.listen(")
        if ($listenIndex -lt 0) { throw "No pude encontrar punto seguro para montar AI Vision Lab en server.js" }
        $serverText = $serverText.Insert($listenIndex, "$mount`r`n`r`n")
    }

    Set-Content -Path $Server -Value $serverText -Encoding UTF8
    Ok "server.js integrado."
} else {
    Warn "server.js ya contiene aiVisionLabRouter; no se duplico."
}

Info "Validando sintaxis JavaScript..."
Push-Location $Backend
try {
    node --check "src\routes\aiVisionLab.js"
    node --check "src\ai-vision-lab\visionCommon.js"
    node --check "src\ai-vision-lab\openaiVisionService.js"
    node --check "src\ai-vision-lab\geminiVisionService.js"
    node --check "src\server.js"
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " GMX AI VISION LAB R1 INSTALADO" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "1) Edita: $Env"
Write-Host "2) Coloca tus claves:"
Write-Host "   OPENAI_API_KEY=..."
Write-Host "   GEMINI_API_KEY=..."
Write-Host ""
Write-Host "3) Reinicia GMX:"
Write-Host "   cd `"$ProjectRoot`""
Write-Host "   npm run dev"
Write-Host ""
Write-Host "4) Abre:"
Write-Host "   http://127.0.0.1:8787/ai-vision-lab"
Write-Host ""
Write-Host "Backup:"
Write-Host "   $Backup"
Write-Host ""
Write-Host "No modifica BD, inventario, OCR actual ni flujo TCG existente." -ForegroundColor Yellow
