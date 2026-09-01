import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';

const clampLimit = (value, fallback = 100, max = 1000) => {
  const n = Number(value || fallback);
  return Math.max(1, Math.min(max, Number.isFinite(n) ? Math.floor(n) : fallback));
};

const txt = (v) => (v == null ? '' : String(v).trim());
const qty = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error('La cantidad debe ser un entero mayor que cero.');
  return n;
};
const deltaQty = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n === 0) throw new Error('El ajuste debe ser un entero distinto de cero.');
  return n;
};
const id = (prefix) => `${prefix}-${randomUUID().slice(0, 10).toUpperCase()}`;

async function branchName(client, idSucursal) {
  const r = await client.query(
    `select coalesce(nombre_sucursal, codigo, id_sucursal) nombre
       from gmx.sucursales where id_sucursal=$1 limit 1`,
    [idSucursal]
  );
  return r.rows[0]?.nombre || idSucursal;
}

async function inventoryDetail(client, idInventario) {
  const r = await client.query(
    `select i.id_inventario, i.id_carta, i.sku, i.idioma, i.condicion, i.acabado, i.edicion,
            i.graded, i.empresa_grading, i.grado, i.certificado, i.costo, i.precio,
            i.precio_oferta, i.stock, i.stock_reservado, i.ubicacion, i.sucursal,
            i.estado_venta, i.rareza,
            c.nombre as carta, c.numero_completo, c.imagen_principal
       from gmx.tcg_inventario i
       left join gmx.tcg_cartas c on c.id_carta=i.id_carta
      where i.id_inventario=$1 limit 1`,
    [idInventario]
  );
  if (!r.rows[0]) throw new Error(`Inventario TCG no encontrado: ${idInventario}`);
  return r.rows[0];
}

async function lockBranchStock(client, idInventario, idSucursal) {
  let r = await client.query(
    `select row_id, id_registro, id_inventario, id_carta, sku, id_sucursal, sucursal,
            coalesce(stock,0)::bigint stock, coalesce(stock_reservado,0)::bigint stock_reservado
       from gmx.tcg_inventario_sucursales
      where id_inventario=$1 and id_sucursal=$2
      order by row_id limit 1 for update`,
    [idInventario, idSucursal]
  );
  if (r.rows[0]) return r.rows[0];

  const inv = await inventoryDetail(client, idInventario);
  const nombre = await branchName(client, idSucursal);
  const idRegistro = id('TCGIS');
  await client.query(
    `insert into gmx.tcg_inventario_sucursales
      (id_registro,id_inventario,id_carta,sku,id_sucursal,sucursal,stock,stock_reservado,ultima_actualizacion)
     values ($1,$2,$3,$4,$5,$6,0,0,now())`,
    [idRegistro, inv.id_inventario, inv.id_carta, inv.sku, idSucursal, nombre]
  );
  r = await client.query(
    `select row_id, id_registro, id_inventario, id_carta, sku, id_sucursal, sucursal,
            coalesce(stock,0)::bigint stock, coalesce(stock_reservado,0)::bigint stock_reservado
       from gmx.tcg_inventario_sucursales
      where id_registro=$1 for update`,
    [idRegistro]
  );
  return r.rows[0];
}

async function updateGlobalStock(client, idInventario, delta) {
  const r = await client.query(
    `select coalesce(stock,0)::bigint stock from gmx.tcg_inventario
      where id_inventario=$1 order by row_id limit 1 for update`,
    [idInventario]
  );
  if (!r.rows[0]) throw new Error(`Inventario TCG no encontrado: ${idInventario}`);
  const anterior = Number(r.rows[0].stock || 0);
  const nuevo = anterior + Number(delta);
  if (nuevo < 0) throw new Error(`Stock global insuficiente para ${idInventario}.`);
  await client.query(
    `update gmx.tcg_inventario set stock=$2, ultima_actualizacion=now()
      where row_id=(select row_id from gmx.tcg_inventario where id_inventario=$1 order by row_id limit 1)`,
    [idInventario, nuevo]
  );
  return { anterior, nuevo };
}

