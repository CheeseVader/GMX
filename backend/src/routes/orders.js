import { Router } from 'express';
import { publishStorefrontUpdate } from '../storefrontLiveSync.js';
import {
  listOrders,
  getOrder,
  createSale,
  cancelSale,
  searchPosCatalog,
  sendOrderReceiptEmail,
  prepareGuestOrderWhatsApp,
  createPendingAdminOrder,
  payPendingOrder
} from '../repositories/ordersRepository.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const branchId = String(req.query.branchId || '').trim();
    const status = String(req.query.status || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const result = await listOrders({
      search,
      branchId,
      status,
      limit,
      offset
    });

    res.json({
      success: true,
      data: result.rows,
      count: result.rowCount,
      limit,
      offset,
      ms: result.ms
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ORDER_LIST_FAILED',
      message: error.message
    });
  }
});

router.get('/:rowId', async (req, res) => {
  try {
    const order = await getOrder(Number(req.params.rowId));

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'ORDER_NOT_FOUND'
      });
    }

    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ORDER_GET_FAILED',
      message: error.message
    });
  }
});


router.get('/pos/catalog',async(req,res)=>{
  try{
    const result=await searchPosCatalog({
      branchId:String(req.query.branchId||'').trim(),
      type:String(req.query.type||'ALL').trim(),
      search:String(req.query.search||'').trim(),
      gameId:String(req.query.gameId||'').trim(),
      setId:String(req.query.setId||'').trim(),
      limit:Number(req.query.limit||120)
    });
    res.json({success:true,data:result.rows,count:result.rowCount});
  }catch(error){
    res.status(500).json({success:false,error:'POS_CATALOG_FAILED',message:error.message});
  }
});

