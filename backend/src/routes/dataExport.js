import { Router } from 'express';
import { query } from '../db.js';
import { writeCsvRows } from '../utils/csvStream.js';

const router=Router();
const PAGE=2000;

const datasets={
  inventory:{
    order:'id_inventario,id_sucursal',
    sql:`SELECT i.id_inventario,i.sku,c.nombre AS carta,i.rareza,i.idioma,i.condicion,i.acabado,
      i.costo,i.precio,i.precio_oferta,i.stock AS stock_global,i.stock_reservado AS reservado_global,
      s.id_sucursal,s.sucursal,s.stock,s.stock_reservado
      FROM gmx.tcg_inventario i
      LEFT JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
      LEFT JOIN gmx.tcg_inventario_sucursales s ON s.id_inventario=i.id_inventario`
  },
  sales:{
    order:'fecha DESC NULLS LAST,id_pedido',
    sql:`SELECT p.*,COUNT(d.row_id)::bigint AS lineas,COALESCE(SUM(d.cantidad),0)::bigint AS unidades
      FROM gmx.pedidos p LEFT JOIN gmx.detalle_pedidos d ON d.id_pedido=p.id_pedido
      GROUP BY p.row_id`
  },
  buylist:{
    order:'fecha DESC NULLS LAST,id_buylist',
    sql:`SELECT * FROM gmx.tcg_buylist`
  },
  movements:{
    order:'fecha DESC NULLS LAST,id_movimiento',
    sql:`SELECT * FROM gmx.tcg_movimientos_sucursales`
  },
  products:{
    order:'nombre,sku,id',
    sql:`SELECT * FROM gmx.productos`
  },
  clients:{
    order:'nombre,id_cliente',
    sql:`SELECT * FROM gmx.clientes`
  },
  providers:{
    order:"COALESCE(NULLIF(nombre_comercial,''),razon_social,id_proveedor),id_proveedor",
    sql:`SELECT * FROM gmx.proveedores`
  }
};


function xml(v){
  return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function xmlCell(v){
  const numeric=typeof v==='number'&&Number.isFinite(v);
  const value=v instanceof Date?v.toISOString():typeof v==='object'&&v!==null?JSON.stringify(v):v??'';
  return `<Cell><Data ss:Type="${numeric?'Number':'String'}">${xml(value)}</Data></Cell>`;
}

router.get('/all.xls',async(_req,res)=>{
  try{
    const name=`SHINY_EXPORT_COMPLETO_${new Date().toISOString().slice(0,10)}.xls`;
    res.status(200);
    res.setHeader('Content-Type','application/vnd.ms-excel');
    res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
    res.setHeader('Cache-Control','no-store');
    res.write('<?xml version="1.0"?>');
    res.write('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">');
    for(const [key,ds] of Object.entries(datasets)){
      res.write(`<Worksheet ss:Name="${xml(key.slice(0,31))}"><Table>`);
      let offset=0,headers=null;
      while(true){
        const r=await query(`${ds.sql} ORDER BY ${ds.order} LIMIT $1 OFFSET $2`,[PAGE,offset]);
        if(!r.rows.length)break;
        if(!headers){
          headers=Object.keys(r.rows[0]);
          res.write(`<Row>${headers.map(h=>xmlCell(h)).join('')}</Row>`);
        }
        for(const row of r.rows){
          res.write(`<Row>${headers.map(h=>xmlCell(row[h])).join('')}</Row>`);
        }
        offset+=r.rows.length;
        if(r.rows.length<PAGE)break;
        await new Promise(resolve=>setImmediate(resolve));
      }
      res.write('</Table></Worksheet>');
    }
    res.write('</Workbook>');
    res.end();
  }catch(e){
    if(!res.headersSent)return res.status(500).json({success:false,error:e.message});
    res.end();
  }
});

router.get('/:dataset.csv',async(req,res)=>{
  const ds=datasets[String(req.params.dataset||'').toLowerCase()];
  if(!ds)return res.status(404).json({success:false,error:'EXPORT_DATASET_NOT_FOUND'});
  try{
    const name=`SHINY_${req.params.dataset}_${new Date().toISOString().slice(0,10)}.csv`;
    res.status(200);
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
    res.setHeader('Cache-Control','no-store');
    let offset=0,headers=null;
    while(true){
      const r=await query(`${ds.sql} ORDER BY ${ds.order} LIMIT $1 OFFSET $2`,[PAGE,offset]);
      if(!r.rows.length)break;
      headers=writeCsvRows(res,r.rows,headers);
      offset+=r.rows.length;
      if(r.rows.length<PAGE)break;
      await new Promise(resolve=>setImmediate(resolve));
    }
    if(!headers)res.write('\ufeff');
    res.end();
  }catch(e){
    if(!res.headersSent)return res.status(500).json({success:false,error:e.message});
    res.end();
  }
});

export default router;
