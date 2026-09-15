import { brandText } from "../config/brand.js";import { Router } from 'express';
import { rateLimit } from '../middleware/rateLimit.js';
import { ensureIntegritySchemaR42_2, auditCatalogIntegrityR42_2, providerStatusR42_2 } from '../tcgProviderIntegrityR42_2.js';
import { startTcgAddJob, getTcgAddJob } from '../tcgSyncJobService.js';
import {
  listSyncProviders, getSyncSets, updateSyncConfig, syncGameSets, syncSelectedCards,
  installSelectedToOperational, cardPriceComparison, listSyncedMasterCards,
  masterCatalogSummary, masterCatalogSets, browseMasterCatalogCards, masterCatalogRarities,
  listAvailableSources, getSourcePreferences, saveSourcePreferences,
  getTcgExchangeRate, saveTcgExchangeRate
} from
'../tcgCatalogSyncService.js';

const router = Router();
const known = new Set([
'SYNC_PROVIDER_NOT_CONFIGURED', 'PROVIDER_CARDS_NOT_AVAILABLE', 'SELECT_AT_LEAST_ONE_SET',
'MASTER_GAME_NOT_FOUND', 'MASTER_CARD_NOT_FOUND', 'SET_NOT_FOUND_IN_MASTER']
);

function sendError(res, e) {
  const msg = String(e?.message || e || 'SYNC_FAILED').replace(/[\r\n\t]+/g, ' ').slice(0, 900);
  console.error(brandText("[GMX][TCG-SYNC]"), msg, e?.stack || '');
  const knownCode = known.has(msg) || msg.startsWith('UNKNOWN_SET:');
  const remote =
  msg.startsWith('REMOTE_') ||
  msg.startsWith('POKEMON_SET_SYNC_UNAVAILABLE:');
  const status = knownCode ? 400 : remote ? 502 : 500;
  res.status(status).json({
    success: false,
    error: knownCode ? msg : remote ? 'TCG_SYNC_REMOTE_FAILED' : 'TCG_SYNC_FAILED',
    // This is an authenticated admin endpoint. Return a bounded diagnostic so
    // the UI does not hide actionable PostgreSQL/provider errors.
    message: knownCode ? msg : msg
  });
}


router.post('/games/:gameCode/add-job', rateLimit({ keyPrefix: 'TCG_ADD_JOB', max: 5 }), async (req, res) => {
  try {
    const data = startTcgAddJob(String(req.params.gameCode || '').toUpperCase(), {
      setCodes: Array.isArray(req.body?.setCodes) ? req.body.setCodes : [],
      downloadImages: req.body?.downloadImages === true,
      syncPrices: req.body?.syncPrices !== false,
      incremental: req.body?.incremental !== false
    });
    res.status(202).json({ success: true, data });
  } catch (e) {sendError(res, e);}
});

