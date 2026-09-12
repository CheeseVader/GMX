param(
    [string]$ProjectRoot = "C:\Users\igarcia\Videos\GMX"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Info($m){ Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[AVISO] $m" -ForegroundColor Yellow }

$utf8 = New-Object System.Text.UTF8Encoding($false)
function ReadText([string]$p){ [IO.File]::ReadAllText($p) }
function WriteText([string]$p,[string]$t){
    $dir=[IO.Path]::GetDirectoryName($p)
    if($dir -and !(Test-Path $dir)){ New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [IO.File]::WriteAllText($p,$t,$utf8)
}
function BackupFile([string]$p){
    if(!(Test-Path $p)){ return }
    $rel=$p.Substring($ProjectRoot.Length).TrimStart('\')
    $dst=Join-Path $Backup $rel
    $dd=[IO.Path]::GetDirectoryName($dst)
    if(!(Test-Path $dd)){ New-Item -ItemType Directory -Force -Path $dd | Out-Null }
    Copy-Item $p $dst -Force
}

$Backend = Join-Path $ProjectRoot "backend"
$Server  = Join-Path $Backend "src\server.js"
$Route   = Join-Path $Backend "src\routes\aiVisionLab.js"
$LocalService = Join-Path $Backend "src\ai-vision-lab\localVisionService.js"
$Public  = Join-Path $Backend "src\ai-vision-lab\public"
$Index   = Join-Path $Public "index.html"
$Pkg     = Join-Path $Backend "package.json"

foreach($p in @($Backend,$Server,$Route,$Pkg)){
    if(!(Test-Path $p)){ throw "No existe: $p" }
}

$stamp=Get-Date -Format "yyyyMMdd-HHmmss"
$Backup=Join-Path $ProjectRoot "BACKUP-AI-VISION-LAB-LOCAL-R2-$stamp"
New-Item -ItemType Directory -Force -Path $Backup | Out-Null

Info "Creando respaldo"
foreach($f in @($Server,$Route,$LocalService,$Index,$Pkg)){
    BackupFile $f
}
Ok "Backup: $Backup"

Info "Verificando Tesseract.js local en backend"
$pkgText=ReadText $Pkg
if($pkgText -notmatch '"tesseract\.js"'){
    Push-Location $ProjectRoot
    try {
        npm install tesseract.js --prefix backend
        if($LASTEXITCODE -ne 0){ throw "npm install tesseract.js fallo." }
    } finally { Pop-Location }
    Ok "tesseract.js instalado en backend."
}else{
    Ok "tesseract.js ya existe en backend."
}

Info "Instalando motor LOCAL: OCR + Ollama opcional + catalogo GMX"
$localJs = @'
import { createWorker } from 'tesseract.js';
import { listCards } from '../repositories/tcgRepository.js';

function clean(v=''){ return String(v ?? '').trim(); }
function compact(v=''){
  return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]/g,'');
}
function words(v=''){
  return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
}
function similarity(a,b){
  const A=compact(a), B=compact(b);
  if(!A || !B) return 0;
  if(A===B) return 1;
  if(A.includes(B) || B.includes(A)) return Math.min(A.length,B.length)/Math.max(A.length,B.length);
  const wa=new Set(words(a)), wb=new Set(words(b));
  let inter=0; for(const x of wa) if(wb.has(x)) inter++;
  const union=new Set([...wa,...wb]).size || 1;
  return inter/union;
}
function likelyCode(s=''){
  const t=clean(s).toUpperCase();
  const m=t.match(/\b[A-Z0-9]{2,8}[- ][A-Z0-9]{2,8}\b/);
  return m ? m[0].replace(/\s+/g,'-') : '';
}
function usefulLines(text=''){
  return String(text).split(/\r?\n/).map(x=>x.trim())
    .filter(x=>x.length>=2 && x.length<=90)
    .filter(x=>/[A-Za-zÀ-ÿ0-9]/.test(x));
}
function titleCandidates(lines){
  const bad=/^(ATK|DEF|HP|BASIC|STAGE|TRAINER|ENERGY|SPELL|TRAP|MONSTER|CARTA|MAGICA|MÁGICA|TRAMPA|CRIATURA|INSTANT|SORCERY|ENCHANTMENT|LAND)\b/i;
  return lines.slice(0,18)
    .filter(x=>!bad.test(x))
    .filter(x=>x.replace(/[^A-Za-zÀ-ÿ]/g,'').length>=3)
    .sort((a,b)=>{
      const as=(a.length>=4&&a.length<=45?2:0)+(a===a.toUpperCase()?0.2:0);
      const bs=(b.length>=4&&b.length<=45?2:0)+(b===b.toUpperCase()?0.2:0);
      return bs-as;
    }).slice(0,8);
}

async function runOcr(buffer){
  const worker=await createWorker(['spa','eng']);
  try{
    const r=await worker.recognize(buffer);
    return {
      text: clean(r?.data?.text),
      confidence: Number(r?.data?.confidence || 0),
      lines: usefulLines(r?.data?.text || '')
    };
  } finally {
    await worker.terminate();
  }
}

async function localCatalog(ocr){
  const lines=ocr.lines || [];
  const names=titleCandidates(lines);
  const code=lines.map(likelyCode).find(Boolean) || '';
  const queries=[...new Set(names.slice(0,5))];

  let rows=[];
  for(const q of queries){
    try{
      const r=await listCards({search:q,limit:60});
      for(const row of (r?.rows || [])) rows.push(row);
    }catch{}
  }

  const seen=new Set(), scored=[];
  for(const row of rows){
    const key=clean(row.id_carta || row.external_id || `${row.nombre||row.name}|${row.codigo||row.collector_number||''}`);
    if(seen.has(key)) continue;
    seen.add(key);
    const cardName=clean(row.nombre || row.name || row.nombre_carta || '');
    const cardCode=clean(row.codigo || row.collector_number || row.numero_coleccion || row.set_code || '');
    let nameScore=0, observed='';
    for(const line of names){
      const s=similarity(line,cardName);
      if(s>nameScore){ nameScore=s; observed=line; }
    }
    const codeScore=code && cardCode && compact(code)===compact(cardCode) ? 1 : 0;
    const total=Math.min(1,(nameScore*0.78)+(codeScore*0.22));
    scored.push({
      score:Number(total.toFixed(4)),
      exact_name:compact(observed) && compact(observed)===compact(cardName),
      exact_code:!!codeScore,
      observed_name:observed,
      observed_code:code,
      card:row
    });
  }
  scored.sort((a,b)=>b.score-a.score);
  return {
    observed_name:names[0] || '',
    observed_code:code,
    candidates:scored.slice(0,12),
    confirmed:scored.length>0 && scored[0].score>=0.93 &&
      (scored[0].exact_name || scored[0].exact_code)
  };
}

async function ollamaVision(buffer,mimeType){
  const base='http://127.0.0.1:11434';
  const model=clean(process.env.OLLAMA_VISION_MODEL || 'qwen2.5vl:3b');
  try{
    const tags=await fetch(`${base}/api/tags`,{signal:AbortSignal.timeout(1200)});
    if(!tags.ok) throw new Error('OLLAMA_NOT_READY');
  }catch{
    return {available:false,model,error:'OLLAMA_NO_DISPONIBLE'};
  }
  const prompt=`Analiza esta carta TCG SIN INTERNET. Primero transcribe literalmente lo visible.
No autocorrijas nombres. Mantén observación e identificación separadas.
Devuelve SOLO JSON:
{"printed_name":"","collector_number":"","set_code":"","language":"","tcg":"","proposed_identity":"","ambiguous":true,"notes":""}`;
  try{
    const r=await fetch(`${base}/api/chat`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model, stream:false, format:'json',
        messages:[{role:'user',content:prompt,images:[buffer.toString('base64')]}],
        options:{temperature:0}
      }),
      signal:AbortSignal.timeout(120000)
    });
    const txt=await r.text();
    if(!r.ok) return {available:true,model,error:`OLLAMA_${r.status}: ${txt.slice(0,500)}`};
    const j=JSON.parse(txt);
    let data={};
    try{ data=JSON.parse(j?.message?.content || '{}'); }catch{ data={raw:j?.message?.content || ''}; }
    return {available:true,model,data};
  }catch(e){
    return {available:true,model,error:e.message};
  }
}