// SHINY_POS_FIX_002
router.post('/pos', async (req, res) => {
  try {
    const data = await createSale({
      branchId: String(req.body.branchId || '').trim(),
      clientId: String(req.body.clientId || '').trim(),
      saleRequestId: String(req.body.saleRequestId || '').trim(),
      paymentMethod: String(req.body.paymentMethod || 'EFECTIVO').trim(),
      paymentReference: String(req.body.paymentReference || '').trim(),
      cashReceived: req.body.cashReceived==null?null:Number(req.body.cashReceived),
      payments: Array.isArray(req.body.payments)?req.body.payments:[],
      notes: String(req.body.notes || '').trim(),
      promoCode: String(req.body.promoCode || '').trim(),
      pointsToRedeem: Number(req.body.pointsToRedeem || 0),
      manualDiscountType: String(req.body.manualDiscountType || '').trim(),
      manualDiscountValue: Number(req.body.manualDiscountValue || 0),
      manualDiscountReason: String(req.body.manualDiscountReason || '').trim(),
      manualDiscountPin: String(req.body.manualDiscountPin || '').trim(),
      user: req.user,
      items: Array.isArray(req.body.items) ? req.body.items : []
    });

    res.status(201).json({success:true,data});
    publishStorefrontUpdate({
      sections:['inventory'],
      reason:'POS_SALE',
      actor:req.user?.email||'POS',
      changes:data.inventory_updates||[]
    }).catch(()=>{});
  } catch (error) {
    const code=String(error.message||error);
    let message=code;
    if(code==='MEMBERSHIP_TCG_ALREADY_ACTIVE'){
      message='El cliente ya cuenta con una membresia activa o programada para ese TCG.';
    }else if(code==='POS_CLIENT_REQUIRED'){
      message='Selecciona un cliente GMX existente antes de cobrar en POS.';
    }else if(code==='MEMBERSHIP_CLIENT_REQUIRED'){
      message='La venta de una membresia requiere seleccionar un cliente GMX existente.';
    }else if(code==='MEMBERSHIP_QUANTITY_ONE_REQUIRED'){
      message='Cada SKU de membresia debe venderse con cantidad 1.';
    }else if(code==='SALE_REQUEST_ID_REQUIRED'){
      message='No fue posible identificar este intento de venta. Vuelve a intentarlo.';
    }else if(code==='INVALID_SALE_REQUEST_ID'){
      message='El identificador del intento de venta no es válido.';
    }else if(code==='CASH_SESSION_REQUIRED'){
      message='Debes abrir una caja en esta sucursal antes de cobrar una venta en efectivo.';
    }else if(code==='INSUFFICIENT_CASH_RECEIVED'){
      message='El efectivo recibido debe ser igual o mayor al importe asignado a efectivo.';
    }else if(code==='PAYMENT_TOTAL_INCOMPLETE'){
      message='La suma de los métodos de pago es menor al total de la venta.';
    }else if(code==='PAYMENT_TOTAL_EXCEEDED'){
      message='La suma de los métodos de pago excede el total de la venta.';
    }else if(code==='INVALID_PAYMENT_AMOUNT'){
      message='Cada método de pago debe tener un importe mayor a cero.';
    }else if(code==='CARD_PROVIDER_REQUIRED'){
      message='El importe con tarjeta requiere confirmación de Mercado Pago. La integración queda preparada para su auditoría posterior.';
    }else if(code==='INVALID_PAYMENT_METHOD'){
      message='Selecciona un método de pago válido.';
    }else if(code==='MANUAL_DISCOUNT_PIN_INVALID_FORMAT'){
      message='El código de autorización debe contener exactamente 4 dígitos.';
    }else if(code==='MANUAL_DISCOUNT_PIN_INVALID_OR_EXPIRED'){
      message='El código de autorización es incorrecto o ya venció.';
    }else if(code==='MANUAL_DISCOUNT_PIN_ALREADY_USED'){
      message='Este código de autorización ya fue utilizado. Genera uno nuevo.';
    }else if(code==='MANUAL_DISCOUNT_AUTHORIZATION_FORBIDDEN'){
      message='El código no tiene permiso para autorizar descuentos en esta sucursal.';
    }else if(code==='MANUAL_DISCOUNT_FORBIDDEN'){
      message='Tu usuario no tiene autorización para aplicar descuentos manuales.';
    }else if(code==='INVALID_MANUAL_DISCOUNT_TYPE'){
      message='Selecciona un tipo de descuento manual válido: porcentaje o monto.';
    }else if(code==='INVALID_MANUAL_DISCOUNT_VALUE'){
      message='El valor del descuento manual debe ser mayor a cero.';
    }else if(code==='INVALID_MANUAL_DISCOUNT_PERCENT'){
      message='El porcentaje de descuento manual no puede ser mayor a 100%.';
    }else if(code==='MANUAL_DISCOUNT_REASON_REQUIRED'){
      message='Indica el motivo del descuento manual.';
    }else if(code==='MANUAL_DISCOUNT_EXCEEDS_TOTAL'){
      message='El descuento manual no puede ser mayor al total disponible de la venta.';
    }else if(code.startsWith('INSUFFICIENT_STOCK:')){
      message='El producto acaba de agotarse o ya fue vendido desde otro dispositivo. Actualiza el carrito.';
    }else if(code.startsWith('INSUFFICIENT_TCG_STOCK:')||code.startsWith('INSUFFICIENT_TCG_GLOBAL_STOCK:')){
      message='La carta TCG acaba de agotarse o ya fue vendida desde otro dispositivo. Actualiza el carrito.';
    }
    res.status(409).json({success:false,error:code,message});
  }
});

