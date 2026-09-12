import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeWithOpenAI } from "../ai-vision-lab/openaiVisionService.js";
import { analyzeWithGemini } from "../ai-vision-lab/geminiVisionService.js";
import { compareVisionResults } from "../ai-vision-lab/visionCommon.js";
import { analyzeLocalCard } from "../ai-vision-lab/localVisionService.js";

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
router.post("/analyze/local",
  express.raw({ type: ["image/jpeg","image/png","image/webp"], limit: "12mb" }),
  async (req,res)=>{
    try{
      if(!Buffer.isBuffer(req.body) || !req.body.length){
        return res.status(400).json({success:false,error:"IMAGE_REQUIRED"});
      }
      const data=await analyzeLocalCard(req.body,req.headers["content-type"] || "image/jpeg");
      res.json({success:true,data});
    }catch(e){
      res.status(500).json({success:false,error:e?.message || "LOCAL_ANALYSIS_FAILED"});
    }
  }
);

router.get("/local/status", async (_req,res)=>{
  let ollama=false, models=[];
  try{
    const r=await fetch("http://127.0.0.1:11434/api/tags",{signal:AbortSignal.timeout(900)});
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
      ollama_model:process.env.OLLAMA_VISION_MODEL || "qwen2.5vl:3b",
      installed_models:models
    }
  });
});


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