export async function analyzeLocalCard(buffer,mimeType='image/jpeg'){
  const started=Date.now();
  const ocr=await runOcr(buffer);
  const catalog=await localCatalog(ocr);
  const vision=await ollamaVision(buffer,mimeType);
  return {
    provider:'LOCAL',
    cost:'$0',
    api_key_required:false,
    internet_required:false,
    elapsed_ms:Date.now()-started,
    ocr,
    catalog,
    vision
  };
}
'@
WriteText $LocalService $localJs

Info "Actualizando ruta AI Vision Lab"
$routeText=ReadText $Route
if($routeText -notmatch "analyzeLocalCard"){
    if($routeText -match "import express from 'express';"){
        $routeText=$routeText.Replace(
            "import express from 'express';",
            "import express from 'express';`r`nimport { analyzeLocalCard } from '../ai-vision-lab/localVisionService.js';"
        )
    } elseif($routeText -match 'import express from "express";'){
        $routeText=$routeText.Replace(
            'import express from "express";',
            'import express from "express";'+"`r`n"+"import { analyzeLocalCard } from '../ai-vision-lab/localVisionService.js';"
        )
    } else {
        $routeText="import { analyzeLocalCard } from '../ai-vision-lab/localVisionService.js';`r`n"+$routeText
    }

    $anchor="router.get('/status'"
    $pos=$routeText.IndexOf($anchor)
    if($pos -lt 0){ throw "No encontre router.get('/status' en aiVisionLab.js" }

    $block=@'

router.post('/analyze/local',
  express.raw({ type: ['image/jpeg','image/png','image/webp'], limit: '12mb' }),
  async (req,res)=>{
    try{
      if(!Buffer.isBuffer(req.body) || !req.body.length){
        return res.status(400).json({success:false,error:'IMAGE_REQUIRED'});
      }
      const data=await analyzeLocalCard(req.body,req.headers['content-type'] || 'image/jpeg');
      res.json({success:true,data});
    }catch(e){
      res.status(500).json({success:false,error:e?.message || 'LOCAL_ANALYSIS_FAILED'});
    }
  }
);

router.get('/local/status', async (_req,res)=>{
  let ollama=false, models=[];
  try{
    const r=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(900)});
    if(r.ok){
      const j=await r.json();
      ollama=true;
      models=(j?.models || []).map(x=>x.name).slice(0,50);
    }
  }catch{}
  res.json({
    success:true,
    data:{
      local_ocr:true,
      api_key_required:false,
      internet_required:false,
      ollama,
      ollama_model:process.env.OLLAMA_VISION_MODEL || 'qwen2.5vl:3b',
      installed_models:models
    }
  });
});

