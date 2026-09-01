import { brandText } from "../config/brand.js";import { Router } from 'express';
import {
  listProviders, saveProvider, listQuotes, getQuote, createQuote, sendQuoteEmail, updateQuoteStatus, convertQuote,
  listPayables, listPayablePayments, createPayable, createPayableFromPurchase, syncCreditPurchasePayables, payPayable,
  listExpenses, createExpense, payExpense, cancelExpense,
  listReturns, getReturn, createSaleReturn, orderForReturn, commercialHealth } from
'../repositories/commercialRepository.js';

import {
  authorizePosReturn,
  claimPosReturnAuthorization,
  releasePosReturnAuthorization,
  finalizePosReturnAuthorization } from
'../operationAuthorizationService.js';

import {
  getReturnAuthorizationCapability,
  issueCurrentUserReturnAuthorization,
  generateReturnPin,
  redeemReturnPin
} from '../returnPinAuthorizationService.js';

const router = Router();
router.get('/health', async (_req, res) => {try {res.json({ success: true, data: await commercialHealth() });} catch (e) {res.status(500).json({ success: false, error: e.message });}});

const bad = (res, e, status = 400) => res.status(status).json({ success: false, error: e.message, message: e.message });

router.get('/providers', async (req, res) => {try {const r = await listProviders(req.query);res.json({ success: true, data: r.rows });} catch (e) {bad(res, e, 500);}});
router.post('/providers', async (req, res) => {try {res.status(201).json({ success: true, data: await saveProvider(null, req.body || {}, req.user) });} catch (e) {bad(res, e);}});
router.put('/providers/:rowId', async (req, res) => {try {res.json({ success: true, data: await saveProvider(Number(req.params.rowId), req.body || {}, req.user) });} catch (e) {bad(res, e);}});

router.get('/quotes', async (req, res) => {try {const r = await listQuotes(req.query);res.json({ success: true, data: r.rows });} catch (e) {bad(res, e, 500);}});
router.get('/quotes/:rowId', async (req, res) => {try {const d = await getQuote(Number(req.params.rowId));if (!d) return res.status(404).json({ success: false, error: 'QUOTE_NOT_FOUND' });res.json({ success: true, data: d });} catch (e) {bad(res, e, 500);}});
router.post('/quotes', async (req, res) => {try {res.status(201).json({ success: true, data: await createQuote(req.body || {}, req.user) });} catch (e) {bad(res, e);}});
router.post('/quotes/:rowId/send', async (req, res) => {
  try {res.json({ success: true, data: await sendQuoteEmail(Number(req.params.rowId), req.user) });}
  catch (e) {
    const code = String(e.message || e);
    const messages = {
      QUOTE_EMAIL_REQUIRED: 'La cotización no tiene un correo de cliente.',
      QUOTE_EMAIL_INVALID: 'El correo del cliente no tiene un formato válido.',
      QUOTE_SMTP_NOT_CONFIGURED: brandText("El servicio de correo SMTP de GMX no está configurado."),
      QUOTE_EMAIL_SEND_FAILED: 'No fue posible enviar el correo. La cotización permanece sin marcar como enviada.',
      QUOTE_NOT_SENDABLE: 'Esta cotización ya no puede enviarse por su estado actual.'
    };
    const message = messages[code] || code;
    res.status(400).json({ success: false, error: message, message });
  }
});
router.post('/quotes/:rowId/status', async (req, res) => {try {res.json({ success: true, data: await updateQuoteStatus(Number(req.params.rowId), req.body?.status, req.user) });} catch (e) {bad(res, e);}});
router.post('/quotes/:rowId/convert', async (req, res) => {try {res.json({ success: true, data: await convertQuote(Number(req.params.rowId), req.body || {}, req.user) });} catch (e) {bad(res, e);}});

