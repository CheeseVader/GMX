import { brandText } from "../config/brand.js";import { Router } from 'express';

import { discoverYgoCards } from '../tcgInternetDiscoveryService.js';
import {
  listGames, listSets, listRarities, listCards, createCatalog, updateCatalog,
  listInventory, listAcquisitions, receiveInventory, receiveInventoryBulk, updateInventoryCommercialData,
  listMasterGames, listMasterSets, listMasterRarities, activateMasterGame, updateGameVisibility } from
'../repositories/tcgRepository.js';
import {
  importCardsWorkbook, importTcgMasterWorkbook, buildDynamicImportTemplate,
  parseTcgReceiptWorkbook, buildTcgReceiptTemplate } from
'../excelImportService.js';

const router = Router();



router.get('/template.xlsx', async (_req, res) => {try {
    const buffer = await buildDynamicImportTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="SHINY_Plantillas_Importacion_Dinamica.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (_e) {res.status(500).json({ success: false, error: 'DYNAMIC_TEMPLATE_FAILED' });}});

router.get('/master/games', async (_req, res) => {try {const r = await listMasterGames();res.json({ success: true, data: r.rows });} catch (_e) {res.status(500).json({ success: false, error: 'TCG_MASTER_GAMES_FAILED' });}});
router.get('/master/sets', async (req, res) => {try {const r = await listMasterSets(String(req.query.gameCode || ''));res.json({ success: true, data: r.rows });} catch (_e) {res.status(500).json({ success: false, error: 'TCG_MASTER_SETS_FAILED' });}});
router.get('/master/rarities', async (req, res) => {try {const r = await listMasterRarities(String(req.query.gameCode || ''));res.json({ success: true, data: r.rows });} catch (_e) {res.status(500).json({ success: false, error: 'TCG_MASTER_RARITIES_FAILED' });}});
router.post('/master/games/:code/activate', async (req, res) => {try {
    res.json({ success: true, data: await activateMasterGame(String(req.params.code || '').toUpperCase(), { visiblePortal: req.body?.visiblePortal === true }) });
  } catch (e) {res.status(400).json({ success: false, error: e.message });}});
router.put('/games/:rowId/visibility', async (req, res) => {try {
    const data = await updateGameVisibility(Number(req.params.rowId), req.body || {});
    if (!data) return res.status(404).json({ success: false, error: 'GAME_NOT_FOUND' });
    res.json({ success: true, data });
  } catch (_e) {res.status(400).json({ success: false, error: 'GAME_VISIBILITY_UPDATE_FAILED' });}});
router.post('/imports/master', async (req, res) => {try {
    res.json({ success: true, data: await importTcgMasterWorkbook(req.body?.file || {}, req.user?.email || '') });
  } catch (e) {res.status(400).json({ success: false, error: e.message });}});
router.post('/imports/cards', async (req, res) => {try {
    res.json({ success: true, data: await importCardsWorkbook(req.body?.file || {}, req.user?.email || '') });
  } catch (e) {res.status(400).json({ success: false, error: e.message });}});

router.get('/games', async (_req, res) => {try {const r = await listGames();res.json({ success: true, data: r.rows });} catch (e) {res.status(500).json({ success: false, error: e.message });}});
router.get('/sets', async (req, res) => {try {const r = await listSets(String(req.query.gameId || ''));res.json({ success: true, data: r.rows });} catch (e) {res.status(500).json({ success: false, error: e.message });}});
router.get('/rarities', async (req, res) => {try {const r = await listRarities(String(req.query.gameId || ''));res.json({ success: true, data: r.rows });} catch (e) {res.status(500).json({ success: false, error: e.message });}});
router.get('/cards', async (req, res) => {try {const r = await listCards(req.query);res.json({ success: true, data: r.rows });} catch (e) {res.status(500).json({ success: false, error: e.message });}});
router.get('/inventory', async (req, res) => {try {const r = await listInventory(req.query);res.json({ success: true, data: r.rows });} catch (e) {res.status(500).json({ success: false, error: e.message });}});
router.get('/acquisitions', async (req, res) => {try {const r = await listAcquisitions(req.query);res.json({ success: true, data: r.rows });} catch (e) {res.status(500).json({ success: false, error: e.message });}});

router.post('/catalog/:kind', async (req, res) => {
  try {
    const r = await createCatalog(req.params.kind, req.body || {});
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) {res.status(400).json({ success: false, error: e.message, message: e.message });}
});
router.put('/catalog/:kind/:rowId', async (req, res) => {
  try {
    const r = await updateCatalog(req.params.kind, Number(req.params.rowId), req.body || {});
    if (!r.rowCount) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {res.status(400).json({ success: false, error: e.message, message: e.message });}
});

router.patch('/inventory/:inventoryId/commercial', async (req, res) => {
  try {
    const data = await updateInventoryCommercialData(
      req.params.inventoryId,
      req.body || {}
    );

    if (!data)
    return res.status(404).json({
      success: false,
      error: 'INVENTORY_NOT_FOUND'
    });

    res.json({
      success: true,
      data
    });

  } catch (e) {
    res.status(400).json({
      success: false,
      error: e.message,
      message: e.message
    });
  }
});

router.post('/inventory/receive', async (req, res) => {
  try {res.status(201).json({ success: true, data: await receiveInventory(req.body || {}) });}
  catch (e) {res.status(400).json({ success: false, error: e.message, message: e.message });}
});


router.get('/inventory/receipt-template.xlsx', async (_req, res) => {
  try {
    const buffer = await buildTcgReceiptTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="SHINY_TCG_Recepcion_Masiva.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (e) {
    console.error(brandText("[GMX][TCG_RECEIPT_TEMPLATE]"), e);
    res.status(500).json({ success: false, error: 'TCG_RECEIPT_TEMPLATE_FAILED' });
  }
});

router.post('/inventory/receipt-parse', async (req, res) => {
  try {
    res.json({ success: true, data: parseTcgReceiptWorkbook(req.body?.file || {}) });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message, message: e.message });
  }
});

router.post('/inventory/receive-bulk', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length > 500) return res.status(400).json({
      success: false, error: 'BULK_CHUNK_TOO_LARGE',
      message: 'El bloque interno excede 500 filas. El archivo completo debe procesarse por bloques.'
    });
    res.json({ success: true, data: await receiveInventoryBulk({
        rows,
        sourceType: req.body?.sourceType || 'ADQUISICION'
      }) });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message, message: e.message });
  }
});


router.post('/vision/internet-discovery', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const queries = Array.isArray(req.body?.queries) ? req.body.queries : [];
    const hints = req.body?.hints && typeof req.body.hints === 'object' ? req.body.hints : {};
    const game = String(req.body?.game || 'AUTO').trim().toUpperCase();

    if (!text && !queries.length) {
      return res.status(400).json({ success: false, error: 'VISION_QUERY_REQUIRED' });
    }

    // VISION-002A: YGO first. AUTO currently tries YGO as the first external provider.
    if (!['AUTO', 'YGO', 'YU-GI-OH!', 'YUGIOH'].includes(game)) {
      return res.json({ success: true, data: { provider: null, game, results: [], unsupported: true } });
    }

    const data = await discoverYgoCards({
      text,
      queries,
      hints,
      limit: Number(req.body?.limit || 8)
    });

    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: 'VISION_INTERNET_DISCOVERY_FAILED',
      message: String(e?.message || e)
    });
  }
});
export default router;