async function insertMovement(client, m) {
  const idMovimiento = id('TCGMOV');
  await client.query(
    `insert into gmx.tcg_movimientos_sucursales
      (id_movimiento,fecha,tipo,id_inventario,id_carta,sku,
       id_sucursal_origen,sucursal_origen,id_sucursal_destino,sucursal_destino,cantidad,
       stock_origen_anterior,stock_origen_nuevo,stock_destino_anterior,stock_destino_nuevo,
       stock_global_anterior,stock_global_nuevo,referencia,motivo,id_admin,administrador)
     values ($1,now(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [idMovimiento, m.tipo, m.idInventario, m.idCarta || null, m.sku || null,
      m.idSucursalOrigen || null, m.sucursalOrigen || null, m.idSucursalDestino || null,
      m.sucursalDestino || null, m.cantidad, m.stockOrigenAnterior ?? null,
      m.stockOrigenNuevo ?? null, m.stockDestinoAnterior ?? null, m.stockDestinoNuevo ?? null,
      m.stockGlobalAnterior ?? null, m.stockGlobalNuevo ?? null, txt(m.referencia) || null,
      txt(m.motivo) || null, txt(m.idAdmin) || null, txt(m.administrador) || null]
  );
  return idMovimiento;
}

async function adjustmentInClient(client, data) {
  const idInventario = txt(data.idInventario);
  const idSucursal = txt(data.idSucursal);
  if (!idInventario || !idSucursal) throw new Error('idInventario e idSucursal son obligatorios.');
  const delta = deltaQty(data.delta);
  const inv = await inventoryDetail(client, idInventario);
  const branch = await lockBranchStock(client, idInventario, idSucursal);
  const anterior = Number(branch.stock || 0);
  const nuevo = anterior + delta;
  if (nuevo < 0) throw new Error(`Stock insuficiente en ${branch.sucursal || idSucursal}.`);
  await client.query(
    `update gmx.tcg_inventario_sucursales set stock=$2, ultima_actualizacion=now() where row_id=$1`,
    [branch.row_id, nuevo]
  );
  const global = await updateGlobalStock(client, idInventario, delta);
  const idMovimiento = await insertMovement(client, {
    tipo: data.tipo || 'AJUSTE', idInventario, idCarta: inv.id_carta, sku: inv.sku,
    idSucursalOrigen: delta < 0 ? idSucursal : null,
    sucursalOrigen: delta < 0 ? branch.sucursal : null,
    idSucursalDestino: delta > 0 ? idSucursal : null,
    sucursalDestino: delta > 0 ? branch.sucursal : null,
    cantidad: Math.abs(delta),
    stockOrigenAnterior: delta < 0 ? anterior : null,
    stockOrigenNuevo: delta < 0 ? nuevo : null,
    stockDestinoAnterior: delta > 0 ? anterior : null,
    stockDestinoNuevo: delta > 0 ? nuevo : null,
    stockGlobalAnterior: global.anterior,
    stockGlobalNuevo: global.nuevo,
    referencia: data.referencia, motivo: data.motivo, idAdmin: data.idAdmin, administrador: data.administrador
  });
  return { idMovimiento, idInventario, idSucursal, stockAnterior: anterior, stockNuevo: nuevo, stockGlobal: global.nuevo };
}


export async function listBranches() {
  const r = await pool.query(`select id_sucursal, coalesce(nombre_sucursal,codigo,id_sucursal) nombre, codigo, activa from gmx.sucursales where coalesce(activa,true)=true order by nombre_sucursal nulls last,codigo nulls last`);
  return r.rows;
}

export async function listInventory({ q = '', branch = '', limit = 200 } = {}) {
  const values = [];
  const where = [];
  if (txt(q)) {
    values.push(`%${txt(q).toLowerCase()}%`);
    where.push(`(lower(coalesce(i.id_inventario,'')) like $${values.length} or lower(coalesce(i.sku,'')) like $${values.length} or lower(coalesce(c.nombre,'')) like $${values.length})`);
  }
  if (txt(branch)) {
    values.push(txt(branch));
    where.push(`s.id_sucursal=$${values.length}`);
  }
  values.push(clampLimit(limit, 200, 1000));
  const r = await pool.query(
    `select i.id_inventario,i.id_carta,i.sku,coalesce(c.nombre,'') carta,i.rareza,i.idioma,i.condicion,i.edicion,
            i.precio,i.precio_oferta,coalesce(i.stock,0)::bigint stock_global,
            s.id_sucursal,s.sucursal,coalesce(s.stock,0)::bigint stock_sucursal,
            coalesce(s.stock_reservado,0)::bigint stock_reservado
       from gmx.tcg_inventario i
       left join gmx.tcg_cartas c on c.id_carta=i.id_carta
       left join gmx.tcg_inventario_sucursales s on s.id_inventario=i.id_inventario
       ${where.length ? `where ${where.join(' and ')}` : ''}
      order by c.nombre nulls last,i.sku nulls last,s.sucursal nulls last
      limit $${values.length}`,
    values
  );
  return r.rows;
}

export async function listMovements({ q = '', branch = '', limit = 200 } = {}) {
  const values=[]; const where=[];
  if (txt(q)) { values.push(`%${txt(q).toLowerCase()}%`); where.push(`(lower(coalesce(m.sku,'')) like $${values.length} or lower(coalesce(m.id_inventario,'')) like $${values.length} or lower(coalesce(m.referencia,'')) like $${values.length})`); }
  if (txt(branch)) { values.push(txt(branch)); where.push(`(m.id_sucursal_origen=$${values.length} or m.id_sucursal_destino=$${values.length})`); }
  values.push(clampLimit(limit,200,1000));
  const r=await pool.query(`select * from gmx.tcg_movimientos_sucursales m ${where.length?`where ${where.join(' and ')}`:''} order by fecha desc nulls last,row_id desc limit $${values.length}`,values);
  return r.rows;
}

export async function adjustStock(data) {
  const client=await pool.connect();
  try { await client.query('begin'); const out=await adjustmentInClient(client,data); await client.query('commit'); return out; }
  catch(e){ await client.query('rollback'); throw e; } finally { client.release(); }
}

export async function transferStock(data) {
  const idInventario=txt(data.idInventario), from=txt(data.idSucursalOrigen), to=txt(data.idSucursalDestino);
  const cantidad=qty(data.cantidad);
  if (!idInventario || !from || !to || from===to) throw new Error('Inventario, origen y destino distintos son obligatorios.');
  const client=await pool.connect();
  try {
    await client.query('begin');
    const inv=await inventoryDetail(client,idInventario);
    const a=await lockBranchStock(client,idInventario,from);
    const b=await lockBranchStock(client,idInventario,to);
    const a0=Number(a.stock||0), b0=Number(b.stock||0);
    if (a0-cantidad<0) throw new Error(`Stock insuficiente en ${a.sucursal||from}.`);
    await client.query(`update gmx.tcg_inventario_sucursales set stock=$2,ultima_actualizacion=now() where row_id=$1`,[a.row_id,a0-cantidad]);
    await client.query(`update gmx.tcg_inventario_sucursales set stock=$2,ultima_actualizacion=now() where row_id=$1`,[b.row_id,b0+cantidad]);
    const g=await client.query(`select coalesce(stock,0)::bigint stock from gmx.tcg_inventario where id_inventario=$1 order by row_id limit 1`,[idInventario]);
    const global=Number(g.rows[0]?.stock||0);
    const idMovimiento=await insertMovement(client,{tipo:'TRANSFERENCIA',idInventario,idCarta:inv.id_carta,sku:inv.sku,idSucursalOrigen:from,sucursalOrigen:a.sucursal,idSucursalDestino:to,sucursalDestino:b.sucursal,cantidad,stockOrigenAnterior:a0,stockOrigenNuevo:a0-cantidad,stockDestinoAnterior:b0,stockDestinoNuevo:b0+cantidad,stockGlobalAnterior:global,stockGlobalNuevo:global,referencia:data.referencia,motivo:data.motivo,idAdmin:data.idAdmin,administrador:data.administrador});
    await client.query('commit'); return {idMovimiento,stockOrigen:a0-cantidad,stockDestino:b0+cantidad,stockGlobal:global};
  } catch(e){await client.query('rollback');throw e;} finally{client.release();}
}

export async function scanAndMove(data) {
  const codigo=txt(data.codigo), accion=txt(data.accion).toUpperCase(), idSucursal=txt(data.idSucursal);
  if (!codigo || !idSucursal) throw new Error('Código y sucursal son obligatorios.');
  const client=await pool.connect();
  try {
    await client.query('begin');
    const r=await client.query(`select i.id_inventario,i.id_carta,i.sku,coalesce(c.nombre,'') carta from gmx.tcg_inventario i left join gmx.tcg_cartas c on c.id_carta=i.id_carta where i.id_inventario=$1 or i.sku=$1 order by i.row_id limit 1`,[codigo]);
    if(!r.rows[0]) throw new Error('Código TCG no encontrado.');
    const inv=r.rows[0]; const cantidad=qty(data.cantidad||1);
    const delta=accion==='SALIDA'||accion==='VENTA'?-cantidad:cantidad;
    const mov=await adjustmentInClient(client,{...data,idInventario:inv.id_inventario,idSucursal,delta,tipo:`ESCANER_${accion||'ENTRADA'}`});
    const idEscaneo=id('TCGSCN');
    await client.query(`insert into gmx.tcg_escaneos (id_escaneo,fecha,codigo,tipo_codigo,accion,id_inventario,id_carta,sku,carta,id_sucursal,sucursal,cantidad,resultado,id_admin,administrador) values ($1,now(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'OK',$12,$13)`,[idEscaneo,codigo,codigo===inv.id_inventario?'ID_INVENTARIO':'SKU',accion||'ENTRADA',inv.id_inventario,inv.id_carta,inv.sku,inv.carta,idSucursal,await branchName(client,idSucursal),cantidad,txt(data.idAdmin)||null,txt(data.administrador)||null]);
    await client.query('commit'); return {idEscaneo,...mov, inventario:inv};
  } catch(e){await client.query('rollback');throw e;} finally{client.release();}
}

export async function createCount(data) {
  const branch=txt(data.idSucursal); if(!branch) throw new Error('La sucursal es obligatoria.');
  const client=await pool.connect();
  try{
    await client.query('begin');
    const open=await client.query(`select id_conteo from gmx.tcg_conteos where id_sucursal=$1 and upper(coalesce(estado,''))='ABIERTO' order by row_id desc limit 1 for update`,[branch]);
    if(open.rows[0]) throw new Error(`Ya existe un conteo abierto: ${open.rows[0].id_conteo}`);
    const idConteo=id('TCGCNT'), nombre=await branchName(client,branch);
    await client.query(`insert into gmx.tcg_conteos (id_conteo,fecha_inicio,id_sucursal,sucursal,estado,id_admin,administrador,notas,variantes_contadas,unidades_sistema,unidades_fisicas,diferencia_unidades,ajustes_aplicados) values ($1,now(),$2,$3,'ABIERTO',$4,$5,$6,0,0,0,0,'NO')`,[idConteo,branch,nombre,txt(data.idAdmin)||null,txt(data.administrador)||null,txt(data.notas)||null]);
    await client.query('commit'); return {idConteo,idSucursal:branch,sucursal:nombre,estado:'ABIERTO'};
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}

export async function listCounts({estado='',limit=100}={}) {
  const values=[];let where=''; if(txt(estado)){values.push(txt(estado).toUpperCase());where=`where upper(coalesce(estado,''))=$1`;}
  values.push(clampLimit(limit,100,500));
  const r=await pool.query(`select * from gmx.tcg_conteos ${where} order by fecha_inicio desc nulls last,row_id desc limit $${values.length}`,values); return r.rows;
}

export async function getCount(idConteo){
  const h=await pool.query(`select * from gmx.tcg_conteos where id_conteo=$1 order by row_id desc limit 1`,[idConteo]);
  if(!h.rows[0]) throw new Error('Conteo no encontrado.');
  const d=await pool.query(`select * from gmx.tcg_conteo_detalle where id_conteo=$1 order by fecha_captura,row_id`,[idConteo]);
  return {conteo:h.rows[0],detalle:d.rows};
}

export async function captureCount(data){
  const idConteo=txt(data.idConteo), idInventario=txt(data.idInventario); const fisica=Math.max(0,Number(data.cantidadFisica));
  if(!idConteo||!idInventario||!Number.isInteger(fisica)) throw new Error('Conteo, inventario y cantidad física entera son obligatorios.');
  const client=await pool.connect();
  try{await client.query('begin');
    const h=await client.query(`select * from gmx.tcg_conteos where id_conteo=$1 order by row_id desc limit 1 for update`,[idConteo]);
    if(!h.rows[0]||String(h.rows[0].estado).toUpperCase()!=='ABIERTO') throw new Error('El conteo no está abierto.');
    const inv=await inventoryDetail(client,idInventario); const bs=await lockBranchStock(client,idInventario,h.rows[0].id_sucursal); const sistema=Number(bs.stock||0); const diferencia=fisica-sistema;
    const ex=await client.query(`select row_id from gmx.tcg_conteo_detalle where id_conteo=$1 and id_inventario=$2 order by row_id desc limit 1`,[idConteo,idInventario]);
    const vals=[new Date(),inv.id_carta,inv.sku,inv.carta,inv.rareza,inv.idioma,inv.condicion,inv.edicion,sistema,fisica,diferencia,'PENDIENTE',txt(data.idAdmin)||null,txt(data.administrador)||null];
    if(ex.rows[0]) await client.query(`update gmx.tcg_conteo_detalle set fecha_captura=$2,id_carta=$3,sku=$4,carta=$5,rareza=$6,idioma=$7,condicion=$8,edicion=$9,stock_sistema=$10,cantidad_fisica=$11,diferencia=$12,estado_ajuste=$13,id_admin_captura=$14,administrador_captura=$15 where row_id=$1`,[ex.rows[0].row_id,...vals]);
    else await client.query(`insert into gmx.tcg_conteo_detalle (id_detalle,id_conteo,fecha_captura,id_inventario,id_carta,sku,carta,rareza,idioma,condicion,edicion,stock_sistema,cantidad_fisica,diferencia,estado_ajuste,id_admin_captura,administrador_captura) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,[id('TCGCNTD'),idConteo,new Date(),idInventario,inv.id_carta,inv.sku,inv.carta,inv.rareza,inv.idioma,inv.condicion,inv.edicion,sistema,fisica,diferencia,'PENDIENTE',txt(data.idAdmin)||null,txt(data.administrador)||null]);
    const agg=await client.query(`select count(*)::bigint variantes,coalesce(sum(stock_sistema),0)::bigint sistema,coalesce(sum(cantidad_fisica),0)::bigint fisicas,coalesce(sum(diferencia),0)::bigint diferencia from gmx.tcg_conteo_detalle where id_conteo=$1`,[idConteo]); const a=agg.rows[0];
    await client.query(`update gmx.tcg_conteos set variantes_contadas=$2,unidades_sistema=$3,unidades_fisicas=$4,diferencia_unidades=$5 where id_conteo=$1`,[idConteo,a.variantes,a.sistema,a.fisicas,a.diferencia]);
    await client.query('commit'); return {idConteo,idInventario,stockSistema:sistema,cantidadFisica:fisica,diferencia};
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}

export async function closeCount(data){
  const idConteo=txt(data.idConteo), aplicar=Boolean(data.aplicarAjustes); const client=await pool.connect();
  try{await client.query('begin'); const h=await client.query(`select * from gmx.tcg_conteos where id_conteo=$1 order by row_id desc limit 1 for update`,[idConteo]); if(!h.rows[0]||String(h.rows[0].estado).toUpperCase()!=='ABIERTO') throw new Error('Conteo no encontrado o ya cerrado.');
    const det=await client.query(`select * from gmx.tcg_conteo_detalle where id_conteo=$1 order by row_id for update`,[idConteo]);
    if(aplicar){for(const d of det.rows){const diff=Number(d.diferencia||0);if(diff!==0){await adjustmentInClient(client,{idInventario:d.id_inventario,idSucursal:h.rows[0].id_sucursal,delta:diff,tipo:'CONTEO',referencia:idConteo,motivo:'Conciliación de conteo físico',idAdmin:data.idAdmin,administrador:data.administrador});await client.query(`update gmx.tcg_conteo_detalle set estado_ajuste='APLICADO' where row_id=$1`,[d.row_id]);}else await client.query(`update gmx.tcg_conteo_detalle set estado_ajuste='SIN_CAMBIO' where row_id=$1`,[d.row_id]);}}
    await client.query(`update gmx.tcg_conteos set estado='CERRADO',fecha_cierre=now(),ajustes_aplicados=$2 where id_conteo=$1`,[idConteo,aplicar?'SI':'NO']); await client.query('commit'); return {idConteo,estado:'CERRADO',ajustesAplicados:aplicar};
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}

export async function createSale(data){
  const branch=txt(data.idSucursal), items=Array.isArray(data.items)?data.items:[]; if(!branch||!items.length) throw new Error('Sucursal e items son obligatorios.');
  const client=await pool.connect();
  try{await client.query('begin'); const idVenta=id('TCGVTA'), sucursal=await branchName(client,branch); let total=0, unidades=0; const details=[];
    for(const item of items){const idInventario=txt(item.idInventario), cantidad=qty(item.cantidad); const inv=await inventoryDetail(client,idInventario); const bs=await lockBranchStock(client,idInventario,branch); const disponible=Number(bs.stock||0)-Number(bs.stock_reservado||0); if(disponible<cantidad) throw new Error(`Stock insuficiente: ${inv.sku||idInventario}.`); const precio=Number(item.precio??inv.precio??0); const subtotal=precio*cantidad; total+=subtotal;unidades+=cantidad;
      await client.query(`update gmx.tcg_inventario_sucursales set stock=stock-$2,ultima_actualizacion=now() where row_id=$1`,[bs.row_id,cantidad]); const global=await updateGlobalStock(client,idInventario,-cantidad); await insertMovement(client,{tipo:'VENTA',idInventario,idCarta:inv.id_carta,sku:inv.sku,idSucursalOrigen:branch,sucursalOrigen:sucursal,cantidad,stockOrigenAnterior:Number(bs.stock),stockOrigenNuevo:Number(bs.stock)-cantidad,stockGlobalAnterior:global.anterior,stockGlobalNuevo:global.nuevo,referencia:idVenta,motivo:'Venta TCG POS',idAdmin:data.idAdmin,administrador:data.administrador}); details.push({idInventario,inv,cantidad,precio,subtotal}); }
    await client.query(`insert into gmx.tcg_ventas (id_venta,fecha,id_sucursal,sucursal,metodo_pago,referencia_pago,subtotal,total,unidades,estado,id_admin,administrador,cliente) values ($1,now(),$2,$3,$4,$5,$6,$6,$7,'COMPLETADA',$8,$9,$10)`,[idVenta,branch,sucursal,txt(data.metodoPago)||'EFECTIVO',txt(data.referenciaPago)||null,total,unidades,txt(data.idAdmin)||null,txt(data.administrador)||null,txt(data.cliente)||null]);
    for(const d of details) await client.query(`insert into gmx.tcg_ventas_detalle (id_detalle,id_venta,id_inventario,id_carta,sku,carta,cantidad,precio_unitario,subtotal) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id('TCGVD'),idVenta,d.idInventario,d.inv.id_carta,d.inv.sku,d.inv.carta,d.cantidad,d.precio,d.subtotal]);
    await client.query('commit'); return {idVenta,sucursal,total,unidades,estado:'COMPLETADA'};
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}

export async function listSales({limit=100}={}){const r=await pool.query(`select * from gmx.tcg_ventas order by fecha desc nulls last,row_id desc limit $1`,[clampLimit(limit,100,500)]);return r.rows;}
export async function saleDetail(idVenta){const h=await pool.query(`select * from gmx.tcg_ventas where id_venta=$1 order by row_id desc limit 1`,[idVenta]);if(!h.rows[0])throw new Error('Venta no encontrada.');const d=await pool.query(`select * from gmx.tcg_ventas_detalle where id_venta=$1 order by row_id`,[idVenta]);return {venta:h.rows[0],detalle:d.rows};}

export async function bulkOperations(data){const rows=Array.isArray(data.rows)?data.rows:[];if(!rows.length)throw new Error('No hay filas para procesar.');if(rows.length>1000)throw new Error('Máximo 1000 filas por lote.');const result=[];for(let i=0;i<rows.length;i++){try{const r=rows[i];const tipo=txt(r.tipo||r.accion).toUpperCase();let out;if(tipo==='TRANSFERENCIA')out=await transferStock({...data,...r});else out=await adjustStock({...data,...r,delta:r.delta??r.cantidad,tipo:tipo||'AJUSTE_BULK'});result.push({fila:i+1,ok:true,...out});}catch(e){result.push({fila:i+1,ok:false,error:e.message});}}return {total:rows.length,ok:result.filter(x=>x.ok).length,error:result.filter(x=>!x.ok).length,result};}

export async function exportData(kind='inventory',limit=5000){const n=clampLimit(limit,5000,10000);const map={inventory:`select * from gmx.tcg_inventario order by row_id limit $1`,branchInventory:`select * from gmx.tcg_inventario_sucursales order by row_id limit $1`,movements:`select * from gmx.tcg_movimientos_sucursales order by fecha desc nulls last,row_id desc limit $1`,counts:`select * from gmx.tcg_conteos order by fecha_inicio desc nulls last,row_id desc limit $1`,sales:`select * from gmx.tcg_ventas order by fecha desc nulls last,row_id desc limit $1`,scans:`select * from gmx.tcg_escaneos order by fecha desc nulls last,row_id desc limit $1`};const sql=map[kind]||map.inventory;const r=await pool.query(sql,[n]);return r.rows;}

export async function diagnostics(){const tables=['tcg_inventario','tcg_inventario_sucursales','tcg_movimientos_sucursales','tcg_escaneos','tcg_conteos','tcg_conteo_detalle','tcg_ventas','tcg_ventas_detalle'];const out=[];for(const table of tables){const r=await pool.query(`select to_regclass($1) as reg`,[`gmx.${table}`]);if(!r.rows[0].reg){out.push({table,exists:false,count:null});continue;}const c=await pool.query(`select count(*)::bigint count from gmx.${table}`);out.push({table,exists:true,count:Number(c.rows[0].count)});}return {phase:'10.3',ok:out.every(x=>x.exists),tables:out};}