router.get('/jobs/:jobId', async (req, res) => {
  try {
    const data = getTcgAddJob(String(req.params.jobId || ''));
    if (!data) return res.status(404).json({ success: false, error: 'SYNC_JOB_NOT_FOUND' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (e) {sendError(res, e);}
});


router.get('/master-catalog/summary', async (_req, res) => {
  try {
    const r = await masterCatalogSummary();
    res.json({ success: true, data: r.rows });
  } catch (e) {sendError(res, e);}
});

router.get('/master-catalog/sets', async (req, res) => {
  try {
    const r = await masterCatalogSets(
      String(req.query.gameCode || '').toUpperCase(),
      String(req.query.search || '')
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {sendError(res, e);}
});

router.get('/master-catalog/rarities', async (req, res) => {
  try {
    const r = await masterCatalogRarities(
      String(req.query.gameCode || '').toUpperCase(),
      String(req.query.setCode || ''),
      String(req.query.search || '')
    );
    res.json({ success: true, data: r.rows });
  } catch (e) {sendError(res, e);}
});

router.get('/master-catalog/cards', async (req, res) => {
  try {
    const data = await browseMasterCatalogCards({
      gameCode: String(req.query.gameCode || '').toUpperCase(),
      setCode: String(req.query.setCode || ''),
      rarity: String(req.query.rarity || ''),
      search: String(req.query.search || ''),
      page: Number(req.query.page || 1),
      pageSize: Number(req.query.pageSize || 60)
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (e) {sendError(res, e);}
});

router.get('/providers', async (_req, res) => {
  try {
    const r = await listSyncProviders();
    res.json({ success: true, data: r.rows });
  } catch (e) {sendError(res, e);}
});


router.get('/games/:gameCode/sources', async (req, res) => {
  try {
    const gameCode = String(req.params.gameCode || '').toUpperCase();
    res.json({ success: true, data: {
        available: listAvailableSources(gameCode),
        preferences: await getSourcePreferences(gameCode)
      } });
  } catch (e) {sendError(res, e);}
});

router.put('/games/:gameCode/sources', async (req, res) => {
  try {
    const gameCode = String(req.params.gameCode || '').toUpperCase();
    const data = await saveSourcePreferences(gameCode, req.body || {});
    res.json({ success: true, data });
  } catch (e) {sendError(res, e);}
});

router.get('/games/:gameCode/sets', async (req, res) => {
  try {
    const r = await getSyncSets(String(req.params.gameCode || '').toUpperCase());
    res.json({ success: true, data: r.rows });
  } catch (e) {sendError(res, e);}
});

router.put('/games/:gameCode/config', async (req, res) => {
  try {
    const data = await updateSyncConfig(String(req.params.gameCode || '').toUpperCase(), req.body || {});
    res.json({ success: true, data });
  } catch (e) {sendError(res, e);}
});

router.post('/games/:gameCode/sync-sets', rateLimit({ keyPrefix: 'TCG_SYNC_SETS', max: 20 }), async (req, res) => {
  try {
    const data = await syncGameSets(String(req.params.gameCode || '').toUpperCase());
    res.json({ success: true, data });
  } catch (e) {sendError(res, e);}
});

router.post('/games/:gameCode/sync-cards', rateLimit({ keyPrefix: 'TCG_SYNC_CARDS', max: 10 }), async (req, res) => {
  try {
    const data = await syncSelectedCards(String(req.params.gameCode || '').toUpperCase(), {
      setCodes: Array.isArray(req.body?.setCodes) ? req.body.setCodes : [],
      downloadImages: req.body?.downloadImages === true,
      syncPrices: req.body?.syncPrices !== false,
      incremental: req.body?.incremental !== false
    });
    res.json({ success: true, data });
  } catch (e) {sendError(res, e);}
});

router.post('/games/:gameCode/install', rateLimit({ keyPrefix: 'TCG_INSTALL_SET', max: 20 }), async (req, res) => {
  try {
    const data = await installSelectedToOperational(
      String(req.params.gameCode || '').toUpperCase(),
      Array.isArray(req.body?.setCodes) ? req.body.setCodes : []
    );
    res.json({ success: true, data });
  } catch (e) {sendError(res, e);}
});

router.get('/cards', async (req, res) => {
  try {
    const r = await listSyncedMasterCards({
      gameCode: String(req.query.gameCode || '').toUpperCase(),
      setCode: String(req.query.setCode || ''),
      search: String(req.query.search || ''),
      limit: Number(req.query.limit || 100)
    });
    res.json({ success: true, data: r.rows });
  } catch (e) {sendError(res, e);}
});

router.get('/cards/:rowId/prices', async (req, res) => {
  try {
    res.json({ success: true, data: await cardPriceComparison(Number(req.params.rowId)) });
  } catch (e) {sendError(res, e);}
});


router.get('/games/:gameCode/fx',async(req,res)=>{
  try{
    res.json({success:true,data:await getTcgExchangeRate(req.params.gameCode)});
  }catch(e){
    res.status(400).json({success:false,error:e.message,message:e.message});
  }
});

router.put('/games/:gameCode/fx',async(req,res)=>{
  try{
    res.json({success:true,data:await saveTcgExchangeRate(req.params.gameCode,req.body||{})});
  }catch(e){
    const code=String(e.message||e);
    const message=code==='INVALID_TCG_FX_RATE'
      ?'El TDC por TCG debe ser mayor a cero.'
      :code;
    res.status(400).json({success:false,error:message,message});
  }
});

/* GMX_R42_2_INTEGRITY_ROUTES */
router.get('/providers-r42/status', async (_req,res) => {
  try {
    const data = await providerStatusR42_2();
    res.setHeader('Cache-Control','no-store');
    res.json({success:true,data});
  } catch (e) { sendError(res,e); }
});

router.post('/integrity/schema', rateLimit({keyPrefix:'TCG_INTEGRITY_SCHEMA',max:5}), async (_req,res) => {
  try {
    const data = await ensureIntegritySchemaR42_2();
    res.json({success:true,data});
  } catch (e) { sendError(res,e); }
});

router.post('/integrity/:gameCode/audit', rateLimit({keyPrefix:'TCG_INTEGRITY_AUDIT',max:10}), async (req,res) => {
  try {
    const data = await auditCatalogIntegrityR42_2(
      String(req.params.gameCode||'').toUpperCase(),
      {repairImages:req.body?.repairImages===true}
    );
    res.json({success:true,data});
  } catch (e) { sendError(res,e); }
});
export default router;