'@
    $routeText=$routeText.Insert($pos,$block)
    WriteText $Route $routeText
    Ok "Rutas /analyze/local y /local/status agregadas."
}else{
    Warn "La ruta local ya parece estar instalada; no se duplico."
}

Info "Agregando alias /api/v1/ai-vision-lab"
$serverText=ReadText $Server
if($serverText -match "aiVisionLabRouter"){
    if($serverText -notmatch "app\.use\('/api/v1/ai-vision-lab',\s*aiVisionLabRouter\)"){
        $old="app.use('/ai-vision-lab', aiVisionLabRouter);"
        if($serverText.Contains($old)){
            $serverText=$serverText.Replace($old,$old+"`r`n"+"app.use('/api/v1/ai-vision-lab', aiVisionLabRouter);")
        }else{
            $marker="if (process.env.NODE_ENV === 'production') {"
            if($serverText.Contains($marker)){
                $serverText=$serverText.Replace($marker,"app.use('/api/v1/ai-vision-lab', aiVisionLabRouter);`r`n`r`n"+$marker)
            }
        }
    }
    if($serverText -match 'camera=\(\)'){
        $serverText=$serverText -replace 'camera=\(\)','camera=(self)'
    }
    WriteText $Server $serverText
    Ok "Backend actualizado."
}else{
    throw "server.js no contiene aiVisionLabRouter. Ejecuta primero R1 o restaura su integracion."
}

