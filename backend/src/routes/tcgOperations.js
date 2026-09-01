import { brandText } from "../config/brand.js";import { Router } from 'express';
import {
  listBranches, listInventory, listMovements, adjustStock, transferStock, scanAndMove,
  createCount, listCounts, getCount, captureCount, closeCount,
  createSale, listSales, saleDetail, bulkOperations, exportData, diagnostics } from
'../repositories/tcgOperationsRepository.js';

const router = Router();
const wrap = (fn) => async (req, res) => {
  try {res.json({ ok: true, data: await fn(req, res) });}
  catch (error) {
    console.error(brandText("[GMX][TCG10.3]"), error);
    res.status(400).json({ ok: false, error: error?.message || String(error) });
  }
};

router.get('/diagnostics', wrap(() => diagnostics()));
router.get('/branches', wrap(() => listBranches()));
router.get('/inventory', wrap((req) => listInventory(req.query)));
router.get('/movements', wrap((req) => listMovements(req.query)));
router.post('/adjust', wrap((req) => adjustStock(req.body || {})));
router.post('/transfer', wrap((req) => transferStock(req.body || {})));
router.post('/scan', wrap((req) => scanAndMove(req.body || {})));
router.get('/counts', wrap((req) => listCounts(req.query)));
router.post('/counts', wrap((req) => createCount(req.body || {})));
router.get('/counts/:id', wrap((req) => getCount(req.params.id)));
router.post('/counts/:id/capture', wrap((req) => captureCount({ ...(req.body || {}), idConteo: req.params.id })));
router.post('/counts/:id/close', wrap((req) => closeCount({ ...(req.body || {}), idConteo: req.params.id })));
router.get('/sales', wrap((req) => listSales(req.query)));
router.post('/sales', wrap((req) => createSale(req.body || {})));
router.get('/sales/:id', wrap((req) => saleDetail(req.params.id)));
router.post('/bulk', wrap((req) => bulkOperations(req.body || {})));
router.get('/export/:kind', wrap((req) => exportData(req.params.kind, req.query.limit)));

export default router;
