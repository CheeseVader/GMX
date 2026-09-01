import { Router } from 'express';
import { buildInventoryStockTemplate,importInventoryStockWorkbook } from '../inventoryStockImportService.js';

const router=Router();

router.get('/stock-template.xlsx',async(_req,res)=>{
  try{
    const buffer=await buildInventoryStockTemplate();
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="SHINY_Inventario_Importacion_Stock_DBA.xlsx"');
    res.send(buffer);
  }catch(error){
    console.error('[GMX Inventory Template]',error);
    res.status(500).json({success:false,error:'INVENTORY_TEMPLATE_FAILED',message:error.message});
  }
});

router.post('/import-stock',async(req,res)=>{
  try{
    const data=await importInventoryStockWorkbook(
      req.body?.file||{},
      req.user||{},
      req.access?.branchScope||null
    );
    res.json({success:true,data});
  }catch(error){
    console.error('[GMX Inventory Import]',error);
    res.status(400).json({success:false,error:'INVENTORY_IMPORT_FAILED',message:error.message});
  }
});

export default router;