Info "Reemplazando interfaz standalone por modo LOCAL GRATIS"
$html=@'
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>GMX · AI Vision Lab LOCAL</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,Segoe UI,Arial;background:#081121;color:#f6f8ff}
*{box-sizing:border-box} body{margin:0;background:#081121} .wrap{max-width:1500px;margin:auto;padding:20px}
h1{margin:0;font-size:28px}.sub{color:#aeb8cb;margin:6px 0 18px}.badge{border:1px solid #2e476c;border-radius:999px;padding:8px 12px;font-size:12px}
.top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
.grid{display:grid;grid-template-columns:320px 1fr;gap:18px}.card{background:#0b1629;border:1px solid #29405f;border-radius:16px;padding:18px}
.preview{height:480px;border:1px dashed #375578;border-radius:14px;display:grid;place-items:center;overflow:hidden;background:#07101f}
.preview img,.preview video{max-width:100%;max-height:100%;object-fit:contain}.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
button,.filebtn{border:0;border-radius:11px;padding:12px 10px;font-weight:800;cursor:pointer;text-align:center;background:#3559d9;color:white}
.secondary{background:#182944}.green{background:#17a45b}.purple{background:#7445d8}.orange{background:#d97706}.wide{grid-column:1/-1}
button:disabled{opacity:.45;cursor:not-allowed} input[type=file]{display:none}.panels{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.panel{border:1px solid #29405f;border-radius:14px;padding:16px;min-height:250px}.panel h2{margin:0 0 10px;font-size:18px}
.muted{color:#98a5ba}.ok{color:#45d483}.warn{color:#ffbd52}.err{color:#ff6b6b}.mono{white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:12px}
.result{display:grid;gap:7px}.candidate{border:1px solid #263b59;border-radius:10px;padding:10px;margin-top:8px}
.score{font-weight:900}.statusrow{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.small{font-size:12px}
@media(max-width:900px){.grid{grid-template-columns:1fr}.preview{height:420px}.panels{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div><h1>GMX · AI Vision Lab LOCAL</h1><div class="sub">100% local · sin API key · sin créditos · OCR literal + catálogo GMX + visión Ollama opcional</div></div>
    <div id="statusBadge" class="badge">Comprobando motor local…</div>
  </div>

  <div class="grid">
    <section class="card">
      <div class="preview" id="preview"><span class="muted">Selecciona o toma una foto</span></div>
      <div class="actions">
        <label class="filebtn secondary">🖼 Seleccionar
          <input id="fileInput" type="file" accept="image/jpeg,image/png,image/webp"/>
        </label>
        <label class="filebtn secondary">📷 Tomar foto
          <input id="cameraInput" type="file" accept="image/*" capture="environment"/>
        </label>
        <button id="webcamBtn" class="secondary">🎥 Abrir cámara</button>
        <button id="captureBtn" class="orange" disabled>📸 Capturar</button>
        <button id="analyzeBtn" class="green wide" disabled>🔍 IDENTIFICAR CARTA GRATIS</button>
      </div>
      <div class="small muted" style="margin-top:12px">
        El OCR y el catálogo se procesan localmente. Ollama es opcional y tampoco usa API key.
      </div>
    </section>

    <section class="card">
      <div class="statusrow">
        <span class="badge">OCR LOCAL ✓</span>
        <span class="badge">CATÁLOGO GMX ✓</span>
        <span id="ollamaBadge" class="badge">OLLAMA …</span>
      </div>
      <div class="panels">
        <div class="panel">
          <h2>Lectura literal</h2>
          <div id="ocr" class="muted">Esperando imagen.</div>
        </div>
        <div class="panel">
          <h2>Identificación / catálogo</h2>
          <div id="catalog" class="muted">Esperando imagen.</div>
        </div>
        <div class="panel">
          <h2>Visión local (Ollama)</h2>
          <div id="vision" class="muted">Opcional. Si Ollama no está instalado, el OCR + catálogo siguen funcionando.</div>
        </div>
        <div class="panel">
          <h2>Resultado final</h2>
          <div id="final" class="muted">Sin resultado.</div>
        </div>
      </div>
    </section>
  </div>
</div>
<script>
const $=s=>document.querySelector(s);
let file=null, stream=null, video=null;

async function localStatus(){
  try{
    const r=await fetch('/ai-vision-lab/local/status');
    const j=await r.json();
    const d=j.data||{};
    $('#statusBadge').textContent='LOCAL $0 ✓ · sin API key';
    $('#ollamaBadge').textContent=d.ollama?`OLLAMA ✓ ${d.ollama_model}`:'OLLAMA opcional · no detectado';
    $('#ollamaBadge').className='badge '+(d.ollama?'ok':'warn');
  }catch(e){
    $('#statusBadge').textContent='Motor local no disponible';
    $('#statusBadge').className='badge err';
  }
}

function setFile(f){
  file=f;
  $('#analyzeBtn').disabled=!file;
  if(stream) stopCamera();
  if(!file){ $('#preview').innerHTML='<span class="muted">Selecciona o toma una foto</span>'; return; }
  const u=URL.createObjectURL(file);
  $('#preview').innerHTML=`<img src="${u}" alt="Carta"/>`;
}

$('#fileInput').onchange=e=>setFile(e.target.files?.[0]||null);
$('#cameraInput').onchange=e=>setFile(e.target.files?.[0]||null);

async function openCamera(){
  try{
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('CAMARA_NO_DISPONIBLE');
    stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false
    });
    video=document.createElement('video'); video.autoplay=true; video.playsInline=true; video.muted=true;
    video.srcObject=stream; $('#preview').innerHTML=''; $('#preview').appendChild(video);
    $('#captureBtn').disabled=false;
  }catch(e){
    alert('No fue posible abrir la cámara. En celular/tablet usa “Tomar foto”. Para webcam remota usa HTTPS o localhost.');
  }
}
function stopCamera(){
  if(stream){ for(const t of stream.getTracks())t.stop(); }
  stream=null; video=null; $('#captureBtn').disabled=true;
}
$('#webcamBtn').onclick=openCamera;
$('#captureBtn').onclick=async()=>{
  if(!video)return;
  const c=document.createElement('canvas'); c.width=video.videoWidth||1280;c.height=video.videoHeight||720;
  c.getContext('2d').drawImage(video,0,0,c.width,c.height);
  const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.94));
  setFile(new File([blob],'captura-gmx.jpg',{type:'image/jpeg'}));
};

function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function cardName(c){return c?.nombre||c?.name||c?.nombre_carta||'(sin nombre)';}
function cardCode(c){return c?.codigo||c?.collector_number||c?.numero_coleccion||c?.set_code||'';}

$('#analyzeBtn').onclick=async()=>{
  if(!file)return;
  $('#analyzeBtn').disabled=true; $('#analyzeBtn').textContent='Analizando localmente…';
  $('#ocr').innerHTML='<span class="muted">Ejecutando Tesseract local…</span>';
  $('#catalog').innerHTML='<span class="muted">Buscando en catálogo GMX…</span>';
  $('#vision').innerHTML='<span class="muted">Comprobando Ollama…</span>';
  $('#final').innerHTML='<span class="muted">Procesando…</span>';
  try{
    const r=await fetch('/ai-vision-lab/analyze/local',{
      method:'POST',headers:{'Content-Type':file.type||'image/jpeg'},body:file
    });
    const j=await r.json();
    if(!r.ok||!j.success)throw new Error(j.error||`HTTP ${r.status}`);
    const d=j.data||{}, o=d.ocr||{}, c=d.catalog||{}, v=d.vision||{};
    $('#ocr').innerHTML=`<div class="result">
      <div><b>Confianza OCR:</b> ${Number(o.confidence||0).toFixed(1)}%</div>
      <div><b>Nombre observado:</b> ${esc(c.observed_name||'No determinado')}</div>
      <div><b>Código observado:</b> ${esc(c.observed_code||'No detectado')}</div>
      <div class="mono">${esc(o.text||'Sin texto')}</div></div>`;
    const rows=c.candidates||[];
    $('#catalog').innerHTML=rows.length?rows.map((x,i)=>`<div class="candidate">
      <div class="score">#${i+1} · ${(x.score*100).toFixed(1)}%</div>
      <div><b>${esc(cardName(x.card))}</b></div>
      <div>${esc(cardCode(x.card))}</div>
      <div class="small">Nombre exacto: ${x.exact_name?'✓':'—'} · Código exacto: ${x.exact_code?'✓':'—'}</div>
    </div>`).join(''):'<span class="warn">No hubo coincidencias suficientes en el catálogo local.</span>';
    if(v.available && v.data){
      $('#vision').innerHTML=`<div class="mono">${esc(JSON.stringify(v.data,null,2))}</div>`;
    }else{
      $('#vision').innerHTML=`<span class="warn">${esc(v.error||'Ollama no instalado. Esto no bloquea OCR + catálogo.')}</span>`;
    }
    const best=rows[0];
    if(c.confirmed && best){
      $('#final').innerHTML=`<div class="ok"><b>✓ CARTA CONFIRMADA</b></div>
        <h2>${esc(cardName(best.card))}</h2>
        <div>${esc(cardCode(best.card))}</div>
        <div class="small">Puntuación ${(best.score*100).toFixed(1)}%. Confirmación basada en OCR literal + catálogo GMX.</div>`;
    }else if(best){
      $('#final').innerHTML=`<div class="warn"><b>REVISIÓN NECESARIA</b></div>
        <h2>${esc(cardName(best.card))}</h2>
        <div class="small">Mejor coincidencia ${(best.score*100).toFixed(1)}%. GMX no la acepta automáticamente.</div>`;
    }else{
      $('#final').innerHTML='<span class="warn">No se pudo confirmar una identidad. GMX no inventará una carta.</span>';
    }
  }catch(e){
    $('#ocr').innerHTML=`<span class="err">${esc(e.message)}</span>`;
    $('#catalog').innerHTML='<span class="err">Análisis interrumpido.</span>';
    $('#final').innerHTML='<span class="err">No se confirmó ninguna carta.</span>';
  }finally{
    $('#analyzeBtn').disabled=!file; $('#analyzeBtn').textContent='🔍 IDENTIFICAR CARTA GRATIS';
  }
};
window.addEventListener('beforeunload',stopCamera);
localStatus();
</script>
</body>
</html>
'@
WriteText $Index $html
Ok "Interfaz LOCAL instalada."

Info "Agregando configuracion Ollama opcional"
foreach($envFile in @((Join-Path $Backend ".env"),(Join-Path $Backend ".env.example"))){
    if(!(Test-Path $envFile)){ WriteText $envFile "" }
    $t=ReadText $envFile
    if($t -notmatch '(?m)^OLLAMA_VISION_MODEL='){
        $t += "`r`n# AI Vision local opcional (sin API key)`r`nOLLAMA_VISION_MODEL=qwen2.5vl:3b`r`n"
        WriteText $envFile $t
    }
}
Ok "Configuración local lista."

Info "Validando JavaScript"
Push-Location $Backend
try{
    node --check "src\ai-vision-lab\localVisionService.js"
    if($LASTEXITCODE -ne 0){ throw "Error de sintaxis localVisionService.js" }
    node --check "src\routes\aiVisionLab.js"
    if($LASTEXITCODE -ne 0){ throw "Error de sintaxis aiVisionLab.js" }
    node --check "src\server.js"
    if($LASTEXITCODE -ne 0){ throw "Error de sintaxis server.js" }
}finally{ Pop-Location }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " GMX AI VISION LAB LOCAL R2 INSTALADO" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "MODO PRINCIPAL:" -ForegroundColor Cyan
Write-Host "  Tesseract OCR local       = GRATIS / SIN API KEY"
Write-Host "  Catalogo GMX local        = GRATIS / SIN API KEY"
Write-Host "  Ollama Vision (opcional)  = GRATIS / SIN API KEY"
Write-Host ""
Write-Host "OpenAI/Gemini ya NO son necesarios para este flujo." -ForegroundColor Yellow
Write-Host ""
Write-Host "Reinicia GMX:"
Write-Host "  cd `"$ProjectRoot`""
Write-Host "  npm run dev"
Write-Host ""
Write-Host "Abre:"
Write-Host "  http://127.0.0.1:8787/ai-vision-lab"
Write-Host ""
Write-Host "Si quieres vision local avanzada con Ollama, instala Ollama y luego un modelo visual."
Write-Host "El OCR + catalogo funcionan aunque Ollama no exista."
Write-Host ""
Write-Host "Backup:"
Write-Host "  $Backup"
Write-Host ""
Write-Host "No modifica inventario, ventas, POS ni datos TCG." -ForegroundColor Yellow
