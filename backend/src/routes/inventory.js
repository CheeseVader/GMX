import { brandText } from "../config/brand.js";import { Router } from 'express';
import * as XLSX from 'xlsx';
import {
  listInventory,
  listMovements,
  adjustInventory,
  transferInventory,
  listTransfers } from
'../repositories/inventoryRepository.js';
import { buildInventoryEntryTemplate, importInventoryEntriesWorkbook } from '../excelImportService.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();
const isSuperadmin = (req) => String(req.access?.role || req.user?.rol || '').toUpperCase() === 'SUPERADMIN';
const safeInventoryRows = (rows, revealCost) => revealCost ? rows : rows.map(({ costo, ...row }) => row);

router.get('/', async (req, res) => {
  try {
    const branchId = String(req.query.branchId || '').trim();
    const search = String(req.query.search || '').trim();
    const category = String(req.query.category || '').trim();
    const stockStatus = String(req.query.stockStatus || 'all').trim().toLowerCase();
    const productStatus = String(req.query.productStatus || '').trim();
    const sort = String(req.query.sort || 'name').trim().toLowerCase();
    const direction = String(req.query.direction || 'asc').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const result = await listInventory({
      branchId, search, category, stockStatus, productStatus, sort, direction, limit, offset
    });

    res.json({
      success: true,
      data: safeInventoryRows(result.rows, isSuperadmin(req)),
      count: result.rowCount,
      total: result.total,
      summary: result.summary,
      limit, offset, ms: result.ms
    });
  } catch (error) {
    console.error(brandText("[GMX][INVENTORY_LIST]"), error);
    res.status(500).json({
      success: false, error: 'INVENTORY_LIST_FAILED', message: 'No fue posible consultar el inventario.'
    });
  }
});

router.get('/entry-template.xlsx', async (req, res) => {
  try {
    const buffer = await buildInventoryEntryTemplate({ includeCost: isSuperadmin(req) });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Plantilla_Entradas_Inventario.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ success: false, error: 'INVENTORY_TEMPLATE_FAILED', message: e.message });
  }
});

router.post('/import-entries', requirePermission('INVENTARIO', 'edit'), async (req, res) => {
  try {
    const data = await importInventoryEntriesWorkbook(
      req.body?.file || {}, req.user || {}, { includeCost: isSuperadmin(req) }
    );
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message === 'IMPORT_FILE_ALREADY_PROCESSED' ? 409 : 400;
    res.status(status).json({ success: false, error: e.message, message: e.message });
  }
});


