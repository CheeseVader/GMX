import { query } from '../db.js';

const n=v=>Number(v||0);
function dateFilter(column,from,to,vals,filters){
  if(from){vals.push(from);filters.push(`${column} >= $${vals.length}::date`);}
  if(to){vals.push(to);filters.push(`${column} < ($${vals.length}::date + INTERVAL '1 day')`);}
}
function branchFilter(column,branchId,scope,vals,filters,{nullable=false}={}){
  if(branchId){
    vals.push(branchId);
    filters.push(`${column}=$${vals.length}`);
    return;
  }
  if(scope&&!scope.all&&scope.allowed?.length){
    vals.push(scope.allowed);
    filters.push(`${nullable?`(${column} IS NULL OR `:''}${column}=ANY($${vals.length}::text[])${nullable?')':''}`);
  }
}
function searchFilter(exprs,search,vals,filters){
  if(!search)return;
  vals.push(`%${search}%`);
  filters.push(`(${exprs.map(x=>`COALESCE(${x},'') ILIKE $${vals.length}`).join(' OR ')})`);
}
const where=f=>f.length?`WHERE ${f.join(' AND ')}`:'';

export async function consolidatedReport({branchId='',from='',to='',search=''}={},scope){
  // Ventas
  const sv=[],sf=[];
  branchFilter('p.id_sucursal',branchId,scope,sv,sf);
  dateFilter('p.fecha',from,to,sv,sf);
  searchFilter(['p.id_pedido','p.nombre_cliente','p.email','p.referencia_pago','p.sucursal'],search,sv,sf);
  const sales=await query(`SELECT p.row_id,p.id_pedido,p.fecha,p.id_cliente,p.nombre_cliente,p.email,
      p.id_sucursal,p.sucursal,p.canal_venta,p.metodo_pago,p.subtotal,p.envio,p.total,p.estado_pedido,
      p.referencia_pago,p.fecha_pago,p.vendedor,
      COUNT(d.row_id)::bigint lineas,COALESCE(SUM(d.cantidad),0)::bigint unidades
    FROM gmx.pedidos p
    LEFT JOIN gmx.detalle_pedidos d ON d.id_pedido=p.id_pedido
    ${where(sf)}
    GROUP BY p.row_id ORDER BY p.fecha DESC NULLS LAST LIMIT 4000`,sv);

  // Compras / recepción
  const pv=[],pf=[];
  branchFilter('c.id_sucursal_recepcion',branchId,scope,pv,pf);
  dateFilter('c.fecha',from,to,pv,pf);
  searchFilter(['c.id_compra','c.proveedor','c.referencia_documento','c.uuid_cfdi','c.sucursal_recepcion'],search,pv,pf);
  const purchases=await query(`SELECT c.row_id,c.id_compra,c.fecha,c.id_proveedor,c.proveedor,c.moneda,
      c.terminos_pago,c.tipo_documento,c.referencia_documento,c.estado,c.lineas,c.unidades_solicitadas,
      c.unidades_recibidas,c.subtotal,c.impuestos,c.total,c.id_sucursal_recepcion,c.sucursal_recepcion,
      c.estatus_fiscal,c.uuid_cfdi,c.total_documento,c.diferencia_documento,c.metodo_pago,c.fecha_cierre,
      COALESCE((SELECT MAX(d.ultima_recepcion) FROM gmx.compras_detalle d WHERE d.id_compra=c.id_compra),c.fecha_cierre) AS ultima_recepcion
    FROM gmx.compras c ${where(pf)}
    ORDER BY c.fecha DESC NULLS LAST LIMIT 3000`,pv);

  // Devoluciones por detalle/sucursal
  const rv=[],rf=[];
  if(branchId||(!scope?.all&&scope?.allowed?.length)){
    const temp=[];
    branchFilter('dd.id_sucursal',branchId,scope,rv,temp);
    if(temp.length)rf.push(`EXISTS(SELECT 1 FROM gmx.devoluciones_detalle dd WHERE dd.id_devolucion=d.id AND ${temp[0]})`);
  }
  dateFilter('d.fecha',from,to,rv,rf);
  searchFilter(['d.id','d.referencia','d.cliente_proveedor','d.motivo'],search,rv,rf);
  const returns=await query(`SELECT d.*,
      COALESCE((SELECT SUM(dd.cantidad) FROM gmx.devoluciones_detalle dd WHERE dd.id_devolucion=d.id),0)::bigint unidades,
      (SELECT STRING_AGG(DISTINCT dd.sucursal,', ') FROM gmx.devoluciones_detalle dd WHERE dd.id_devolucion=d.id) sucursales
    FROM gmx.devoluciones d ${where(rf)}
    ORDER BY d.fecha DESC NULLS LAST LIMIT 2500`,rv);

  // Cuentas por pagar
  const cv=[],cf=[];
  branchFilter('c.id_sucursal',branchId,scope,cv,cf,{nullable:true});
  dateFilter('c.fecha',from,to,cv,cf);
  searchFilter(['c.id','c.proveedor','c.documento','c.sucursal'],search,cv,cf);
  const payables=await query(`SELECT c.row_id,c.id,c.fecha,c.id_proveedor,c.proveedor,c.documento,c.id_compra,c.origen,
      c.moneda,c.id_sucursal,c.sucursal,c.vencimiento,c.total,c.pagado,c.saldo,c.estado,c.actualizacion
    FROM gmx.cuentas_por_pagar c ${where(cf)}
    ORDER BY COALESCE(c.vencimiento::date,CURRENT_DATE+3650),c.fecha DESC LIMIT 3000`,cv);

  // Egresos
  const ev=[],ef=[];
  branchFilter('g.id_sucursal',branchId,scope,ev,ef);
  dateFilter('g.fecha_gasto',from,to,ev,ef);
  searchFilter(['g.id_gasto','g.proveedor','g.concepto','g.referencia','g.origen_modulo','g.sucursal'],search,ev,ef);
  const expenses=await query(`SELECT g.row_id,g.id_gasto,g.fecha_gasto,g.id_sucursal,g.sucursal,g.categoria,g.subcategoria,
      g.concepto,g.proveedor,g.moneda,g.subtotal,g.impuestos,g.total,g.metodo_pago,g.referencia,g.estado,
      g.fecha_pago,g.origen_modulo,g.id_origen,g.admin_creador,g.admin_actualiza
    FROM gmx.gastos g ${where(ef)}
    ORDER BY g.fecha_gasto DESC NULLS LAST LIMIT 3000`,ev);

  // Caja
  const kv=[],kf=[];
  branchFilter('c.id_sucursal',branchId,scope,kv,kf);
  dateFilter('c.fecha_apertura',from,to,kv,kf);
  searchFilter(['c.id_caja','c.sucursal','c.admin_apertura','c.admin_cierre'],search,kv,kf);
  const cash=await query(`SELECT c.row_id,c.id_caja,c.id_sucursal,c.sucursal,c.fecha_apertura,c.fecha_cierre,
      c.fondo_inicial,c.ingresos_efectivo,c.egresos_efectivo,c.saldo_esperado,
      NULLIF(c.efectivo_contado,'')::numeric efectivo_contado,c.diferencia,c.estado,c.admin_apertura,c.admin_cierre
    FROM gmx.caja_sesiones c ${where(kf)}
    ORDER BY c.fecha_apertura DESC NULLS LAST LIMIT 2500`,kv);

  // Inventario producto
  const iv=[],inf=[];
  branchFilter('i.id_sucursal',branchId,scope,iv,inf);
  searchFilter(['i.sku','i.producto','i.sucursal','i.id_producto'],search,iv,inf);
  const inventory=await query(`SELECT i.row_id,i.id_sucursal,i.sucursal,i.id_producto,i.sku,i.producto,
      i.stock,i.stock_minimo,i.fecha_actualizacion
    FROM gmx.inventario_sucursales i ${where(inf)}
    ORDER BY i.sucursal,i.producto LIMIT 5000`,iv);

  // TCG
  const tv=[],tf=[];
  branchFilter('s.id_sucursal',branchId,scope,tv,tf);
  searchFilter(['i.sku','c.nombre','i.id_inventario','s.sucursal','c.rareza'],search,tv,tf);
  const tcg=await query(`SELECT s.row_id,s.id_sucursal,s.sucursal,s.id_inventario,i.sku,c.nombre carta,
      COALESCE(i.rareza,c.rareza) rareza,i.idioma,i.condicion,s.stock,s.stock_reservado,
      GREATEST(0,COALESCE(s.stock,0)-COALESCE(s.stock_reservado,0)) disponible,
      i.costo,COALESCE(NULLIF(i.precio_oferta,0),i.precio) precio
    FROM gmx.tcg_inventario_sucursales s
    JOIN gmx.tcg_inventario i ON i.id_inventario=s.id_inventario
    LEFT JOIN gmx.tcg_cartas c ON c.id_carta=i.id_carta
    ${where(tf)} ORDER BY s.sucursal,c.nombre LIMIT 5000`,tv);

  // Alertas
  const av=[],af=[];
  branchFilter('a.id_sucursal',branchId,scope,av,af,{nullable:true});
  dateFilter('a.fecha',from,to,av,af);
  searchFilter(['a.titulo','a.mensaje','a.referencia','a.tipo','a.sucursal'],search,av,af);
  const alerts=await query(`SELECT a.row_id,a.fecha,a.tipo,a.titulo,a.modulo,a.prioridad,a.id_sucursal,a.sucursal,
      a.referencia,a.estado,a.leida,a.resuelta,a.fecha_resolucion,a.resuelta_por,a.nota_resolucion
    FROM gmx.notificaciones_admin a ${where(af)}
    ORDER BY a.fecha DESC NULLS LAST LIMIT 2500`,av);

  const salesSummary={operaciones:sales.rows.length,pagadas:0,canceladas:0,unidades:0,total:0};
  for(const x of sales.rows){
    const st=String(x.estado_pedido||'').toUpperCase();
    if(['PAGADO','PAGADA'].includes(st)){salesSummary.pagadas++;salesSummary.unidades+=n(x.unidades);salesSummary.total+=n(x.total);}
    if(['CANCELADO','CANCELADA'].includes(st))salesSummary.canceladas++;
  }
  const purchaseSummary={operaciones:purchases.rows.length,recibidas:0,pendientes:0,total:0,unidades:0,diferenciasDocumento:0};
  for(const x of purchases.rows){
    const st=String(x.estado||'').toUpperCase();
    if(st==='RECIBIDA')purchaseSummary.recibidas++;else if(st!=='CANCELADA')purchaseSummary.pendientes++;
    if(st!=='CANCELADA'){purchaseSummary.total+=n(x.total);purchaseSummary.unidades+=n(x.unidades_recibidas);}
    purchaseSummary.diferenciasDocumento+=Math.abs(n(x.diferencia_documento));
  }
  const returnSummary={operaciones:returns.rows.length,importe:0,unidades:0};
  returns.rows.forEach(x=>{if(String(x.estado||'').toUpperCase()!=='CANCELADA'){returnSummary.importe+=n(x.importe);returnSummary.unidades+=n(x.unidades);}});
  const payableSummary={cuentas:payables.rows.length,total:0,pagado:0,saldo:0,vencidas:0};
  const today=new Date().toISOString().slice(0,10);
  payables.rows.forEach(x=>{
    if(String(x.estado||'').toUpperCase()!=='CANCELADA'){
      payableSummary.total+=n(x.total);payableSummary.pagado+=n(x.pagado);payableSummary.saldo+=n(x.saldo);
      if(n(x.saldo)>0&&x.vencimiento&&String(x.vencimiento).slice(0,10)<today)payableSummary.vencidas++;
    }
  });
  const expenseSummary={operaciones:expenses.rows.length,pagados:0,pendientes:0,totalPagado:0,totalPendiente:0};
  expenses.rows.forEach(x=>{
    const st=String(x.estado||'').toUpperCase();
    if(st==='PAGADO'){expenseSummary.pagados++;expenseSummary.totalPagado+=n(x.total);}
    else if(st==='PENDIENTE'){expenseSummary.pendientes++;expenseSummary.totalPendiente+=n(x.total);}
  });
  const cashSummary={sesiones:cash.rows.length,cerradas:0,diferencia:0,ingresos:0,egresos:0};
  cash.rows.forEach(x=>{if(String(x.estado||'').toUpperCase()==='CERRADA')cashSummary.cerradas++;cashSummary.diferencia+=n(x.diferencia);cashSummary.ingresos+=n(x.ingresos_efectivo);cashSummary.egresos+=n(x.egresos_efectivo);});
  const inventorySummary={productos:inventory.rows.length,unidades:0,bajoMinimo:0};
  inventory.rows.forEach(x=>{inventorySummary.unidades+=n(x.stock);if(n(x.stock)<=n(x.stock_minimo))inventorySummary.bajoMinimo++;});
  const tcgSummary={variantes:tcg.rows.length,unidades:0,disponibles:0,valorCosto:0,valorVenta:0};
  tcg.rows.forEach(x=>{tcgSummary.unidades+=n(x.stock);tcgSummary.disponibles+=n(x.disponible);tcgSummary.valorCosto+=n(x.stock)*n(x.costo);tcgSummary.valorVenta+=n(x.stock)*n(x.precio);});
  const alertSummary={total:alerts.rows.length,abiertas:0,criticas:0,noLeidas:0};
  alerts.rows.forEach(x=>{if(!x.resuelta)alertSummary.abiertas++;if(!x.resuelta&&String(x.prioridad).toUpperCase()==='CRITICA')alertSummary.criticas++;if(!x.leida&&!x.resuelta)alertSummary.noLeidas++;});

  return {
    generatedAt:new Date().toISOString(),
    filters:{branchId,from,to,search},
    summary:{
      sales:salesSummary,purchases:purchaseSummary,returns:returnSummary,payables:payableSummary,
      expenses:expenseSummary,cash:cashSummary,inventory:inventorySummary,tcg:tcgSummary,alerts:alertSummary
    },
    sales:sales.rows,purchases:purchases.rows,returns:returns.rows,payables:payables.rows,
    expenses:expenses.rows,cash:cash.rows,inventory:inventory.rows,tcg:tcg.rows,
    alerts:alerts.rows
  };
}

export async function auditIntegrity(scope){
  const incidents=[];
  const scoped=scope&&!scope.all&&scope.allowed?.length;
  const allowed=scoped?scope.allowed:[];

  const productNegative=await query(`SELECT id_registro,id_sucursal,sucursal,id_producto,sku,producto,stock
    FROM gmx.inventario_sucursales
    WHERE COALESCE(stock,0)<0 ${scoped?'AND id_sucursal=ANY($1::text[])':''}
    LIMIT 500`,scoped?[allowed]:[]);
  productNegative.rows.forEach(x=>incidents.push({module:'INVENTARIO',severity:'HIGH',branch:x.sucursal,reference:x.id_registro,type:'NEGATIVE_PRODUCT_STOCK',message:`${x.producto}: stock ${x.stock}.`}));

  const tcgNegative=await query(`SELECT id_registro,id_sucursal,sucursal,id_inventario,sku,stock,stock_reservado
    FROM gmx.tcg_inventario_sucursales
    WHERE (COALESCE(stock,0)<0 OR COALESCE(stock_reservado,0)>COALESCE(stock,0))
      ${scoped?'AND id_sucursal=ANY($1::text[])':''} LIMIT 500`,scoped?[allowed]:[]);
  tcgNegative.rows.forEach(x=>incidents.push({module:'TCG',severity:'HIGH',branch:x.sucursal,reference:x.id_registro,type:n(x.stock)<0?'NEGATIVE_TCG_STOCK':'RESERVED_EXCEEDS_STOCK',message:`Stock ${x.stock}; reservado ${x.stock_reservado}.`}));

  const canceledOrders=await query(`SELECT id_pedido,id_sucursal,sucursal,estado_pedido,inventario_liberado
    FROM gmx.pedidos WHERE UPPER(COALESCE(estado_pedido,'')) IN ('CANCELADO','CANCELADA')
      AND COALESCE(inventario_liberado,false)=false
      ${scoped?'AND id_sucursal=ANY($1::text[])':''} LIMIT 500`,scoped?[allowed]:[]);
  canceledOrders.rows.forEach(x=>incidents.push({module:'VENTAS',severity:'MEDIUM',branch:x.sucursal,reference:x.id_pedido,type:'CANCELLED_STOCK_NOT_RELEASED',message:'Pedido cancelado sin inventario liberado.'}));

  const cash=await query(`SELECT id_sucursal,sucursal,COUNT(*)::bigint abiertas
    FROM gmx.caja_sesiones WHERE UPPER(COALESCE(estado,''))='ABIERTA'
      ${scoped?'AND id_sucursal=ANY($1::text[])':''}
    GROUP BY id_sucursal,sucursal HAVING COUNT(*)>1`,scoped?[allowed]:[]);
  cash.rows.forEach(x=>incidents.push({module:'CAJA',severity:'HIGH',branch:x.sucursal,reference:x.id_sucursal,type:'MULTIPLE_OPEN_CASH',message:`${x.abiertas} cajas abiertas simultáneamente.`}));

  const purchaseMismatch=await query(`SELECT id_compra,id_sucursal_recepcion,sucursal_recepcion,unidades_solicitadas,unidades_recibidas,estado
    FROM gmx.compras WHERE UPPER(COALESCE(estado,''))='RECIBIDA'
      AND COALESCE(unidades_recibidas,0)<>COALESCE(unidades_solicitadas,0)
      ${scoped?'AND id_sucursal_recepcion=ANY($1::text[])':''} LIMIT 500`,scoped?[allowed]:[]);
  purchaseMismatch.rows.forEach(x=>incidents.push({module:'COMPRAS',severity:'MEDIUM',branch:x.sucursal_recepcion,reference:x.id_compra,type:'RECEIVED_UNITS_MISMATCH',message:`Recibidas ${x.unidades_recibidas} de ${x.unidades_solicitadas}.`}));

  const payable=await query(`SELECT id,id_sucursal,sucursal,proveedor,total,pagado,saldo
    FROM gmx.cuentas_por_pagar
    WHERE UPPER(COALESCE(estado,''))<>'CANCELADA'
      AND ABS(COALESCE(total,0)-COALESCE(pagado,0)-COALESCE(saldo,0))>0.01
      ${scoped?'AND (id_sucursal IS NULL OR id_sucursal=ANY($1::text[]))':''} LIMIT 500`,scoped?[allowed]:[]);
  payable.rows.forEach(x=>incidents.push({module:'CXP',severity:'HIGH',branch:x.sucursal,reference:x.id,type:'PAYABLE_BALANCE_MISMATCH',message:`Total ${x.total}; pagado ${x.pagado}; saldo ${x.saldo}.`}));

  const expenseCash=await query(`SELECT id_gasto,id_sucursal,sucursal,metodo_pago,estado,caja_registrada,id_movimiento_caja
    FROM gmx.gastos WHERE UPPER(COALESCE(estado,''))='PAGADO'
      AND UPPER(COALESCE(metodo_pago,''))='EFECTIVO'
      AND COALESCE(caja_registrada,false)=false
      ${scoped?'AND id_sucursal=ANY($1::text[])':''} LIMIT 500`,scoped?[allowed]:[]);
  expenseCash.rows.forEach(x=>incidents.push({module:'EGRESOS',severity:'HIGH',branch:x.sucursal,reference:x.id_gasto,type:'PAID_CASH_EXPENSE_NOT_IN_CASH',message:'Egreso efectivo pagado sin movimiento de caja registrado.'}));

  const unresolvedAlerts=await query(`SELECT row_id,titulo,prioridad,id_sucursal,sucursal,referencia
    FROM gmx.notificaciones_admin WHERE COALESCE(resuelta,false)=false
      AND UPPER(COALESCE(prioridad,''))='CRITICA'
      ${scoped?'AND (id_sucursal IS NULL OR id_sucursal=ANY($1::text[]))':''}
    ORDER BY fecha DESC LIMIT 500`,scoped?[allowed]:[]);
  unresolvedAlerts.rows.forEach(x=>incidents.push({module:'ALERTAS',severity:'HIGH',branch:x.sucursal,reference:x.referencia||x.row_id,type:'CRITICAL_ALERT_OPEN',message:x.titulo}));

  const high=incidents.filter(x=>x.severity==='HIGH').length;
  const medium=incidents.filter(x=>x.severity==='MEDIUM').length;
  return {
    generatedAt:new Date().toISOString(),readOnly:true,
    summary:{incidents:incidents.length,high,medium,low:incidents.length-high-medium,status:high?'ATTENTION':medium?'REVIEW':'OK'},
    incidents
  };
}