router.post('/admin-pending', async (req, res) => {
  try {
    const data = await createPendingAdminOrder({
      branchId: String(req.body.branchId || '').trim(),
      clientId: String(req.body.clientId || '').trim(),
      notes: String(req.body.notes || '').trim(),
      items: Array.isArray(req.body.items) ? req.body.items : [],
      user: req.user
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    const code = String(error.message || error);
    res.status(400).json({ success: false, error: code, message: code });
  }
});



router.post('/:rowId/pay',async(req,res)=>{
  try{
    const data=await payPendingOrder(Number(req.params.rowId),{
      paymentMethod:String(req.body.paymentMethod||'EFECTIVO').trim(),
      paymentReference:String(req.body.paymentReference||'').trim(),
      notes:String(req.body.notes||'').trim(),
      user:req.user
    });
    res.json({success:true,data});
    publishStorefrontUpdate({
      sections:['inventory'],
      reason:'ORDER_PAYMENT',
      actor:req.user?.email||'ADMIN',
      changes:data.inventory_updates||[]
    }).catch(()=>{});
  }catch(error){
    const code=String(error.message||error);
    const messages={
      ORDER_NOT_FOUND:'No se encontró el pedido.',
      ORDER_CANCELLED:'El pedido está cancelado y no puede pagarse.',
      ORDER_NOT_PENDING:'Solo los pedidos pendientes pueden registrar pago.',
      ORDER_WITHOUT_BRANCH:'El pedido no tiene una sucursal asignada.',
      ORDER_WITHOUT_DETAILS:'El pedido no tiene partidas para cobrar.',
      BRANCH_NOT_FOUND:'No se encontró la sucursal del pedido.',
      INVALID_PAYMENT_METHOD:'Selecciona un método de pago válido.',
      CASH_SESSION_REQUIRED:'Debes abrir una caja en esta sucursal antes de registrar un pago en efectivo.'
    };

    let message=messages[code]||code;
    if(code.startsWith('INSUFFICIENT_STOCK:')){
      message=`No hay stock suficiente para el producto ${code.split(':')[1]}.`;
    }else if(code.startsWith('INSUFFICIENT_TCG_STOCK:')||code.startsWith('INSUFFICIENT_TCG_GLOBAL_STOCK:')){
      message=`No hay stock suficiente para la carta TCG ${code.split(':')[1]}.`;
    }else if(code.startsWith('TCG_INVENTORY_NOT_FOUND:')){
      message=`No se encontró la variante TCG ${code.split(':')[1]} en la sucursal.`;
    }else if(code.startsWith('INVENTORY_NOT_FOUND:')){
      message=`No se encontró inventario del producto ${code.split(':')[1]} en la sucursal.`;
    }

    res.status(400).json({success:false,error:message,message});
  }
});

router.post('/:rowId/receipt/email',async(req,res)=>{
  try{
    res.json({success:true,data:await sendOrderReceiptEmail(Number(req.params.rowId),req.user,String(req.body.email||''))});
  }catch(error){
    const code=String(error.message||error);
    const messages={
      ORDER_NOT_FOUND:'No se encontró el pedido.',
      ORDER_EMAIL_REQUIRED:'El cliente no tiene un correo registrado.',
      ORDER_EMAIL_INVALID:'El correo del cliente no tiene un formato válido.',
      ORDER_SMTP_NOT_CONFIGURED:'Configura primero el servicio de correo en Sistema → Correo / SMTP.',
      ORDER_RECEIPT_EMAIL_FAILED:'No fue posible enviar el comprobante por correo.'
    };
    let message=messages[code]||code;
    const d=error?.smtpDiagnostic;
    if(d&&code==='ORDER_RECEIPT_EMAIL_FAILED'){
      const detail=[d.code?`Código: ${d.code}`:'',d.responseCode?`SMTP: ${d.responseCode}`:'',d.response?`Respuesta: ${d.response}`:''].filter(Boolean).join(' · ');
      if(detail)message=`${message} ${detail}`;
    }
    res.status(400).json({success:false,error:message,message});
  }
});

router.post('/:rowId/receipt/whatsapp',async(req,res)=>{
  try{
    const data=await prepareGuestOrderWhatsApp(Number(req.params.rowId),String(req.body.phone||''),req.user);
    res.json({success:true,data});
  }catch(error){
    const code=String(error.message||error);
    const messages={
      ORDER_NOT_FOUND:'No se encontró el pedido.',
      ORDER_WHATSAPP_PHONE_INVALID:'Captura un teléfono válido con 10 dígitos o con código de país.',
      ORDER_REGISTERED_CLIENT_CONTACT_LOCKED:'Este pedido pertenece a un cliente registrado; utiliza su correo o contacto guardado.'
    };
    res.status(400).json({success:false,error:code,message:messages[code]||code});
  }
});

router.post('/:rowId/cancel', async (req, res) => {
  try {
    const data = await cancelSale(
      Number(req.params.rowId),
      String(req.body.reason || '').trim(),
      req.user
    );

    res.json({
      success: true,
      data
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
      message: error.message
    });
  }
});

export default router;