router.get('/payables', async (req, res) => {try {const r = await listPayables(req.query);res.json({ success: true, data: r.rows });} catch (e) {bad(res, e, 500);}});
router.get('/payables/:id/payments', async (req, res) => {try {const r = await listPayablePayments(req.params.id);res.json({ success: true, data: r.rows });} catch (e) {bad(res, e, 500);}});
router.post('/payables', async (req, res) => {try {res.status(201).json({ success: true, data: await createPayable(req.body || {}, req.user) });} catch (e) {bad(res, e);}});
router.post('/payables/sync-purchases', async (req, res) => {
  try {res.json({ success: true, data: await syncCreditPurchasePayables(req.user) });}
  catch (e) {bad(res, e);}
});
router.post('/payables/from-purchase/:rowId', async (req, res) => {try {res.status(201).json({ success: true, data: await createPayableFromPurchase(Number(req.params.rowId), req.user) });} catch (e) {bad(res, e);}});
router.post('/payables/:id/pay', async (req, res) => {try {res.json({ success: true, data: await payPayable(req.params.id, req.body || {}, req.user) });} catch (e) {bad(res, e);}});

router.get('/expenses', async (req, res) => {try {const r = await listExpenses(req.query);res.json({ success: true, data: r.rows });} catch (e) {bad(res, e, 500);}});
router.post('/expenses', async (req, res) => {try {res.status(201).json({ success: true, data: await createExpense(req.body || {}, req.user) });} catch (e) {bad(res, e);}});
router.post('/expenses/:rowId/pay', async (req, res) => {try {res.json({ success: true, data: await payExpense(Number(req.params.rowId), req.body || {}, req.user) });} catch (e) {bad(res, e);}});
router.post('/expenses/:rowId/cancel', async (req, res) => {try {res.json({ success: true, data: await cancelExpense(Number(req.params.rowId), String(req.body?.reason || ''), req.user) });} catch (e) {bad(res, e);}});

router.get('/returns', async (req, res) => {try {const r = await listReturns(req.query);res.json({ success: true, data: r.rows });} catch (e) {bad(res, e, 500);}});
router.get('/returns/:id', async (req, res) => {try {const d = await getReturn(req.params.id);if (!d) return res.status(404).json({ success: false, error: 'RETURN_NOT_FOUND' });res.json({ success: true, data: d });} catch (e) {bad(res, e, 500);}});
router.get('/returns-order/:id', async (req, res) => {try {const d = await orderForReturn(req.params.id);if (!d) return res.status(404).json({ success: false, error: 'ORDER_NOT_FOUND' });res.json({ success: true, data: d });} catch (e) {bad(res, e, 500);}});


router.get('/returns/authorization/capability', async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getReturnAuthorizationCapability(req.user)
    });
  } catch (e) {
    bad(res, e, Number(e?.statusCode || 400));
  }
});

router.post('/returns/authorize-current', async (req, res) => {
  try {
    const data = await issueCurrentUserReturnAuthorization({
      orderId: req.body?.orderId || req.body?.reference || '',
      requester: req.user,
      ip: req.ip || req.socket?.remoteAddress || '',
      userAgent: req.get('user-agent') || ''
    });
    res.json({ success: true, data });
  } catch (e) {
    bad(res, e, Number(e?.statusCode || 400));
  }
});

router.post('/returns/pin/generate', async (req, res) => {
  try {
    const data = await generateReturnPin({
      requester: req.user,
      ip: req.ip || req.socket?.remoteAddress || '',
      userAgent: req.get('user-agent') || ''
    });
    res.status(201).json({ success: true, data });
  } catch (e) {
    bad(res, e, Number(e?.statusCode || 400));
  }
});

router.post('/returns/pin/authorize', async (req, res) => {
  try {
    const data = await redeemReturnPin({
      orderId: req.body?.orderId || req.body?.reference || '',
      pin: req.body?.pin || '',
      requester: req.user
    });
    res.json({ success: true, data });
  } catch (e) {
    bad(res, e, Number(e?.statusCode || 400));
  }
});