/* SHINY_INVENTORY_XLSX_R63 */
router.get('/export.xlsx', async (req,res)=>{
  try{
    const branchId=String(req.query.branchId||'').trim();
    const search=String(req.query.search||'').trim();
    const category=String(req.query.category||'').trim();
    const stockStatus=String(req.query.stockStatus||'all').trim().toLowerCase();
    const productStatus=String(req.query.productStatus||'').trim();
    const sort=String(req.query.sort||'name').trim().toLowerCase();
    const direction=String(req.query.direction||'asc').trim().toLowerCase();

    const pageSize=200;
    let offset=0;
    let total=0;
    const all=[];

    do{
      const part=await listInventory({
        branchId,search,category,stockStatus,productStatus,sort,direction,
        limit:pageSize,offset
      });
      const partRows=Array.isArray(part.rows)?part.rows:[];
      if(offset===0)total=Number(part.total||part.rowCount||0);
      all.push(...partRows);
      offset+=partRows.length;
      if(!partRows.length)break;
    }while(offset<total && offset<100000);

    const visible=safeInventoryRows(all,isSuperadmin(req));
    const rows=visible.map((item)=>({
      Producto:item.producto||item.nombre||item.id_producto||'',
      Expansion:item.expansion||item.set_nombre||item.edicion||'',
      Rareza:item.rareza||'',
      Condicion:item.condicion||'',
      Idioma:item.idioma||'',
      SKU:item.sku||'',
      Sucursal:item.sucursal||item.id_sucursal||'',
      Unidades:Number(item.stock||0),
      Valor_Unitario:Number(item.precio||0),
      Valor_Total:Number(item.stock||0)*Number(item.precio||0),
      Estado:Number(item.stock||0)===0?'Sin stock':
        Number(item.stock||0)<=Number(item.stock_minimo||0)?'Stock bajo':'Disponible'
    }));

    const headers=[
      'Producto','Expansion','Rareza','Condicion','Idioma','SKU',
      'Sucursal','Unidades','Valor_Unitario','Valor_Total','Estado'
    ];
    const wb=XLSX.utils.book_new();
    const ws=XLSX.utils.json_to_sheet(rows,{header:headers});
    ws['!cols']=[
      {wch:34},{wch:24},{wch:16},{wch:14},{wch:10},{wch:22},
      {wch:24},{wch:12},{wch:16},{wch:16},{wch:14}
    ];
    XLSX.utils.book_append_sheet(wb,ws,'Inventario');

    const buffer=XLSX.write(wb,{type:'buffer',bookType:'xlsx',compression:true});
    const date=new Date().toISOString().slice(0,10);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="SHINY_Inventario_${date}.xlsx"`);
    res.setHeader('Cache-Control','no-store');
    res.send(buffer);
  }catch(error){
    console.error('[GMX][INVENTORY_XLSX_R63]',error);
    res.status(500).json({
      success:false,
      error:'INVENTORY_XLSX_FAILED',
      message:error.message
    });
  }
});
router.get('/movements', async (req, res) => {
  try {
    const branchId = String(req.query.branchId || '').trim();
    const productId = String(req.query.productId || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);

    const result = await listMovements({ branchId, productId, limit });
    res.json({ success: true, data: result.rows, count: result.rowCount, ms: result.ms });
  } catch (error) {
    res.status(500).json({ success: false, error: 'MOVEMENT_LIST_FAILED', message: error.message });
  }
});

router.get('/transfers', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const result = await listTransfers({ limit });
    res.json({ success: true, data: result.rows, count: result.rowCount, ms: result.ms });
  } catch (error) {
    res.status(500).json({ success: false, error: 'TRANSFER_LIST_FAILED', message: error.message });
  }
});

router.post('/adjust', async (req, res) => {
  try {
    const branchId = String(req.body.branchId || '').trim();
    const productId = String(req.body.productId || '').trim();
    const mode = String(req.body.mode || '').trim();
    const reason = String(req.body.reason || '').trim();
    const quantity = Number(req.body.quantity);

    if (!branchId || !productId) throw new Error('MISSING_REQUIRED_FIELDS');
    if (!reason) throw new Error('ADJUSTMENT_REASON_REQUIRED');
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error('INVALID_QUANTITY');

    const data = await adjustInventory({
      branchId,
      productId,
      quantity: Math.trunc(quantity),
      mode,
      reason,
      user: req.user || {}
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message, message: error.message });
  }
});

router.post('/transfer', async (req, res) => {
  try {
    const originId = String(req.body.originId || '').trim();
    const destinationId = String(req.body.destinationId || '').trim();
    const productId = String(req.body.productId || '').trim();
    const reason = String(req.body.reason || '').trim();
    const quantity = Number(req.body.quantity);

    if (!originId || !destinationId || !productId) throw new Error('MISSING_REQUIRED_FIELDS');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('INVALID_QUANTITY');

    // Defense in depth: a transfer touches TWO branches. Both must be
    // inside the authenticated user's branch scope before any business
    // transaction or inventory mutation starts.
    const scope = req.access?.branchScope;
    if (scope && !scope.all) {
      const allowed = Array.isArray(scope.allowed) ? scope.allowed : [];
      const denied = [originId, destinationId].find((id) => !allowed.includes(id));

      if (denied) {
        return res.status(403).json({
          success: false,
          error: 'BRANCH_FORBIDDEN',
          message: 'BRANCH_FORBIDDEN',
          branchId: denied,
          allowedBranches: allowed
        });
      }
    }

    const data = await transferInventory({
      originId,
      destinationId,
      productId,
      quantity: Math.trunc(quantity),
      reason,
      user: req.user || {}
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message, message: error.message });
  }
});

export default router;