router.post('/returns/authorize', async (req, res) => {
  try {
    const data = await authorizePosReturn({
      orderId: req.body?.orderId || req.body?.reference || '',
      email: req.body?.email || '',
      password: req.body?.password || '',
      requester: req.user,
      ip: req.ip || req.socket?.remoteAddress || '',
      userAgent: req.get('user-agent') || ''
    });

    res.json({
      success: true,
      data
    });
  } catch (e) {
    const status = Number(e?.statusCode || 400);

    res.status(status).json({
      success: false,
      error: String(e?.message || e),
      message: String(e?.message || e),
      branchId: e?.branchId || null,
      allowedBranches: Array.isArray(e?.allowedBranches) ?
      e.allowedBranches :
      undefined
    });
  }
});

router.post('/returns/sale', async (req, res) => {
  let claim = null;
  let returnCreated = false;

  try {
    let authorizationToken = String(
      req.body?.authorizationToken ||
      req.get('x-return-authorization') ||
      ''
    ).trim();

    const orderId = String(
      req.body?.reference ||
      req.body?.orderId ||
      ''
    ).trim();

    if (!authorizationToken) {
      const direct = await issueCurrentUserReturnAuthorization({
        orderId,
        requester: req.user,
        ip: req.ip || req.socket?.remoteAddress || '',
        userAgent: req.get('user-agent') || ''
      });
      authorizationToken = String(direct?.authorizationToken || '').trim();
    }

    claim = await claimPosReturnAuthorization({
      token: authorizationToken,
      orderId,
      requester: req.user
    });

    const payload = { ...(req.body || {}), orderId };
    delete payload.authorizationToken;

    const data = await createSaleReturn(
      payload,
      req.user,
      req.access
    );

    // Desde este punto la devolucion ya fue confirmada por su propia
    // transacci?n. Nunca se debe liberar/reutilizar la autorizaci?n.
    returnCreated = true;

    await finalizePosReturnAuthorization({
      authorizationId: claim.authorizationId,
      claimId: claim.claimId,
      returnId: data?.id || ''
    });

    res.status(201).json({
      success: true,
      data: {
        ...data,
        autorizacion: {
          id: claim.authorizationId,
          autorizador_id: claim.authorizerId,
          autorizador_email: claim.authorizerEmail
        }
      }
    });

  } catch (e) {

    // Solo liberamos el claim cuando la devolucion NO llego a crearse.
    // Si createSaleReturn ya confirmo su transaccion, la autorizacion
    // permanece consumida incluso si falla el registro final de referencia.
    if (!returnCreated && claim?.authorizationId && claim?.claimId) {
      try {
        await releasePosReturnAuthorization({
          authorizationId: claim.authorizationId,
          claimId: claim.claimId
        });
      } catch (_releaseError) {}
    }

    if (String(e?.message || '') === 'BRANCH_FORBIDDEN') {
      return res.status(403).json({
        success: false,
        error: 'BRANCH_FORBIDDEN',
        message: 'BRANCH_FORBIDDEN',
        branchId: e.branchId || null,
        allowedBranches: Array.isArray(e.allowedBranches) ?
        e.allowedBranches :
        req.access?.branchScope?.allowed || []
      });
    }

    const status = Number(e?.statusCode || 400);
    bad(res, e, status);
  }
});



/* ============================================================
   SHINY_DEV_008_REFUND_STATE_ROUTE

   PATCH
   /returns/refunds/:refundId/status
   ============================================================ */

router.patch(
  '/returns/refunds/:refundId/status',
  async (req, res) => {

    try {

      /*
       * Dynamic import intencional:
       * evita modificar manualmente el bloque de imports
       * del router y mantiene este fix autocontenido.
       */
      const {
        updateRefundStatus
      } = await import(
      '../repositories/commercialRepository.js'
      );

      const data =
      await updateRefundStatus(
        String(
          req.params.refundId ||
          ''
        ).trim(),
        req.body || {},
        req.user || null
      );

      res.json({
        success: true,
        data
      });

    } catch (e) {

      const code =
      String(
        e.message || e
      );

      let status = 400;

      if (
      code === 'REFUND_NOT_FOUND')
      {
        status = 404;
      }

      if (
      code.startsWith(
        'REFUND_STATUS_TRANSITION_FORBIDDEN_'
      ))
      {
        status = 409;
      }

      res.status(status).json({
        success: false,
        error: code,
        message: code
      });
    }
  }
);


export default router;
