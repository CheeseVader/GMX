import { brandText } from "./config/brand.js";import crypto from 'node:crypto';
import Stripe from 'stripe';
import { MercadoPagoConfig, Payment, WebhookSignatureValidator, InvalidWebhookSignatureError, PaymentRefund } from 'mercadopago';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from './db.js';import { queueAndSendEmail, paymentReceiptHtml, transferInstructionsHtml } from './emailService.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.dirname(HERE);
const PROOF_DIR = path.join(BACKEND_DIR, 'storage', 'payment-proofs');
const uid = (p) => `${p}-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;



/* ============================================================
   SHINY_MP_001_PROVIDER_CONFIGURATION

   Mercado Pago credentials are environment-only.

   SHINY_MERCADOPAGO_ENVIRONMENT:
     TEST
     PRODUCTION

   TEST:
     SHINY_MERCADOPAGO_TEST_ACCESS_TOKEN
     SHINY_MERCADOPAGO_TEST_PUBLIC_KEY
     SHINY_MERCADOPAGO_TEST_WEBHOOK_SECRET

   PRODUCTION:
     SHINY_MERCADOPAGO_PROD_ACCESS_TOKEN
     SHINY_MERCADOPAGO_PROD_PUBLIC_KEY
     SHINY_MERCADOPAGO_PROD_WEBHOOK_SECRET
   ============================================================ */

export function mercadoPagoEnvironment() {

  const value =
  String(
    process.env.SHINY_MERCADOPAGO_ENVIRONMENT ||
    'TEST'
  ).
  trim().
  toUpperCase();

  if (
  value !== 'TEST' &&
  value !== 'PRODUCTION')
  {
    throw new Error(
      'MERCADOPAGO_INVALID_ENVIRONMENT'
    );
  }

  return value;
}

function mercadoPagoCredentials() {

  const environment =
  mercadoPagoEnvironment();

  if (
  environment === 'PRODUCTION')
  {

    return {
      environment,

      accessToken:
      String(
        process.env.SHINY_MERCADOPAGO_PROD_ACCESS_TOKEN ||
        ''
      ).trim(),

      publicKey:
      String(
        process.env.SHINY_MERCADOPAGO_PROD_PUBLIC_KEY ||
        ''
      ).trim(),

      webhookSecret:
      String(
        process.env.SHINY_MERCADOPAGO_PROD_WEBHOOK_SECRET ||
        ''
      ).trim()
    };
  }

  return {
    environment,

    accessToken:
    String(
      process.env.SHINY_MERCADOPAGO_TEST_ACCESS_TOKEN ||
      ''
    ).trim(),

    publicKey:
    String(
      process.env.SHINY_MERCADOPAGO_TEST_PUBLIC_KEY ||
      ''
    ).trim(),

    webhookSecret:
    String(
      process.env.SHINY_MERCADOPAGO_TEST_WEBHOOK_SECRET ||
      ''
    ).trim()
  };
}

export function mercadoPagoClient() {

  const credentials =
  mercadoPagoCredentials();

  if (
  !credentials.accessToken)
  {
    return null;
  }

  return new MercadoPagoConfig({
    accessToken:
    credentials.accessToken
  });
}

export function mercadoPagoConfigured() {

  return Boolean(
    mercadoPagoCredentials().
    accessToken
  );
}

export function mercadoPagoConfigStatus() {

  const credentials =
  mercadoPagoCredentials();

  return {
    provider:
    'MERCADOPAGO',

    environment:
    credentials.environment,

    configured:
    Boolean(
      credentials.accessToken
    ),

    access_token_configured:
    Boolean(
      credentials.accessToken
    ),

    public_key_configured:
    Boolean(
      credentials.publicKey
    ),

    webhook_secret_configured:
    Boolean(
      credentials.webhookSecret
    )
  };
}

function stripeClient() {
  const key = String(process.env.SHINY_STRIPE_SECRET_KEY || '').trim();
  if (!key) return null;
  return new Stripe(key);
}

export function stripeConfigured() {return !!stripeClient();}

export async function transferSettings() {
  const r = await query(`SELECT parametro,valor FROM gmx.configuracion WHERE parametro LIKE 'public.payment.transfer.%'`);
  const m = Object.fromEntries(r.rows.map((x) => [x.parametro, x.valor]));
  return {
    bank_name: m['public.payment.transfer.bank_name'] || process.env.SHINY_TRANSFER_BANK_NAME || '',
    account_holder: m['public.payment.transfer.account_holder'] || process.env.SHINY_TRANSFER_ACCOUNT_HOLDER || '',
    account_number: m['public.payment.transfer.account_number'] || process.env.SHINY_TRANSFER_ACCOUNT_NUMBER || '',
    clabe: m['public.payment.transfer.clabe'] || process.env.SHINY_TRANSFER_CLABE || '',
    instructions: m['public.payment.transfer.instructions'] || process.env.SHINY_TRANSFER_INSTRUCTIONS || '',
    proof_required: String(m['public.payment.transfer.proof_required'] || 'true') === 'true'
  };
}



/* ============================================================
   SHINY_MP_002_PAYMENT_CREATION

   Mercado Pago card payment contract.

   Creation:
     - Provider: MERCADOPAGO
     - Method: CARD
     - Stable idempotency key per order/payment attempt
     - provider_payment_id persisted when Mercado Pago returns it
     - No order may be charged when already PAGADO

   Payment API:
     Payment.create({
       body,
       requestOptions:{
         idempotencyKey
       }
     })
   ============================================================ */

function normalizeMercadoPagoStatus(status) {

  const value =
  String(status || '').
  trim().
  toLowerCase();

  if (
  value === 'approved')
  {
    return 'PAID';
  }

  if (
  [
  'rejected',
  'cancelled',
  'cancelled_by_user'].
  includes(value))
  {
    return 'FAILED';
  }

  if (
  [
  'refunded',
  'charged_back'].
  includes(value))
  {
    return 'REFUNDED';
  }

  return 'PENDING';
}

export async function persistMercadoPagoPayment(
order,
token,
payment,
idempotencyKey)
{

  if (
  !order?.id_pedido)
  {
    throw new Error(
      'ORDER_ID_REQUIRED'
    );
  }

  const providerPaymentId =
  String(
    payment?.id || ''
  ).trim();

  if (
  !providerPaymentId)
  {
    throw new Error(
      'MERCADOPAGO_PAYMENT_ID_MISSING'
    );
  }

  const client =
  await pool.connect();

  try {

    await client.query(
      'BEGIN'
    );

    const orderResult =
    await client.query(
      `SELECT *
         FROM gmx.pedidos
         WHERE id_pedido=$1
         FOR UPDATE`,
      [
      order.id_pedido]

    );

    if (
    !orderResult.rowCount)
    {
      throw new Error(
        'ORDER_NOT_FOUND'
      );
    }

    const currentOrder =
    orderResult.rows[0];

    if (
    String(
      currentOrder.estado_pago || ''
    ).toUpperCase() === 'PAGADO')
    {
      throw new Error(
        'ORDER_ALREADY_PAID'
      );
    }

    const normalizedStatus =
    normalizeMercadoPagoStatus(
      payment.status
    );

    const existingByProvider =
    await client.query(
      `SELECT *
         FROM gmx.payment_transactions
         WHERE proveedor='MERCADOPAGO'
           AND provider_payment_id=$1
         ORDER BY row_id DESC
         LIMIT 1
         FOR UPDATE`,
      [
      providerPaymentId]

    );

    if (
    existingByProvider.rowCount)
    {

      const existing =
      existingByProvider.rows[0];

      if (
      existing.id_pedido !==
      order.id_pedido)
      {
        throw new Error(
          'PROVIDER_PAYMENT_ID_ALREADY_USED'
        );
      }

      await client.query(
        'COMMIT'
      );

      return {
        transaction:
        existing,

        reused:
        true
      };
    }

    const existingIdem =
    await client.query(
      `SELECT *
         FROM gmx.payment_transactions
         WHERE idempotency_key=$1
         ORDER BY row_id DESC
         LIMIT 1
         FOR UPDATE`,
      [
      idempotencyKey]

    );

    if (
    existingIdem.rowCount)
    {

      const existing =
      existingIdem.rows[0];

      if (
      existing.id_pedido !==
      order.id_pedido)
      {
        throw new Error(
          'IDEMPOTENCY_KEY_ALREADY_USED'
        );
      }

      await client.query(
        'COMMIT'
      );

      return {
        transaction:
        existing,

        reused:
        true
      };
    }

    const txId =
    uid('PAY');

    const metadata = {
      payment_method_id:
      payment.payment_method_id ||
      null,

      payment_type_id:
      payment.payment_type_id ||
      null,

      status:
      payment.status ||
      null,

      status_detail:
      payment.status_detail ||
      null,

      external_reference:
      payment.external_reference ||
      order.id_pedido,

      date_created:
      payment.date_created ||
      null,

      date_approved:
      payment.date_approved ||
      null
    };

    const inserted =
    await client.query(
      `INSERT INTO gmx.payment_transactions(
          id_transaccion,
          id_pedido,
          public_token,
          proveedor,
          metodo,
          estado,
          monto,
          moneda,
          provider_session_id,
          provider_payment_id,
          metadata_json,
          idempotency_key
        )
        VALUES(
          $1,$2,$3,
          'MERCADOPAGO',
          'CARD',
          $4,$5,$6,
          $7,$8,$9::jsonb,$10
        )
        RETURNING *`,
      [
      txId,
      order.id_pedido,
      token || order.public_token || null,
      normalizedStatus,
      Number(
        payment.transaction_amount ??
        order.total ??
        0
      ),
      String(
        payment.currency_id ||
        'MXN'
      ).toUpperCase(),
      providerPaymentId,
      providerPaymentId,
      JSON.stringify(metadata),
      idempotencyKey]

    );

    await client.query(
      `UPDATE gmx.pedidos
       SET
         payment_provider='MERCADOPAGO',
         payment_provider_session=$2,
         referencia_pago=$3,
         estado_pago=$4,
         payment_confirmed_at=
           CASE
             WHEN $4='PAGADO'
               THEN COALESCE(payment_confirmed_at,NOW())
             ELSE payment_confirmed_at
           END,
         fecha_pago=
           CASE
             WHEN $4='PAGADO'
               THEN COALESCE(fecha_pago,NOW())
             ELSE fecha_pago
           END,
         fecha_actualizacion=NOW()
       WHERE id_pedido=$1`,
      [
      order.id_pedido,
      providerPaymentId,
      providerPaymentId,
      normalizedStatus === 'PAID' ?
      'PAGADO' :
      'PENDIENTE']

    );

    await client.query(
      `INSERT INTO gmx.auditoria(
        fecha,
        modulo,
        accion,
        referencia,
        detalle,
        usuario
      )
      VALUES(
        NOW(),
        'PAYMENTS',
        'MERCADOPAGO_PAYMENT',
        $1,
        $2,
        'MERCADOPAGO'
      )`,
      [
      order.id_pedido,
      `payment_id=${providerPaymentId}; status=${payment.status || ''}`]

    );

    await client.query(
      'COMMIT'
    );

    return {
      transaction:
      inserted.rows[0],

      reused:
      false
    };

  } catch (e) {

    try {
      await client.query(
        'ROLLBACK'
      );
    } catch {}

    throw e;

  } finally {

    client.release();
  }
}

export async function createMercadoPagoPaymentForOrder(
order,
token,
paymentInput = {})
{

  /*
   * SHINY_POS_003_MERCADOPAGO
   * Controlled provider seam for certification.
   */
  const providerCall =
  typeof paymentInput.providerCall === 'function' ?
  paymentInput.providerCall :
  null;

  const clientConfig =
  providerCall ?
  null :
  mercadoPagoClient();

  if (
  !providerCall &&
  !clientConfig)
  {
    throw new Error(
      'MERCADOPAGO_NOT_CONFIGURED'
    );
  }

  if (
  !order?.id_pedido)
  {
    throw new Error(
      'ORDER_ID_REQUIRED'
    );
  }

  if (
  String(
    order.estado_pago || ''
  ).toUpperCase() ===
  'PAGADO')
  {
    throw new Error(
      'ORDER_ALREADY_PAID'
    );
  }

  const cardToken =
  String(
    paymentInput.token ||
    paymentInput.cardToken ||
    ''
  ).trim();

  if (
  !cardToken)
  {
    throw new Error(
      'MERCADOPAGO_CARD_TOKEN_REQUIRED'
    );
  }

  const paymentMethodId =
  String(
    paymentInput.paymentMethodId ||
    paymentInput.payment_method_id ||
    ''
  ).trim();

  if (
  !paymentMethodId)
  {
    throw new Error(
      'MERCADOPAGO_PAYMENT_METHOD_REQUIRED'
    );
  }

  const payerEmail =
  String(
    paymentInput.email ||
    paymentInput.payer?.email ||
    order.email ||
    ''
  ).trim();

  if (
  !payerEmail)
  {
    throw new Error(
      'MERCADOPAGO_PAYER_EMAIL_REQUIRED'
    );
  }

  const idempotencyKey =
  String(
    paymentInput.idempotencyKey ||
    `MERCADOPAGO:CARD:${order.id_pedido}:ACTIVE`
  ).trim();

  const body = {
    transaction_amount:
    Number(
      order.total || 0
    ),

    token:
    cardToken,

    description:
    String(
      paymentInput.description || brandText(
        `Pedido Shiny ${order.id_pedido}`)
    ),

    installments:
    Number(
      paymentInput.installments ||
      1
    ),

    payment_method_id:
    paymentMethodId,

    payer: {
      email:
      payerEmail
    },

    external_reference:
    order.id_pedido,

    metadata: {
      id_pedido:
      order.id_pedido,

      public_token:
      token ||
      order.public_token ||
      null
    },

    capture:
    true,

    binary_mode:
    false
  };

  if (
  paymentInput.issuerId ||
  paymentInput.issuer_id)
  {
    body.issuer_id =
    String(
      paymentInput.issuerId ||
      paymentInput.issuer_id
    );
  }

  let payment;

  if (providerCall) {

    payment =
    await providerCall({
      body,
      order,
      token,
      idempotencyKey
    });

  } else {

    const paymentClient =
    new Payment(
      clientConfig
    );

    payment =
    await paymentClient.create({
      body,

      requestOptions: {
        idempotencyKey
      }
    });
  }

  const persisted =
  await persistMercadoPagoPayment(
    order,
    token,
    payment,
    idempotencyKey
  );

  return {
    provider:
    'MERCADOPAGO',

    paymentId:
    String(
      payment.id
    ),

    status:
    payment.status,

    statusDetail:
    payment.status_detail ||
    null,

    payment,

    persisted:
    persisted.transaction,

    reused:
    persisted.reused
  };
}



/* ============================================================
   SHINY_MP_003_PAYMENT_CONFIRMATION

   Mercado Pago state confirmation contract.

   Mercado Pago:
     approved  -> transaction PAID
               -> pedido estado_pago PAGADO
               -> payment_confirmed_at
               -> fecha_pago
               -> referencia_pago = provider payment id

     pending / in_process / authorized
               -> transaction PENDING
               -> pedido remains PENDIENTE

     rejected / cancelled
               -> transaction FAILED
               -> pedido remains PENDIENTE

   Confirmation is idempotent.
   ============================================================ */

export async function applyMercadoPagoPaymentState(
payment)
{

  const providerPaymentId =
  String(
    payment?.id || ''
  ).trim();

  if (
  !providerPaymentId)
  {
    throw new Error(
      'MERCADOPAGO_PAYMENT_ID_MISSING'
    );
  }

  const normalizedStatus =
  normalizeMercadoPagoStatus(
    payment.status
  );

  const client =
  await pool.connect();

  try {

    await client.query(
      'BEGIN'
    );

    const txResult =
    await client.query(
      `SELECT *
         FROM gmx.payment_transactions
         WHERE proveedor='MERCADOPAGO'
           AND provider_payment_id=$1
         ORDER BY row_id DESC
         LIMIT 1
         FOR UPDATE`,
      [
      providerPaymentId]

    );

    if (
    !txResult.rowCount)
    {
      throw new Error(
        'MERCADOPAGO_TRANSACTION_NOT_FOUND'
      );
    }

    const tx =
    txResult.rows[0];

    const orderResult =
    await client.query(
      `SELECT *
         FROM gmx.pedidos
         WHERE id_pedido=$1
         FOR UPDATE`,
      [
      tx.id_pedido]

    );

    if (
    !orderResult.rowCount)
    {
      throw new Error(
        'ORDER_NOT_FOUND'
      );
    }

    const order =
    orderResult.rows[0];

    const externalReference =
    String(
      payment.external_reference ||
      ''
    ).trim();

    if (
    externalReference &&
    externalReference !==
    order.id_pedido)
    {
      throw new Error(
        'MERCADOPAGO_ORDER_MISMATCH'
      );
    }

    const currentTxStatus =
    String(
      tx.estado || ''
    ).toUpperCase();

    const currentOrderStatus =
    String(
      order.estado_pago || ''
    ).toUpperCase();

    /*
     * Already fully confirmed.
     * Same payment + same order = safe replay.
     */

    /*
     * POS-003:
     *
     * PAID transaction + PAGADO financial state alone do not
     * mean that the POS sale lifecycle is fully confirmed.
     *
     * persistMercadoPagoPayment() may already have stored those
     * financial states before this function executes.
     *
     * Safe replay is allowed only when the complete order state
     * is already terminal as well.
     */
    const currentSaleConfirmed =
    order.venta_confirmada === true;

    const currentOrderLifecycleStatus =
    String(
      order.estado_pedido || ''
    ).toUpperCase();

    if (
    currentTxStatus === 'PAID' &&
    currentOrderStatus === 'PAGADO' &&
    currentSaleConfirmed &&
    currentOrderLifecycleStatus === 'PAGADO')
    {

      await client.query(
        'COMMIT'
      );

      return {
        paid: true,
        reused: true,
        changed: false,
        transaction: tx,
        order
      };
    }

    const metadata = {
      ...(
      tx.metadata_json &&
      typeof tx.metadata_json === 'object' ?
      tx.metadata_json :
      {}),


      payment_method_id:
      payment.payment_method_id ||
      null,

      payment_type_id:
      payment.payment_type_id ||
      null,

      status:
      payment.status ||
      null,

      status_detail:
      payment.status_detail ||
      null,

      external_reference:
      payment.external_reference ||
      order.id_pedido,

      date_created:
      payment.date_created ||
      null,

      date_approved:
      payment.date_approved ||
      null,

      date_last_updated:
      payment.date_last_updated ||
      null
    };

    await client.query(
      `UPDATE gmx.payment_transactions
       SET
         estado=$2,
         monto=COALESCE($3,monto),
         moneda=COALESCE(NULLIF($4,''),moneda),
         metadata_json=$5::jsonb,
         fecha_actualizacion=NOW()
       WHERE row_id=$1`,
      [
      tx.row_id,
      normalizedStatus,
      payment.transaction_amount != null ?
      Number(
        payment.transaction_amount
      ) :
      null,
      String(
        payment.currency_id ||
        ''
      ).toUpperCase(),
      JSON.stringify(
        metadata
      )]

    );

    /*
     * Only APPROVED may convert the Shiny order to PAGADO.
     */

    if (
    normalizedStatus ===
    'PAID')
    {

      await client.query(
        `UPDATE gmx.pedidos
         SET
           estado_pedido='PAGADO',
           venta_confirmada=true,
           payment_provider='MERCADOPAGO',
           payment_provider_session=$2,
           referencia_pago=$2,
           estado_pago='PAGADO',
           payment_confirmed_at=
             COALESCE(
               payment_confirmed_at,
               NOW()
             ),
           fecha_pago=
             COALESCE(
               fecha_pago,
               NOW()
             ),
           fecha_actualizacion=NOW()
         WHERE id_pedido=$1`,
        [
        order.id_pedido,
        providerPaymentId]

      );

      await client.query(
        `INSERT INTO gmx.auditoria(
           fecha,
           modulo,
           accion,
           referencia,
           detalle,
           usuario
         )
         VALUES(
           NOW(),
           'PAYMENTS',
           'MERCADOPAGO_PAID',
           $1,
           $2,
           'MERCADOPAGO'
         )`,
        [
        order.id_pedido,
        `payment_id=${providerPaymentId}; status=${payment.status || ''}; status_detail=${payment.status_detail || ''}`]

      );
    }

    const finalTx =
    await client.query(
      `SELECT *
         FROM gmx.payment_transactions
         WHERE row_id=$1`,
      [
      tx.row_id]

    );

    const finalOrder =
    await client.query(
      `SELECT *
         FROM gmx.pedidos
         WHERE id_pedido=$1`,
      [
      order.id_pedido]

    );

    await client.query(
      'COMMIT'
    );

    return {
      paid:
      normalizedStatus ===
      'PAID',

      reused: false,

      changed:
      currentTxStatus !==
      normalizedStatus,

      transaction:
      finalTx.rows[0],

      order:
      finalOrder.rows[0]
    };

  } catch (e) {

    try {
      await client.query(
        'ROLLBACK'
      );
    } catch {}

    throw e;

  } finally {

    client.release();
  }
}

export async function markMercadoPagoPaid(
payment)
{

  if (
  String(
    payment?.status || ''
  ).toLowerCase() !==
  'approved')
  {
    throw new Error(
      'MERCADOPAGO_PAYMENT_NOT_APPROVED'
    );
  }

  return applyMercadoPagoPaymentState(
    payment
  );
}

export async function confirmMercadoPagoPayment(
paymentId)
{

  const providerPaymentId =
  String(
    paymentId || ''
  ).trim();

  if (
  !providerPaymentId)
  {
    throw new Error(
      'MERCADOPAGO_PAYMENT_ID_REQUIRED'
    );
  }

  const clientConfig =
  mercadoPagoClient();

  if (
  !clientConfig)
  {
    throw new Error(
      'MERCADOPAGO_NOT_CONFIGURED'
    );
  }

  const paymentClient =
  new Payment(
    clientConfig
  );

  /*
   * Official API contract:
   * GET /v1/payments/{id}
   */

  const payment =
  await paymentClient.get({
    id:
    providerPaymentId
  });

  if (
  !payment?.id)
  {
    throw new Error(
      'MERCADOPAGO_PAYMENT_NOT_FOUND'
    );
  }

  /*
   * Security:
   * confirmation is applied only to a transaction
   * already registered in Shiny with this provider_payment_id.
   */

  return applyMercadoPagoPaymentState(
    payment
  );
}



/* ============================================================
   SHINY_MP_004_WEBHOOK

   Mercado Pago Webhook contract.

   Required inputs:
     x-signature
     x-request-id
     data.id
     webhook secret

   Security:
     - Signature is validated before querying the payment.
     - Only payment notifications are processed.
     - Payment status is obtained from Mercado Pago itself.
     - Final state application reuses MP-003 idempotency.
   ============================================================ */

export function mercadoPagoWebhookConfigured() {

  const credentials =
  mercadoPagoCredentials();

  return Boolean(
    credentials.webhookSecret
  );
}

export async function handleMercadoPagoWebhook({
  xSignature,
  xRequestId,
  dataId,
  type = null,
  action = null,
  confirmPayment = null,
  signatureValidator = null
} = {}) {

  const credentials =
  mercadoPagoCredentials();

  if (
  !credentials.webhookSecret)
  {
    throw new Error(
      'MERCADOPAGO_WEBHOOK_NOT_CONFIGURED'
    );
  }

  const signature =
  String(
    xSignature || ''
  ).trim();

  const requestId =
  String(
    xRequestId || ''
  ).trim();

  const paymentId =
  String(
    dataId || ''
  ).trim();

  if (!signature) {
    throw new Error(
      'MERCADOPAGO_WEBHOOK_SIGNATURE_REQUIRED'
    );
  }

  if (!requestId) {
    throw new Error(
      'MERCADOPAGO_WEBHOOK_REQUEST_ID_REQUIRED'
    );
  }

  if (!paymentId) {
    throw new Error(
      'MERCADOPAGO_WEBHOOK_DATA_ID_REQUIRED'
    );
  }

  /*
   * Mercado Pago may send different notification topics.
   * This handler owns only payment events.
   */

  const notificationType =
  String(
    type || ''
  ).
  trim().
  toLowerCase();

  const notificationAction =
  String(
    action || ''
  ).
  trim().
  toLowerCase();

  const isPaymentNotification =
  !notificationType ||

  notificationType === 'payment' ||

  notificationAction.startsWith(
    'payment.'
  );

  if (
  !isPaymentNotification)
  {

    return {
      accepted: true,
      ignored: true,
      type:
      notificationType || null,
      action:
      notificationAction || null,
      paymentId
    };
  }

  const validator =
  signatureValidator ||
  WebhookSignatureValidator;

  try {

    validator.validate({
      xSignature:
      signature,

      xRequestId:
      requestId,

      dataId:
      paymentId,

      secret:
      credentials.webhookSecret
    });

  } catch (e) {

    if (
    e instanceof
    InvalidWebhookSignatureError ||

    String(
      e?.name || ''
    ).toLowerCase().
    includes(
      'invalidwebhooksignature'
    ))
    {

      const error =
      new Error(
        'MERCADOPAGO_INVALID_WEBHOOK_SIGNATURE'
      );

      error.code =
      'MERCADOPAGO_INVALID_WEBHOOK_SIGNATURE';

      throw error;
    }

    throw e;
  }

  const confirmation =
  confirmPayment ||
  confirmMercadoPagoPayment;

  const result =
  await confirmation(
    paymentId
  );

  return {
    accepted: true,
    ignored: false,
    paymentId,
    type:
    notificationType || 'payment',
    action:
    notificationAction || null,
    result
  };
}



/* ============================================================
   SHINY_MP_006_TOTAL_REFUND

   Mercado Pago full refund contract.

   Full refund:
     POST /v1/payments/{payment_id}/refunds
     body: omitted
     X-Idempotency-Key: required

   Shiny persistence:
     payment_id
     refund_id_proveedor
     idempotency_key
     proveedor=MERCADOPAGO
     estado=COMPLETADO / PENDIENTE / ERROR
   ============================================================ */

function normalizeMercadoPagoRefundStatus(
status)
{

  const value =
  String(
    status || ''
  ).
  trim().
  toLowerCase();

  if (
  [
  'approved',
  'completed',
  'processed'].
  includes(value))
  {
    return 'COMPLETADO';
  }

  if (
  [
  'failed',
  'rejected',
  'cancelled',
  'canceled'].
  includes(value))
  {
    return 'ERROR';
  }

  return 'PENDIENTE';
}

export async function persistMercadoPagoRefundResult({
  idReembolso,
  paymentId,
  refund,
  idempotencyKey
}) {

  const refundId =
  String(
    idReembolso || ''
  ).trim();

  const providerPaymentId =
  String(
    paymentId || ''
  ).trim();

  const providerRefundId =
  String(
    refund?.id || ''
  ).trim();

  if (!refundId) {
    throw new Error(
      'REFUND_ID_REQUIRED'
    );
  }

  if (!providerPaymentId) {
    throw new Error(
      'MERCADOPAGO_PAYMENT_ID_REQUIRED'
    );
  }

  if (!providerRefundId) {
    throw new Error(
      'MERCADOPAGO_REFUND_ID_MISSING'
    );
  }

  const client =
  await pool.connect();

  try {

    await client.query(
      'BEGIN'
    );

    const current =
    await client.query(
      `SELECT *
         FROM gmx.devoluciones_reembolsos
         WHERE id_reembolso=$1
         FOR UPDATE`,
      [
      refundId]

    );

    if (
    !current.rowCount)
    {
      throw new Error(
        'REFUND_NOT_FOUND'
      );
    }

    const row =
    current.rows[0];

    if (
    row.payment_id &&
    String(row.payment_id) !==
    providerPaymentId)
    {
      throw new Error(
        'REFUND_PAYMENT_ID_MISMATCH'
      );
    }

    if (
    row.refund_id_proveedor)
    {

      if (
      String(
        row.refund_id_proveedor
      ) !==
      providerRefundId)
      {
        throw new Error(
          'REFUND_PROVIDER_ID_MISMATCH'
        );
      }

      await client.query(
        'COMMIT'
      );

      return {
        refund: row,
        reused: true,
        changed: false
      };
    }

    const normalizedStatus =
    normalizeMercadoPagoRefundStatus(
      refund.status
    );

    const updated =
    await client.query(
      `UPDATE gmx.devoluciones_reembolsos
         SET
           metodo='TARJETA',
           proveedor='MERCADOPAGO',
           estado=$2,
           payment_id=$3,
           refund_id_proveedor=$4,
           idempotency_key=
             COALESCE(
               idempotency_key,
               $5
             ),
           referencia=$4,
           integracion_habilitada=true,
           fecha_autorizacion=
             CASE
               WHEN $2='COMPLETADO'
                 THEN COALESCE(
                   fecha_autorizacion,
                   NOW()
                 )
               ELSE fecha_autorizacion
             END,
           error_codigo=
             CASE
               WHEN $2='ERROR'
                 THEN COALESCE(
                   NULLIF($6,''),
                   'MERCADOPAGO_REFUND_ERROR'
                 )
               ELSE NULL
             END,
           error_detalle=
             CASE
               WHEN $2='ERROR'
                 THEN NULLIF($7,'')
               ELSE NULL
             END,
           fecha_actualizacion=NOW()
         WHERE id_reembolso=$1
         RETURNING *`,
      [
      refundId,
      normalizedStatus,
      providerPaymentId,
      providerRefundId,
      idempotencyKey,
      String(
        refund.status ||
        ''
      ),
      String(
        refund.status_detail ||
        ''
      )]

    );

    await client.query(
      `INSERT INTO gmx.auditoria(
         fecha,
         modulo,
         accion,
         referencia,
         detalle,
         usuario
       )
       VALUES(
         NOW(),
         'PAYMENTS',
         'MERCADOPAGO_REFUND',
         $1,
         $2,
         'MERCADOPAGO'
       )`,
      [
      refundId,
      `payment_id=${providerPaymentId}; refund_id=${providerRefundId}; status=${refund.status || ''}`]

    );

    await client.query(
      'COMMIT'
    );

    return {
      refund:
      updated.rows[0],

      reused: false,

      changed: true
    };

  } catch (e) {

    try {
      await client.query(
        'ROLLBACK'
      );
    } catch {}

    throw e;

  } finally {

    client.release();
  }
}

export async function createMercadoPagoTotalRefund({
  idReembolso,
  paymentId,
  idempotencyKey = null,
  providerCall = null
}) {

  const refundId =
  String(
    idReembolso || ''
  ).trim();

  const providerPaymentId =
  String(
    paymentId || ''
  ).trim();

  if (!refundId) {
    throw new Error(
      'REFUND_ID_REQUIRED'
    );
  }

  if (!providerPaymentId) {
    throw new Error(
      'MERCADOPAGO_PAYMENT_ID_REQUIRED'
    );
  }

  const stableKey =
  String(
    idempotencyKey ||
    `MERCADOPAGO:REFUND:TOTAL:${refundId}`
  ).trim();

  /*
   * Check Shiny before hitting provider.
   */

  const existing =
  await query(
    `SELECT *
       FROM gmx.devoluciones_reembolsos
       WHERE id_reembolso=$1
       LIMIT 1`,
    [
    refundId]

  );

  if (
  !existing.rowCount)
  {
    throw new Error(
      'REFUND_NOT_FOUND'
    );
  }

  const current =
  existing.rows[0];

  if (
  current.refund_id_proveedor)
  {

    return {
      provider:
      'MERCADOPAGO',

      paymentId:
      current.payment_id,

      refundId:
      current.refund_id_proveedor,

      state:
      current.estado,

      reused: true,

      persisted:
      current
    };
  }

  if (
  current.idempotency_key &&
  String(
    current.idempotency_key
  ) !==
  stableKey)
  {
    throw new Error(
      'REFUND_IDEMPOTENCY_KEY_MISMATCH'
    );
  }

  const clientConfig =
  mercadoPagoClient();

  if (
  !providerCall &&
  !clientConfig)
  {
    throw new Error(
      'MERCADOPAGO_NOT_CONFIGURED'
    );
  }

  let refund;

  if (providerCall) {

    /*
     * Test seam. Allows MP-006 TEST1 without Internet.
     */

    refund =
    await providerCall({
      paymentId:
      providerPaymentId,

      idempotencyKey:
      stableKey,

      amount:
      undefined
    });

  } else {

    const refundClient =
    new PaymentRefund(
      clientConfig
    );

    /*
     * TOTAL refund:
     * amount intentionally omitted.
     */

    refund =
    await refundClient.create({
      paymentId:
      providerPaymentId,

      requestOptions: {
        idempotencyKey:
        stableKey
      }
    });
  }

  if (
  !refund?.id)
  {
    throw new Error(
      'MERCADOPAGO_REFUND_ID_MISSING'
    );
  }

  const persisted =
  await persistMercadoPagoRefundResult({
    idReembolso:
    refundId,

    paymentId:
    providerPaymentId,

    refund,

    idempotencyKey:
    stableKey
  });

  return {
    provider:
    'MERCADOPAGO',

    paymentId:
    providerPaymentId,

    refundId:
    String(
      refund.id
    ),

    status:
    refund.status ||
    null,

    state:
    persisted.refund.estado,

    reused:
    persisted.reused,

    persisted:
    persisted.refund
  };
}



/* ============================================================
   SHINY_MP_007_PARTIAL_REFUND

   Partial refund contract.

   accumulated committed amount =
     COMPLETADO
     + PENDIENTE
     + PROCESANDO

   available =
     original payment amount
     - committed refund amount

   Provider MUST NOT be called if requested amount
   exceeds available amount.
   ============================================================ */

export async function mercadoPagoRefundedAmount(
paymentId)
{

  const providerPaymentId =
  String(
    paymentId || ''
  ).trim();

  if (!providerPaymentId) {
    throw new Error(
      'MERCADOPAGO_PAYMENT_ID_REQUIRED'
    );
  }

  const result =
  await query(
    `SELECT
         COALESCE(
           SUM(
             CASE
               WHEN UPPER(
                 COALESCE(
                   estado,
                   ''
                 )
               ) IN(
                 'COMPLETADO',
                 'PENDIENTE',
                 'PROCESANDO'
               )
               THEN monto
               ELSE 0
             END
           ),
           0
         )::numeric(18,2)
           AS total
       FROM gmx.devoluciones_reembolsos
       WHERE UPPER(
               COALESCE(
                 proveedor,
                 ''
               )
             )='MERCADOPAGO'
         AND payment_id=$1`,
    [
    providerPaymentId]

  );

  return Number(
    result.rows[0]?.total || 0
  );
}

export async function availableMercadoPagoRefundAmount(
paymentId)
{

  const providerPaymentId =
  String(
    paymentId || ''
  ).trim();

  if (!providerPaymentId) {
    throw new Error(
      'MERCADOPAGO_PAYMENT_ID_REQUIRED'
    );
  }

  const payment =
  await query(
    `SELECT
         row_id,
         id_transaccion,
         id_pedido,
         estado,
         monto,
         moneda,
         provider_payment_id
       FROM gmx.payment_transactions
       WHERE proveedor='MERCADOPAGO'
         AND provider_payment_id=$1
       ORDER BY row_id DESC
       LIMIT 1`,
    [
    providerPaymentId]

  );

  if (!payment.rowCount) {
    throw new Error(
      'MERCADOPAGO_TRANSACTION_NOT_FOUND'
    );
  }

  const transaction =
  payment.rows[0];

  if (
  String(
    transaction.estado || ''
  ).toUpperCase() !== 'PAID')
  {
    throw new Error(
      'MERCADOPAGO_PAYMENT_NOT_PAID'
    );
  }

  const originalAmount =
  Number(
    transaction.monto || 0
  );

  const refundedAmount =
  await mercadoPagoRefundedAmount(
    providerPaymentId
  );

  const available =
  Math.max(
    0,
    Number(
      (
      originalAmount -
      refundedAmount).
      toFixed(2)
    )
  );

  return {
    paymentId:
    providerPaymentId,

    orderId:
    transaction.id_pedido,

    originalAmount,

    refundedAmount,

    availableAmount:
    available,

    currency:
    transaction.moneda ||
    'MXN'
  };
}

export async function createMercadoPagoPartialRefund({
  idReembolso,
  paymentId,
  amount,
  idempotencyKey = null,
  providerCall = null
}) {

  const refundId =
  String(
    idReembolso || ''
  ).trim();

  const providerPaymentId =
  String(
    paymentId || ''
  ).trim();

  const requestedAmount =
  Number(amount);

  if (!refundId) {
    throw new Error(
      'REFUND_ID_REQUIRED'
    );
  }

  if (!providerPaymentId) {
    throw new Error(
      'MERCADOPAGO_PAYMENT_ID_REQUIRED'
    );
  }

  if (
  !Number.isFinite(
    requestedAmount
  ) ||

  requestedAmount <= 0)
  {
    throw new Error(
      'MERCADOPAGO_INVALID_REFUND_AMOUNT'
    );
  }

  const stableKey =
  String(
    idempotencyKey ||
    `MERCADOPAGO:REFUND:PARTIAL:${refundId}`
  ).trim();

  /*
   * Serialize competing refunds using the payment row.
   */

  const client =
  await pool.connect();

  let paymentTransaction;

  try {

    await client.query(
      'BEGIN'
    );

    const payment =
    await client.query(
      `SELECT *
         FROM gmx.payment_transactions
         WHERE proveedor='MERCADOPAGO'
           AND provider_payment_id=$1
         ORDER BY row_id DESC
         LIMIT 1
         FOR UPDATE`,
      [
      providerPaymentId]

    );

    if (!payment.rowCount) {
      throw new Error(
        'MERCADOPAGO_TRANSACTION_NOT_FOUND'
      );
    }

    paymentTransaction =
    payment.rows[0];

    if (
    String(
      paymentTransaction.estado || ''
    ).toUpperCase() !== 'PAID')
    {
      throw new Error(
        'MERCADOPAGO_PAYMENT_NOT_PAID'
      );
    }

    const currentRefund =
    await client.query(
      `SELECT *
         FROM gmx.devoluciones_reembolsos
         WHERE id_reembolso=$1
         FOR UPDATE`,
      [
      refundId]

    );

    if (!currentRefund.rowCount) {
      throw new Error(
        'REFUND_NOT_FOUND'
      );
    }

    const refundRow =
    currentRefund.rows[0];

    if (
    refundRow.refund_id_proveedor)
    {

      await client.query(
        'COMMIT'
      );

      return {
        provider:
        'MERCADOPAGO',

        paymentId:
        refundRow.payment_id,

        refundId:
        refundRow.refund_id_proveedor,

        amount:
        Number(
          refundRow.monto
        ),

        state:
        refundRow.estado,

        reused: true,

        persisted:
        refundRow
      };
    }

    if (
    refundRow.idempotency_key &&
    String(
      refundRow.idempotency_key
    ) !==
    stableKey)
    {
      throw new Error(
        'REFUND_IDEMPOTENCY_KEY_MISMATCH'
      );
    }

    if (
    refundRow.payment_id &&
    String(
      refundRow.payment_id
    ) !==
    providerPaymentId)
    {
      throw new Error(
        'REFUND_PAYMENT_ID_MISMATCH'
      );
    }

    const accumulated =
    await client.query(
      `SELECT
           COALESCE(
             SUM(
               CASE
                 WHEN UPPER(
                   COALESCE(
                     estado,
                     ''
                   )
                 ) IN(
                   'COMPLETADO',
                   'PENDIENTE',
                   'PROCESANDO'
                 )
                 THEN monto
                 ELSE 0
               END
             ),
             0
           )::numeric(18,2)
             AS total
         FROM gmx.devoluciones_reembolsos
         WHERE UPPER(
                 COALESCE(
                   proveedor,
                   ''
                 )
               )='MERCADOPAGO'
           AND payment_id=$1
           AND id_reembolso<>$2`,
      [
      providerPaymentId,
      refundId]

    );

    const refundedAmount =
    Number(
      accumulated.rows[0]?.
      total || 0
    );

    const originalAmount =
    Number(
      paymentTransaction.monto ||
      0
    );

    const availableAmount =
    Number(
      (
      originalAmount -
      refundedAmount).
      toFixed(2)
    );

    if (
    requestedAmount >
    availableAmount)
    {
      const error =
      new Error(
        'MERCADOPAGO_REFUND_AMOUNT_EXCEEDS_AVAILABLE'
      );

      error.originalAmount =
      originalAmount;

      error.refundedAmount =
      refundedAmount;

      error.availableAmount =
      availableAmount;

      error.requestedAmount =
      requestedAmount;

      throw error;
    }

    /*
     * Reserve amount BEFORE provider call.
     * This prevents concurrent over-refunds.
     */

    await client.query(
      `UPDATE gmx.devoluciones_reembolsos
       SET
         metodo='TARJETA',
         proveedor='MERCADOPAGO',
         estado='PROCESANDO',
         monto=$2,
         moneda=COALESCE(
           NULLIF($3,''),
           'MXN'
         ),
         payment_id=$4,
         idempotency_key=
           COALESCE(
             idempotency_key,
             $5
           ),
         integracion_habilitada=true,
         error_codigo=NULL,
         error_detalle=NULL,
         fecha_actualizacion=NOW()
       WHERE id_reembolso=$1`,
      [
      refundId,
      requestedAmount,
      String(
        paymentTransaction.moneda ||
        'MXN'
      ).toUpperCase(),
      providerPaymentId,
      stableKey]

    );

    await client.query(
      'COMMIT'
    );

  } catch (e) {

    try {
      await client.query(
        'ROLLBACK'
      );
    } catch {}

    throw e;

  } finally {

    client.release();
  }

  const clientConfig =
  mercadoPagoClient();

  if (
  !providerCall &&
  !clientConfig)
  {
    /*
     * Return reservation to ERROR so it no longer
     * counts as committed/in-flight.
     */

    await query(
      `UPDATE gmx.devoluciones_reembolsos
       SET
         estado='ERROR',
         error_codigo=
           'MERCADOPAGO_NOT_CONFIGURED',
         error_detalle=
           'MERCADOPAGO_NOT_CONFIGURED',
         fecha_actualizacion=NOW()
       WHERE id_reembolso=$1
         AND refund_id_proveedor IS NULL`,
      [
      refundId]

    );

    throw new Error(
      'MERCADOPAGO_NOT_CONFIGURED'
    );
  }

  let providerRefund;

  try {

    if (providerCall) {

      providerRefund =
      await providerCall({
        paymentId:
        providerPaymentId,

        idempotencyKey:
        stableKey,

        amount:
        requestedAmount
      });

    } else {

      const refundClient =
      new PaymentRefund(
        clientConfig
      );

      providerRefund =
      await refundClient.create({
        paymentId:
        providerPaymentId,

        body: {
          amount:
          requestedAmount
        },

        requestOptions: {
          idempotencyKey:
          stableKey
        }
      });
    }

  } catch (e) {

    await query(
      `UPDATE gmx.devoluciones_reembolsos
       SET
         estado='ERROR',
         error_codigo=$2,
         error_detalle=$3,
         fecha_actualizacion=NOW()
       WHERE id_reembolso=$1
         AND refund_id_proveedor IS NULL`,
      [
      refundId,
      String(
        e?.code ||
        e?.name ||
        'MERCADOPAGO_REFUND_ERROR'
      ),

      String(
        e?.message || e
      )]

    );

    throw e;
  }

  if (
  !providerRefund?.id)
  {

    await query(
      `UPDATE gmx.devoluciones_reembolsos
       SET
         estado='ERROR',
         error_codigo=
           'MERCADOPAGO_REFUND_ID_MISSING',
         error_detalle=
           'MERCADOPAGO_REFUND_ID_MISSING',
         fecha_actualizacion=NOW()
       WHERE id_reembolso=$1
         AND refund_id_proveedor IS NULL`,
      [
      refundId]

    );

    throw new Error(
      'MERCADOPAGO_REFUND_ID_MISSING'
    );
  }

  const persisted =
  await persistMercadoPagoRefundResult({
    idReembolso:
    refundId,

    paymentId:
    providerPaymentId,

    refund:
    providerRefund,

    idempotencyKey:
    stableKey
  });

  const totals =
  await availableMercadoPagoRefundAmount(
    providerPaymentId
  );

  return {
    provider:
    'MERCADOPAGO',

    paymentId:
    providerPaymentId,

    refundId:
    String(
      providerRefund.id
    ),

    amount:
    requestedAmount,

    status:
    providerRefund.status ||
    null,

    state:
    persisted.refund.estado,

    reused:
    persisted.reused,

    originalAmount:
    totals.originalAmount,

    refundedAmount:
    totals.refundedAmount,

    availableAmount:
    totals.availableAmount,

    persisted:
    persisted.refund
  };
}



/* ============================================================
   SHINY_MP_008_TIMEOUT_RETRY

   Payment timeout / retry safety.

   Core rule:
     A retry NEVER creates a new payment attempt identity.

   One logical payment attempt:
     - one Shiny payment_transaction
     - one stable idempotency_key
     - zero or one provider_payment_id

   Timeout / connection reset:
     transaction remains PENDING
     metadata.attempt_state = UNKNOWN
     same idempotency_key must be reused

   This protects against:
     provider accepted request
     + client timed out
     + user/backend retries
     + accidental second charge
   ============================================================ */

function isMercadoPagoRetryableTransportError(
error)
{

  const code =
  String(
    error?.code ||
    error?.cause?.code ||
    ''
  ).
  trim().
  toUpperCase();

  const name =
  String(
    error?.name || ''
  ).
  trim().
  toUpperCase();

  const message =
  String(
    error?.message || error || ''
  ).
  trim().
  toUpperCase();

  const retryableCodes = [
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT'];


  if (
  retryableCodes.includes(code))
  {
    return true;
  }

  if (
  name.includes(
    'TIMEOUT'
  ) ||

  name === 'ABORTERROR')
  {
    return true;
  }

  return (
    message.includes(
      'TIMEOUT'
    ) ||

    message.includes(
      'TIMED OUT'
    ) ||

    message.includes(
      'CONNECTION RESET'
    ) ||

    message.includes(
      'SOCKET HANG UP'
    ));

}

export async function reserveMercadoPagoPaymentAttempt(
order,
token,
idempotencyKey)
{

  if (
  !order?.id_pedido)
  {
    throw new Error(
      'ORDER_ID_REQUIRED'
    );
  }

  const stableKey =
  String(
    idempotencyKey || ''
  ).trim();

  if (!stableKey) {
    throw new Error(
      'MERCADOPAGO_IDEMPOTENCY_KEY_REQUIRED'
    );
  }

  const client =
  await pool.connect();

  try {

    await client.query(
      'BEGIN'
    );

    /*
     * Lock the order so two simultaneous local requests
     * cannot reserve two different attempts for the same
     * logical operation.
     */

    const orderResult =
    await client.query(
      `SELECT *
         FROM gmx.pedidos
         WHERE id_pedido=$1
         FOR UPDATE`,
      [
      order.id_pedido]

    );

    if (
    !orderResult.rowCount)
    {
      throw new Error(
        'ORDER_NOT_FOUND'
      );
    }

    const currentOrder =
    orderResult.rows[0];

    if (
    String(
      currentOrder.estado_pago || ''
    ).toUpperCase() ===
    'PAGADO')
    {
      throw new Error(
        'ORDER_ALREADY_PAID'
      );
    }

    const existing =
    await client.query(
      `SELECT *
         FROM gmx.payment_transactions
         WHERE idempotency_key=$1
         ORDER BY row_id DESC
         LIMIT 1
         FOR UPDATE`,
      [
      stableKey]

    );

    if (
    existing.rowCount)
    {

      const tx =
      existing.rows[0];

      if (
      tx.proveedor !==
      'MERCADOPAGO')
      {
        throw new Error(
          'PAYMENT_IDEMPOTENCY_PROVIDER_MISMATCH'
        );
      }

      if (
      tx.id_pedido !==
      order.id_pedido)
      {
        throw new Error(
          'PAYMENT_IDEMPOTENCY_ORDER_MISMATCH'
        );
      }

      await client.query(
        'COMMIT'
      );

      return {
        transaction:
        tx,

        created:
        false
      };
    }

    const txId =
    uid('PAY');

    const metadata = {
      attempt_state:
      'READY',

      retry_count:
      0,

      first_attempt_at:
      null,

      last_attempt_at:
      null,

      last_error:
      null,

      outcome_unknown:
      false
    };

    const inserted =
    await client.query(
      `INSERT INTO gmx.payment_transactions(
          id_transaccion,
          id_pedido,
          public_token,
          proveedor,
          metodo,
          estado,
          monto,
          moneda,
          provider_session_id,
          provider_payment_id,
          metadata_json,
          idempotency_key
        )
        VALUES(
          $1,
          $2,
          $3,
          'MERCADOPAGO',
          'CARD',
          'PENDING',
          $4,
          $5,
          NULL,
          NULL,
          $6::jsonb,
          $7
        )
        RETURNING *`,
      [
      txId,
      order.id_pedido,
      token ||
      currentOrder.public_token ||
      null,

      Number(
        currentOrder.total ||
        order.total ||
        0
      ),

      'MXN',

      JSON.stringify(
        metadata
      ),

      stableKey]

    );

    await client.query(
      'COMMIT'
    );

    return {
      transaction:
      inserted.rows[0],

      created:
      true
    };

  } catch (e) {

    try {
      await client.query(
        'ROLLBACK'
      );
    } catch {}

    throw e;

  } finally {

    client.release();
  }
}

async function updateMercadoPagoAttemptMetadata(
idempotencyKey,
updater)
{

  const client =
  await pool.connect();

  try {

    await client.query(
      'BEGIN'
    );

    const current =
    await client.query(
      `SELECT *
         FROM gmx.payment_transactions
         WHERE idempotency_key=$1
         ORDER BY row_id DESC
         LIMIT 1
         FOR UPDATE`,
      [
      idempotencyKey]

    );

    if (
    !current.rowCount)
    {
      throw new Error(
        'PAYMENT_ATTEMPT_NOT_FOUND'
      );
    }

    const tx =
    current.rows[0];

    const metadata =

    tx.metadata_json &&
    typeof tx.metadata_json ===
    'object' ?

    {
      ...tx.metadata_json
    } :
    {};

    const updatedMetadata =
    updater(
      metadata,
      tx
    );

    const updated =
    await client.query(
      `UPDATE gmx.payment_transactions
         SET
           metadata_json=$2::jsonb,
           fecha_actualizacion=NOW()
         WHERE row_id=$1
         RETURNING *`,
      [
      tx.row_id,
      JSON.stringify(
        updatedMetadata
      )]

    );

    await client.query(
      'COMMIT'
    );

    return updated.rows[0];

  } catch (e) {

    try {
      await client.query(
        'ROLLBACK'
      );
    } catch {}

    throw e;

  } finally {

    client.release();
  }
}

export async function persistMercadoPagoRetryResult({
  order,
  token,
  payment,
  idempotencyKey
}) {

  if (
  !order?.id_pedido)
  {
    throw new Error(
      'ORDER_ID_REQUIRED'
    );
  }

  const providerPaymentId =
  String(
    payment?.id || ''
  ).trim();

  if (
  !providerPaymentId)
  {
    throw new Error(
      'MERCADOPAGO_PAYMENT_ID_MISSING'
    );
  }

  const stableKey =
  String(
    idempotencyKey || ''
  ).trim();

  if (!stableKey) {
    throw new Error(
      'MERCADOPAGO_IDEMPOTENCY_KEY_REQUIRED'
    );
  }

  const client =
  await pool.connect();

  let needsStateApplication =
  false;

  try {

    await client.query(
      'BEGIN'
    );

    const attempt =
    await client.query(
      `SELECT *
         FROM gmx.payment_transactions
         WHERE idempotency_key=$1
         ORDER BY row_id DESC
         LIMIT 1
         FOR UPDATE`,
      [
      stableKey]

    );

    if (
    !attempt.rowCount)
    {
      throw new Error(
        'PAYMENT_ATTEMPT_NOT_FOUND'
      );
    }

    const tx =
    attempt.rows[0];

    if (
    tx.proveedor !==
    'MERCADOPAGO')
    {
      throw new Error(
        'PAYMENT_IDEMPOTENCY_PROVIDER_MISMATCH'
      );
    }

    if (
    tx.id_pedido !==
    order.id_pedido)
    {
      throw new Error(
        'PAYMENT_IDEMPOTENCY_ORDER_MISMATCH'
      );
    }

    /*
     * A provider payment ID may never belong to
     * another Shiny transaction.
     */

    const duplicateProvider =
    await client.query(
      `SELECT *
         FROM gmx.payment_transactions
         WHERE proveedor='MERCADOPAGO'
           AND provider_payment_id=$1
           AND row_id<>$2
         LIMIT 1
         FOR UPDATE`,
      [
      providerPaymentId,
      tx.row_id]

    );

    if (
    duplicateProvider.rowCount)
    {
      throw new Error(
        'PROVIDER_PAYMENT_ID_ALREADY_USED'
      );
    }

    /*
     * Local replay after successful persistence:
     * return the same transaction without inserting.
     */

    if (
    tx.provider_payment_id)
    {

      if (
      String(
        tx.provider_payment_id
      ) !==
      providerPaymentId)
      {
        throw new Error(
          'PAYMENT_ATTEMPT_PROVIDER_ID_MISMATCH'
        );
      }

      await client.query(
        'COMMIT'
      );

      return {
        transaction:
        tx,

        reused:
        true,

        changed:
        false
      };
    }

    const normalizedStatus =
    normalizeMercadoPagoStatus(
      payment.status
    );

    const previousMetadata =

    tx.metadata_json &&
    typeof tx.metadata_json ===
    'object' ?

    tx.metadata_json :
    {};

    const metadata = {
      ...previousMetadata,

      attempt_state:
      'PROVIDER_RESPONDED',

      outcome_unknown:
      false,

      last_error:
      null,

      provider_payment_id:
      providerPaymentId,

      payment_method_id:
      payment.payment_method_id ||
      null,

      payment_type_id:
      payment.payment_type_id ||
      null,

      status:
      payment.status ||
      null,

      status_detail:
      payment.status_detail ||
      null,

      external_reference:
      payment.external_reference ||
      order.id_pedido,

      date_created:
      payment.date_created ||
      null,

      date_approved:
      payment.date_approved ||
      null,

      date_last_updated:
      payment.date_last_updated ||
      null
    };

    const updated =
    await client.query(
      `UPDATE gmx.payment_transactions
         SET
           estado=$2,
           provider_session_id=$3,
           provider_payment_id=$3,
           metadata_json=$4::jsonb,
           fecha_actualizacion=NOW()
         WHERE row_id=$1
         RETURNING *`,
      [
      tx.row_id,
      normalizedStatus,
      providerPaymentId,
      JSON.stringify(
        metadata
      )]

    );

    await client.query(
      `UPDATE gmx.pedidos
       SET
         payment_provider='MERCADOPAGO',
         payment_provider_session=$2,
         referencia_pago=$2,
         fecha_actualizacion=NOW()
       WHERE id_pedido=$1`,
      [
      order.id_pedido,
      providerPaymentId]

    );

    await client.query(
      `INSERT INTO gmx.auditoria(
        fecha,
        modulo,
        accion,
        referencia,
        detalle,
        usuario
      )
      VALUES(
        NOW(),
        'PAYMENTS',
        'MERCADOPAGO_PAYMENT',
        $1,
        $2,
        'MERCADOPAGO'
      )`,
      [
      order.id_pedido,
      `payment_id=${providerPaymentId}; status=${payment.status || ''}; retry_safe=true`]

    );

    needsStateApplication =
    normalizedStatus ===
    'PAID';

    await client.query(
      'COMMIT'
    );

    const persistedTx =
    updated.rows[0];

    /*
     * Reuse MP-003 for terminal approved state.
     */

    if (
    needsStateApplication)
    {

      await applyMercadoPagoPaymentState(
        payment
      );
    }

    return {
      transaction:
      persistedTx,

      reused:
      false,

      changed:
      true
    };

  } catch (e) {

    try {
      await client.query(
        'ROLLBACK'
      );
    } catch {}

    throw e;

  } finally {

    client.release();
  }
}

export async function retryMercadoPagoPaymentForOrder(
order,
token,
paymentInput = {},
{
  providerCall = null
} = {})
{

  if (
  !order?.id_pedido)
  {
    throw new Error(
      'ORDER_ID_REQUIRED'
    );
  }

  if (
  String(
    order.estado_pago || ''
  ).toUpperCase() ===
  'PAGADO')
  {
    throw new Error(
      'ORDER_ALREADY_PAID'
    );
  }

  const stableKey =
  String(
    paymentInput.idempotencyKey ||
    `MERCADOPAGO:CARD:${order.id_pedido}:ACTIVE`
  ).trim();

  /*
   * Reserve locally BEFORE calling Mercado Pago.
   */

  const reservation =
  await reserveMercadoPagoPaymentAttempt(
    order,
    token,
    stableKey
  );

  let tx =
  reservation.transaction;

  /*
   * If Shiny already persisted the provider payment,
   * never create another charge.
   */

  if (
  tx.provider_payment_id)
  {

    return {
      provider:
      'MERCADOPAGO',

      paymentId:
      String(
        tx.provider_payment_id
      ),

      state:
      tx.estado,

      reused:
      true,

      providerCalled:
      false,

      idempotencyKey:
      stableKey,

      transaction:
      tx
    };
  }

  const cardToken =
  String(
    paymentInput.token ||
    paymentInput.cardToken ||
    ''
  ).trim();

  if (!cardToken) {
    throw new Error(
      'MERCADOPAGO_CARD_TOKEN_REQUIRED'
    );
  }

  const paymentMethodId =
  String(
    paymentInput.paymentMethodId ||
    paymentInput.payment_method_id ||
    ''
  ).trim();

  if (!paymentMethodId) {
    throw new Error(
      'MERCADOPAGO_PAYMENT_METHOD_REQUIRED'
    );
  }

  const payerEmail =
  String(
    paymentInput.email ||
    paymentInput.payer?.email ||
    order.email ||
    ''
  ).trim();

  if (!payerEmail) {
    throw new Error(
      'MERCADOPAGO_PAYER_EMAIL_REQUIRED'
    );
  }

  /*
   * Increment retry metadata on the SAME transaction.
   */

  tx =
  await updateMercadoPagoAttemptMetadata(
    stableKey,
    (
    metadata) =>
    {

      const retryCount =
      Number(
        metadata.retry_count ||
        0
      ) + 1;

      return {
        ...metadata,

        attempt_state:
        'IN_FLIGHT',

        retry_count:
        retryCount,

        first_attempt_at:
        metadata.first_attempt_at ||
        new Date().
        toISOString(),

        last_attempt_at:
        new Date().
        toISOString(),

        last_error:
        null
      };
    }
  );

  const body = {
    transaction_amount:
    Number(
      order.total || 0
    ),

    token:
    cardToken,

    description:
    String(
      paymentInput.description || brandText(
        `Pedido Shiny ${order.id_pedido}`)
    ),

    installments:
    Number(
      paymentInput.installments ||
      1
    ),

    payment_method_id:
    paymentMethodId,

    payer: {
      email:
      payerEmail
    },

    external_reference:
    order.id_pedido,

    metadata: {
      id_pedido:
      order.id_pedido,

      public_token:
      token ||
      order.public_token ||
      null
    },

    capture:
    true,

    binary_mode:
    false
  };

  if (
  paymentInput.issuerId ||
  paymentInput.issuer_id)
  {
    body.issuer_id =
    String(
      paymentInput.issuerId ||
      paymentInput.issuer_id
    );
  }

  let payment;

  try {

    if (providerCall) {

      payment =
      await providerCall({
        body,
        idempotencyKey:
        stableKey,

        transactionId:
        tx.id_transaccion
      });

    } else {

      const clientConfig =
      mercadoPagoClient();

      if (!clientConfig) {
        throw new Error(
          'MERCADOPAGO_NOT_CONFIGURED'
        );
      }

      const paymentClient =
      new Payment(
        clientConfig
      );

      payment =
      await paymentClient.create({
        body,

        requestOptions: {
          idempotencyKey:
          stableKey
        }
      });
    }

  } catch (e) {

    if (
    isMercadoPagoRetryableTransportError(
      e
    ))
    {

      await updateMercadoPagoAttemptMetadata(
        stableKey,
        (
        metadata) => (
        {
          ...metadata,

          attempt_state:
          'UNKNOWN',

          outcome_unknown:
          true,

          last_error:
          String(
            e?.message || e
          ),

          last_error_code:
          String(
            e?.code ||
            e?.cause?.code ||
            e?.name ||
            ''
          ),

          last_timeout_at:
          new Date().
          toISOString()
        })
      );

      const unknown =
      new Error(
        'MERCADOPAGO_PAYMENT_OUTCOME_UNKNOWN'
      );

      unknown.code =
      'MERCADOPAGO_PAYMENT_OUTCOME_UNKNOWN';

      unknown.idempotencyKey =
      stableKey;

      unknown.transactionId =
      tx.id_transaccion;

      unknown.retryable =
      true;

      throw unknown;
    }

    await updateMercadoPagoAttemptMetadata(
      stableKey,
      (
      metadata) => (
      {
        ...metadata,

        attempt_state:
        'ERROR',

        outcome_unknown:
        false,

        last_error:
        String(
          e?.message || e
        ),

        last_error_code:
        String(
          e?.code ||
          e?.name ||
          ''
        )
      })
    );

    throw e;
  }

  if (
  !payment?.id)
  {

    await updateMercadoPagoAttemptMetadata(
      stableKey,
      (
      metadata) => (
      {
        ...metadata,

        attempt_state:
        'UNKNOWN',

        outcome_unknown:
        true,

        last_error:
        'MERCADOPAGO_PAYMENT_ID_MISSING'
      })
    );

    const unknown =
    new Error(
      'MERCADOPAGO_PAYMENT_OUTCOME_UNKNOWN'
    );

    unknown.code =
    'MERCADOPAGO_PAYMENT_OUTCOME_UNKNOWN';

    unknown.idempotencyKey =
    stableKey;

    unknown.transactionId =
    tx.id_transaccion;

    unknown.retryable =
    true;

    throw unknown;
  }

  const persisted =
  await persistMercadoPagoRetryResult({
    order,
    token,
    payment,
    idempotencyKey:
    stableKey
  });

  return {
    provider:
    'MERCADOPAGO',

    paymentId:
    String(
      payment.id
    ),

    status:
    payment.status ||
    null,

    state:
    persisted.transaction.estado,

    reused:
    persisted.reused,

    providerCalled:
    true,

    idempotencyKey:
    stableKey,

    transaction:
    persisted.transaction
  };
}



/* ============================================================
   SHINY_MP_009_RECONCILIATION

   Mercado Pago reconciliation.

   Comparison only:
     provider payment
       vs
     Shiny payment_transactions
       vs
     Shiny pedidos

   This function DOES NOT silently repair inconsistencies.

   Match criteria:
     payment.id
       == provider_payment_id

     payment.transaction_amount
       == payment_transactions.monto

     payment.currency_id
       == payment_transactions.moneda

     payment.external_reference
       == payment_transactions.id_pedido

     normalize(payment.status)
       == payment_transactions.estado

     local PAID
       => pedido.estado_pago = PAGADO

     local PENDING / FAILED
       => pedido.estado_pago != PAGADO
   ============================================================ */

function moneyEqual(
a,
b)
{

  const left =
  Number(a);

  const right =
  Number(b);

  if (
  !Number.isFinite(left) ||

  !Number.isFinite(right))
  {
    return false;
  }

  return (
    Math.round(
      left * 100
    ) ===

    Math.round(
      right * 100
    ));

}

export function compareMercadoPagoReconciliation({
  transaction,
  order,
  payment
}) {

  if (!transaction) {
    throw new Error(
      'PAYMENT_TRANSACTION_REQUIRED'
    );
  }

  if (!order) {
    throw new Error(
      'ORDER_REQUIRED'
    );
  }

  if (!payment) {
    throw new Error(
      'MERCADOPAGO_PAYMENT_REQUIRED'
    );
  }

  const providerPaymentId =
  String(
    payment.id || ''
  ).trim();

  const localPaymentId =
  String(
    transaction.provider_payment_id ||
    ''
  ).trim();

  const providerAmount =
  Number(
    payment.transaction_amount
  );

  const localAmount =
  Number(
    transaction.monto
  );

  const providerCurrency =
  String(
    payment.currency_id ||
    ''
  ).
  trim().
  toUpperCase();

  const localCurrency =
  String(
    transaction.moneda ||
    ''
  ).
  trim().
  toUpperCase();

  const providerReference =
  String(
    payment.external_reference ||
    ''
  ).trim();

  const localOrderId =
  String(
    transaction.id_pedido ||
    ''
  ).trim();

  const providerState =
  normalizeMercadoPagoStatus(
    payment.status
  );

  const localState =
  String(
    transaction.estado ||
    ''
  ).
  trim().
  toUpperCase();

  const orderPaymentState =
  String(
    order.estado_pago ||
    ''
  ).
  trim().
  toUpperCase();

  const expectedOrderPaid =
  localState === 'PAID';

  const orderStateMatches =
  expectedOrderPaid ?
  orderPaymentState === 'PAGADO' :
  orderPaymentState !== 'PAGADO';

  const checks = {

    paymentId: {
      expected:
      localPaymentId,

      actual:
      providerPaymentId,

      match:
      Boolean(
        localPaymentId
      ) &&

      Boolean(
        providerPaymentId
      ) &&

      localPaymentId ===
      providerPaymentId
    },

    amount: {
      expected:
      localAmount,

      actual:
      providerAmount,

      match:
      moneyEqual(
        localAmount,
        providerAmount
      )
    },

    currency: {
      expected:
      localCurrency,

      actual:
      providerCurrency,

      match:
      Boolean(
        localCurrency
      ) &&

      Boolean(
        providerCurrency
      ) &&

      localCurrency ===
      providerCurrency
    },

    externalReference: {
      expected:
      localOrderId,

      actual:
      providerReference,

      match:
      Boolean(
        localOrderId
      ) &&

      Boolean(
        providerReference
      ) &&

      localOrderId ===
      providerReference
    },

    paymentState: {
      expected:
      localState,

      actual:
      providerState,

      providerRaw:
      String(
        payment.status ||
        ''
      ),

      match:
      localState ===
      providerState
    },

    orderState: {
      expected:
      expectedOrderPaid ?
      'PAGADO' :
      'NOT_PAGADO',

      actual:
      orderPaymentState,

      match:
      orderStateMatches
    },

    orderProvider: {
      expected:
      'MERCADOPAGO',

      actual:
      String(
        order.payment_provider ||
        ''
      ).
      trim().
      toUpperCase(),

      match:
      String(
        order.payment_provider ||
        ''
      ).
      trim().
      toUpperCase() ===

      'MERCADOPAGO'
    },

    orderProviderSession: {
      expected:
      localPaymentId,

      actual:
      String(
        order.payment_provider_session ||
        ''
      ).trim(),

      match:
      String(
        order.payment_provider_session ||
        ''
      ).trim() ===

      localPaymentId
    },

    orderReference: {
      expected:
      localPaymentId,

      actual:
      String(
        order.referencia_pago ||
        ''
      ).trim(),

      match:
      String(
        order.referencia_pago ||
        ''
      ).trim() ===

      localPaymentId
    }
  };

  const mismatches =
  Object.entries(
    checks
  ).
  filter(
    (
    [,

    value]) =>


    !value.match
  ).
  map(
    (
    [
    field,
    value]) => (

    {
      field,
      expected:
      value.expected,

      actual:
      value.actual,

      providerRaw:
      value.providerRaw ||
      undefined
    })
  );

  return {
    matched:
    mismatches.length === 0,

    transactionId:
    transaction.id_transaccion,

    orderId:
    transaction.id_pedido,

    providerPaymentId,

    checks,

    mismatches
  };
}

export async function reconcileMercadoPagoPayment(
paymentId,
{
  providerPayment = null,
  providerLookup = null
} = {})
{

  const providerPaymentId =
  String(
    paymentId || ''
  ).trim();

  if (!providerPaymentId) {
    throw new Error(
      'MERCADOPAGO_PAYMENT_ID_REQUIRED'
    );
  }

  const transactionResult =
  await query(
    `SELECT *
       FROM gmx.payment_transactions
       WHERE proveedor='MERCADOPAGO'
         AND provider_payment_id=$1
       ORDER BY row_id DESC
       LIMIT 1`,
    [
    providerPaymentId]

  );

  if (
  !transactionResult.rowCount)
  {
    throw new Error(
      'MERCADOPAGO_TRANSACTION_NOT_FOUND'
    );
  }

  const transaction =
  transactionResult.rows[0];

  const orderResult =
  await query(
    `SELECT *
       FROM gmx.pedidos
       WHERE id_pedido=$1
       LIMIT 1`,
    [
    transaction.id_pedido]

  );

  if (
  !orderResult.rowCount)
  {
    throw new Error(
      'ORDER_NOT_FOUND'
    );
  }

  const order =
  orderResult.rows[0];

  let payment =
  providerPayment;

  if (!payment) {

    if (providerLookup) {

      payment =
      await providerLookup(
        providerPaymentId
      );

    } else {

      const clientConfig =
      mercadoPagoClient();

      if (!clientConfig) {
        throw new Error(
          'MERCADOPAGO_NOT_CONFIGURED'
        );
      }

      const paymentClient =
      new Payment(
        clientConfig
      );

      payment =
      await paymentClient.get({
        id:
        providerPaymentId
      });
    }
  }

  if (
  !payment?.id)
  {
    throw new Error(
      'MERCADOPAGO_PAYMENT_NOT_FOUND'
    );
  }

  const comparison =
  compareMercadoPagoReconciliation({
    transaction,
    order,
    payment
  });

  return {
    ...comparison,

    transaction,
    order,

    provider: {
      id:
      String(
        payment.id
      ),

      transaction_amount:
      Number(
        payment.transaction_amount
      ),

      currency_id:
      payment.currency_id ||
      null,

      status:
      payment.status ||
      null,

      external_reference:
      payment.external_reference ||
      null
    }
  };
}

export async function reconcileMercadoPagoPayments({
  providerLookup = null,
  limit = 100
} = {}) {

  const safeLimit =
  Math.max(
    1,
    Math.min(
      Number(limit) || 100,
      1000
    )
  );

  const transactions =
  await query(
    `SELECT
         provider_payment_id
       FROM gmx.payment_transactions
       WHERE proveedor='MERCADOPAGO'
         AND provider_payment_id IS NOT NULL
         AND BTRIM(
           provider_payment_id
         )<>''
       ORDER BY row_id DESC
       LIMIT $1`,
    [
    safeLimit]

  );

  const results = [];

  for (
  const row of
  transactions.rows)
  {

    try {

      const result =
      await reconcileMercadoPagoPayment(
        row.provider_payment_id,
        {
          providerLookup
        }
      );

      results.push({
        success: true,
        ...result
      });

    } catch (e) {

      results.push({
        success: false,

        providerPaymentId:
        row.provider_payment_id,

        error:
        String(
          e?.message || e
        )
      });
    }
  }

  const matched =
  results.filter(
    (x) =>
    x.success &&
    x.matched
  );

  const mismatched =
  results.filter(
    (x) =>
    x.success &&
    !x.matched
  );

  const failed =
  results.filter(
    (x) =>
    !x.success
  );

  return {
    total:
    results.length,

    matched:
    matched.length,

    mismatched:
    mismatched.length,

    failed:
    failed.length,

    results
  };
}

export function assertMercadoPagoReconciliation(
reconciliation)
{

  if (
  !reconciliation)
  {
    throw new Error(
      'RECONCILIATION_REQUIRED'
    );
  }

  if (
  reconciliation.matched)
  {
    return reconciliation;
  }

  const error =
  new Error(
    'MERCADOPAGO_RECONCILIATION_MISMATCH'
  );

  error.code =
  'MERCADOPAGO_RECONCILIATION_MISMATCH';

  error.transactionId =
  reconciliation.transactionId;

  error.orderId =
  reconciliation.orderId;

  error.providerPaymentId =
  reconciliation.providerPaymentId;

  error.mismatches =
  reconciliation.mismatches;

  throw error;
}

export async function createStripeSessionForOrder(order, token, baseUrl) {
  // SHINY_PAY_IDEMP_001
  const stripe = stripeClient();
  if (!stripe) throw new Error('CARD_GATEWAY_NOT_CONFIGURED');

  const client = await pool.connect();
  const idemKey = `STRIPE:CARD:${order.id_pedido}:ACTIVE`;

  try {
    await client.query('BEGIN');

    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
      [`PAY:CARD:${order.id_pedido}`]
    );

    const orderR = await client.query(
      `SELECT id_pedido,estado_pago
       FROM gmx.pedidos
       WHERE id_pedido=$1
       FOR UPDATE`,
      [order.id_pedido]
    );
    if (!orderR.rowCount) throw new Error('ORDER_NOT_FOUND');
    if (String(orderR.rows[0].estado_pago || '').toUpperCase() === 'PAGADO') {
      throw new Error('ORDER_ALREADY_PAID');
    }

    const existing = await client.query(
      `SELECT *
       FROM gmx.payment_transactions
       WHERE id_pedido=$1
         AND proveedor='STRIPE'
         AND metodo='CARD'
         AND estado='PENDING'
       ORDER BY row_id DESC
       LIMIT 1
       FOR UPDATE`,
      [order.id_pedido]
    );

    if (existing.rowCount) {
      const tx = existing.rows[0];
      if (tx.provider_session_id) {
        let current;
        try {
          current = await stripe.checkout.sessions.retrieve(tx.provider_session_id);
        } catch (_e) {
          throw new Error('PAYMENT_SESSION_REUSE_FAILED');
        }

        if (current.status === 'open') {
          const savedUrl = current.url || tx.metadata_json?.checkout_url || null;
          await client.query('COMMIT');
          return { provider: 'STRIPE', sessionId: current.id, url: savedUrl, reused: true };
        }

        if (current.payment_status === 'paid') {
          throw new Error('ORDER_ALREADY_PAID');
        }

        await client.query(
          `UPDATE gmx.payment_transactions
           SET estado='EXPIRED',
               idempotency_key=NULL,
               fecha_actualizacion=NOW()
           WHERE row_id=$1`,
          [tx.row_id]
        );
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: order.email || undefined,
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: { name: brandText(`Pedido Shiny ${order.id_pedido}`) },
          unit_amount: Math.round(Number(order.total || 0) * 100)
        },
        quantity: 1
      }],
      success_url: `${baseUrl}/tienda/pago/tarjeta/resultado?token=${encodeURIComponent(token)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/tienda/checkout?payment_cancelled=1`,
      metadata: { id_pedido: order.id_pedido, public_token: token }
    });

    await client.query(
      `INSERT INTO gmx.payment_transactions(
        id_transaccion,id_pedido,public_token,proveedor,metodo,estado,monto,moneda,
        provider_session_id,metadata_json,idempotency_key)
       VALUES($1,$2,$3,'STRIPE','CARD','PENDING',$4,'MXN',$5,$6::jsonb,$7)`,
      [
      uid('PAY'),
      order.id_pedido,
      token,
      Number(order.total || 0),
      session.id,
      JSON.stringify({ checkout_url: session.url }),
      idemKey]

    );

    await client.query(
      `UPDATE gmx.pedidos
       SET payment_provider='STRIPE',
           payment_provider_session=$2,
           estado_pago='PENDIENTE',
           fecha_actualizacion=NOW()
       WHERE id_pedido=$1`,
      [order.id_pedido, session.id]
    );

    await client.query('COMMIT');
    return { provider: 'STRIPE', sessionId: session.id, url: session.url, reused: false };
  } catch (e) {
    try {await client.query('ROLLBACK');} catch {}
    throw e;
  } finally {
    client.release();
  }
}

async function markStripePaid(session) {
  const orderId = session.metadata?.id_pedido;
  const token = session.metadata?.public_token;
  if (!orderId) return null;

  const client = await pool.connect();
  let order = null;
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT * FROM gmx.pedidos WHERE id_pedido=$1 FOR UPDATE`, [orderId]);
    if (!r.rowCount) throw new Error('ORDER_NOT_FOUND');
    order = r.rows[0];

    if (order.estado_pago !== 'PAGADO') {
      await client.query(`UPDATE gmx.pedidos SET estado_pago='PAGADO',fecha_pago=NOW(),
        payment_confirmed_at=NOW(),referencia_pago=$2,fecha_actualizacion=NOW()
        WHERE id_pedido=$1`, [orderId, session.payment_intent || session.id]);

      await client.query(`UPDATE gmx.payment_transactions SET estado='PAID',
        provider_payment_id=$2,fecha_actualizacion=NOW()
        WHERE id_pedido=$1 AND provider_session_id=$3`, [orderId, String(session.payment_intent || ''), session.id]);

      await client.query(`INSERT INTO gmx.auditoria(fecha,modulo,accion,referencia,detalle,usuario)
        VALUES(NOW(),'PAYMENTS','CARD_PAID',$1,$2,'STRIPE')`, [orderId, session.id]);
    }
    await client.query('COMMIT');
  } catch (e) {try {await client.query('ROLLBACK');} catch {}throw e;} finally {client.release();}

  const base = String(process.env.SHINY_PUBLIC_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
  if (order?.email) {
    const receiptUrl = `${base}/tienda/comprobante/${encodeURIComponent(token || order.public_token)}`;
    const mail = await queueAndSendEmail({
      to: order.email,
      subject: brandText(`Shiny · Pago confirmado ${order.id_pedido}`),
      html: paymentReceiptHtml({ order: { ...order, estado_pago: 'PAGADO' }, receiptUrl, paymentLabel: 'Pago con tarjeta confirmado' }),
      reference: order.id_pedido
    });
    await query(`UPDATE gmx.pedidos SET email_confirmacion_estado=$2 WHERE id_pedido=$1`, [
    order.id_pedido, mail.sent ? 'SENT' : mail.queued ? 'QUEUED' : 'NOT_SENT']
    );
  }
  return { ...order, estado_pago: 'PAGADO' };
}

export async function confirmStripeSession(sessionId, token) {
  const stripe = stripeClient();
  if (!stripe) throw new Error('CARD_GATEWAY_NOT_CONFIGURED');
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.metadata?.public_token !== token) throw new Error('PAYMENT_SESSION_MISMATCH');
  if (session.payment_status === 'paid') {
    const order = await markStripePaid(session);
    return { paid: true, order };
  }
  return { paid: false, status: session.payment_status };
}

export async function handleStripeWebhook(rawBody, signature) {
  const stripe = stripeClient();
  const secret = String(process.env.SHINY_STRIPE_WEBHOOK_SECRET || '').trim();
  if (!stripe || !secret) throw new Error('STRIPE_WEBHOOK_NOT_CONFIGURED');
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    if (session.payment_status === 'paid') await markStripePaid(session);
  }
  return event.type;
}

export async function ensureTransferTransaction(order, token, baseUrl) {
  const bank = await transferSettings();
  if (!bank.bank_name || !bank.account_number && !bank.clabe) throw new Error('TRANSFER_ACCOUNT_NOT_CONFIGURED');

  const existing = await query(`SELECT * FROM gmx.payment_transactions
    WHERE id_pedido=$1 AND metodo='TRANSFER' ORDER BY row_id DESC LIMIT 1`, [order.id_pedido]);
  if (!existing.rowCount) {
    await query(`INSERT INTO gmx.payment_transactions(
      id_transaccion,id_pedido,public_token,proveedor,metodo,estado,monto,moneda,referencia)
      VALUES($1,$2,$3,'MANUAL_BANK','TRANSFER','AWAITING_TRANSFER',$4,'MXN',$5)`, [
    uid('PAY'), order.id_pedido, token, Number(order.total || 0), order.numero_comprobante || order.id_pedido]
    );
  }

  if (order.email) {
    const receiptUrl = `${String(baseUrl).replace(/\/$/, '')}/tienda/pago/transferencia/${encodeURIComponent(token)}`;
    const mail = await queueAndSendEmail({
      to: order.email,
      subject: brandText(`Shiny · Instrucciones de transferencia ${order.id_pedido}`),
      html: transferInstructionsHtml({ order, receiptUrl, bank }),
      reference: order.id_pedido
    });
    await query(`UPDATE gmx.pedidos SET email_confirmacion_estado=$2 WHERE id_pedido=$1`, [
    order.id_pedido, mail.sent ? 'SENT' : mail.queued ? 'QUEUED' : 'NOT_SENT']
    );
  }
  return bank;
}

export async function saveTransferProof(token, file) {
  const orderR = await query(`SELECT * FROM gmx.pedidos WHERE public_token=$1 ORDER BY row_id LIMIT 1`, [token]);
  if (!orderR.rowCount) throw new Error('ORDER_NOT_FOUND');
  const order = orderR.rows[0];
  if (order.metodo_pago_publico !== 'TRANSFER') throw new Error('ORDER_NOT_TRANSFER');

  const mime = String(file?.mime || '');
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mime)) throw new Error('INVALID_PROOF_TYPE');
  const data = String(file?.data || '').replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(data, 'base64');
  if (!buf.length || buf.length > 10 * 1024 * 1024) throw new Error('INVALID_PROOF_SIZE');

  fs.mkdirSync(PROOF_DIR, { recursive: true });
  const ext = mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
  const filename = `${order.id_pedido}-${Date.now()}${ext}`;
  const full = path.join(PROOF_DIR, filename);
  fs.writeFileSync(full, buf);

  const tx = await query(`SELECT * FROM gmx.payment_transactions WHERE id_pedido=$1 AND metodo='TRANSFER'
    ORDER BY row_id DESC LIMIT 1`, [order.id_pedido]);
  if (tx.rowCount) {
    await query(`UPDATE gmx.payment_transactions SET estado='PROOF_RECEIVED',proof_name=$2,proof_mime=$3,
      proof_path=$4,proof_uploaded_at=NOW(),fecha_actualizacion=NOW() WHERE row_id=$1`, [
    tx.rows[0].row_id, String(file?.name || filename).slice(0, 250), mime, full]
    );
  } else {
    await query(`INSERT INTO gmx.payment_transactions(
      id_transaccion,id_pedido,public_token,proveedor,metodo,estado,monto,moneda,referencia,proof_name,proof_mime,proof_path,proof_uploaded_at)
      VALUES($1,$2,$3,'MANUAL_BANK','TRANSFER','PROOF_RECEIVED',$4,'MXN',$5,$6,$7,$8,NOW())`, [
    uid('PAY'), order.id_pedido, token, Number(order.total || 0), order.numero_comprobante || order.id_pedido,
    String(file?.name || filename).slice(0, 250), mime, full]
    );
  }
  await query(`UPDATE gmx.pedidos SET transfer_proof_status='RECEIVED',fecha_actualizacion=NOW() WHERE id_pedido=$1`, [order.id_pedido]);

  const base = String(process.env.SHINY_PUBLIC_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
  if (order.email) {
    await queueAndSendEmail({
      to: order.email,
      subject: brandText(`Shiny · Comprobante de transferencia recibido ${order.id_pedido}`),
      html: paymentReceiptHtml({
        order: { ...order, estado_pago: 'COMPROBANTE_RECIBIDO' },
        receiptUrl: `${base}/tienda/comprobante/${encodeURIComponent(token)}`,
        paymentLabel: 'Recibimos tu comprobante de transferencia'
      }),
      reference: order.id_pedido
    });
  }

  return { received: true, orderId: order.id_pedido, fileName: String(file?.name || filename) };
}

/* GMX_TRANSFER_R13 */
export async function saveTransferProofMetadata(token, transfer = {}) {
  const orderR=await query(`SELECT id_pedido,total FROM gmx.pedidos
    WHERE public_token=$1 ORDER BY row_id LIMIT 1`,[token]);
  if(!orderR.rowCount) throw new Error('ORDER_NOT_FOUND');
  const order=orderR.rows[0];

  const meta={
    bank_origin:String(transfer?.bankOrigin||'').slice(0,120),
    customer_reference:String(transfer?.reference||'').slice(0,180),
    payment_date:String(transfer?.paymentDate||'').slice(0,30),
    reported_amount:Number(transfer?.amount||order.total||0)
  };

  await query(`UPDATE gmx.payment_transactions
    SET metadata_json=COALESCE(metadata_json,'{}'::jsonb)||$2::jsonb,
        fecha_actualizacion=NOW()
    WHERE row_id=(
      SELECT row_id FROM gmx.payment_transactions
      WHERE id_pedido=$1 AND metodo='TRANSFER'
      ORDER BY row_id DESC LIMIT 1
    )`,[order.id_pedido,JSON.stringify(meta)]);

  return meta;
}

export async function listTransferProofsAdmin() {
  const r=await query(`SELECT
      t.row_id,t.id_transaccion,t.id_pedido,t.estado,t.monto,t.moneda,t.referencia,
      t.proof_name,t.proof_mime,t.proof_path,t.proof_uploaded_at,t.metadata_json,t.fecha_actualizacion,
      p.row_id AS order_row_id,
      p.numero_comprobante,p.nombre_cliente,p.email,p.telefono,p.total,p.estado_pago,p.estado_pedido,
      p.public_token,p.tipo_entrega,p.payment_confirmed_at,p.transfer_proof_status,
      p.direccion,p.ciudad,p.estado AS estado_direccion,p.cp,p.sucursal,p.id_sucursal,
      p.metodo_pago_publico,p.fecha,p.notas
    FROM gmx.payment_transactions t
    JOIN gmx.pedidos p ON p.id_pedido=t.id_pedido
    WHERE t.metodo='TRANSFER'
    ORDER BY CASE
      WHEN t.estado='PROOF_RECEIVED' THEN 0
      WHEN t.estado='PAID' THEN 1
      WHEN t.estado='REJECTED' THEN 2
      ELSE 3 END,
      t.proof_uploaded_at DESC NULLS LAST,t.row_id DESC
    LIMIT 500`);
  return r.rows;
}

export async function getTransferProofAdmin(rowId) {
  const r=await query(`SELECT proof_path,proof_name,proof_mime
    FROM gmx.payment_transactions
    WHERE row_id=$1 AND metodo='TRANSFER' LIMIT 1`,[rowId]);

  if(!r.rowCount || !r.rows[0].proof_path) throw new Error('TRANSFER_PROOF_NOT_FOUND');

  const x=r.rows[0];
  const full=path.resolve(String(x.proof_path));
  const root=path.resolve(PROOF_DIR);

  if(!(full===root || full.startsWith(root+path.sep))){
    throw new Error('TRANSFER_PROOF_INVALID_PATH');
  }
  if(!fs.existsSync(full)) throw new Error('TRANSFER_PROOF_NOT_FOUND');

  return {
    full,
    name:x.proof_name||path.basename(full),
    mime:x.proof_mime||'application/octet-stream'
  };
}

export async function reviewTransferProofAdmin(rowId,action,user,reason='') {
  const mode=String(action||'').toUpperCase();
  if(!['APPROVE','REJECT'].includes(mode)) throw new Error('INVALID_TRANSFER_REVIEW');

  const reviewer=String(user?.email||user?.nombre||user?.id_admin||'ADMIN');
  const rejectReason=String(reason||'').trim().slice(0,500);
  const client=await pool.connect();

  let order=null;
  let tx=null;
  let changed=false;

  try{
    await client.query('BEGIN');

    const tr=await client.query(`SELECT * FROM gmx.payment_transactions
      WHERE row_id=$1 AND metodo='TRANSFER' FOR UPDATE`,[rowId]);
    if(!tr.rowCount)throw new Error('TRANSFER_NOT_FOUND');
    tx=tr.rows[0];

    const pr=await client.query(`SELECT * FROM gmx.pedidos
      WHERE id_pedido=$1 FOR UPDATE`,[tx.id_pedido]);
    if(!pr.rowCount)throw new Error('ORDER_NOT_FOUND');
    order=pr.rows[0];

    const details=await client.query(`SELECT *
      FROM gmx.detalle_pedidos
      WHERE id_pedido=$1
      ORDER BY row_id
      FOR UPDATE`,[tx.id_pedido]);

    const productReservedR=await client.query(`SELECT 1
      FROM gmx.auditoria
      WHERE referencia=$1
        AND accion='RESERVAR_STOCK_PRODUCTO_WEB'
      LIMIT 1`,[tx.id_pedido]);
    const productWasReserved=productReservedR.rowCount>0;

    if(mode==='APPROVE'){
      if(tx.estado==='REJECTED')throw new Error('TRANSFER_ALREADY_REJECTED');

      if(tx.estado!=='PAID'){
        for(const d of details.rows){
          const qty=Number(d.cantidad||0);
          if(!Number.isInteger(qty)||qty<=0)continue;
          const type=String(d.tipo||'PRODUCT').toUpperCase();

          if(type==='TCG' && d.id_inventario){
            await client.query(
              `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
              [`TCG:${order.id_sucursal}:${d.id_inventario}`]
            );

            const r=await client.query(`SELECT
                g.row_id AS global_row_id,
                COALESCE(g.stock,0)::bigint AS global_stock,
                COALESCE(g.stock_reservado,0)::bigint AS global_reserved,
                s.row_id AS branch_row_id,
                COALESCE(s.stock,0)::bigint AS branch_stock,
                COALESCE(s.stock_reservado,0)::bigint AS branch_reserved
              FROM gmx.tcg_inventario g
              JOIN gmx.tcg_inventario_sucursales s
                ON s.id_inventario=g.id_inventario
               AND s.id_sucursal=$2
              WHERE g.id_inventario=$1
              ORDER BY s.row_id LIMIT 1
              FOR UPDATE OF g,s`,[d.id_inventario,order.id_sucursal]);

            if(!r.rowCount)throw new Error(`TCG_INVENTORY_NOT_FOUND:${d.id_inventario}`);
            const x=r.rows[0];
            const bs=Number(x.branch_stock||0),gs=Number(x.global_stock||0);
            const br=Number(x.branch_reserved||0),gr=Number(x.global_reserved||0);

            if(bs<qty || gs<qty)throw new Error(`INSUFFICIENT_TCG_STOCK:${d.id_inventario}`);
            if(br<qty || gr<qty)throw new Error(`INSUFFICIENT_TCG_RESERVATION:${d.id_inventario}`);

            await client.query(`UPDATE gmx.tcg_inventario_sucursales
              SET stock=$2,stock_reservado=$3,ultima_actualizacion=NOW()
              WHERE row_id=$1`,[x.branch_row_id,bs-qty,br-qty]);

            await client.query(`UPDATE gmx.tcg_inventario
              SET stock=$2,stock_reservado=$3,ultima_actualizacion=NOW()
              WHERE row_id=$1`,[x.global_row_id,gs-qty,gr-qty]);
          }

          if(type!=='TCG' && d.id_producto && !productWasReserved){
            await client.query(
              `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
              [`PRODUCT:${order.id_sucursal}:${d.id_producto}`]
            );
            const r=await client.query(`SELECT row_id,COALESCE(stock,0)::bigint stock
              FROM gmx.inventario_sucursales
              WHERE id_producto=$1 AND id_sucursal=$2
              ORDER BY row_id LIMIT 1 FOR UPDATE`,[d.id_producto,order.id_sucursal]);
            if(!r.rowCount)throw new Error(`INVENTORY_NOT_FOUND:${d.id_producto}`);
            const before=Number(r.rows[0].stock||0);
            if(before<qty)throw new Error(`INSUFFICIENT_STOCK:${d.id_producto}`);
            await client.query(`UPDATE gmx.inventario_sucursales
              SET stock=$2,fecha_actualizacion=NOW()
              WHERE row_id=$1`,[r.rows[0].row_id,before-qty]);
          }
        }

        await client.query(`UPDATE gmx.payment_transactions
          SET estado='PAID',fecha_actualizacion=NOW(),
              metadata_json=COALESCE(metadata_json,'{}'::jsonb) ||
                jsonb_build_object('reviewed_at',NOW(),'reviewed_by',$2::text,'review_action','APPROVE')
          WHERE row_id=$1`,[rowId,reviewer]);

        await client.query(`UPDATE gmx.pedidos
          SET estado_pago='PAGADO',
              estado_pedido='PAGADO',
              venta_confirmada=true,
              inventario_liberado=false,
              payment_confirmed_at=COALESCE(payment_confirmed_at,NOW()),
              fecha_pago=COALESCE(fecha_pago,NOW()),
              referencia_pago=COALESCE(NULLIF(referencia_pago,''),$2::text),
              transfer_proof_status='APPROVED',
              fecha_actualizacion=NOW()
          WHERE id_pedido=$1`,[tx.id_pedido,tx.referencia||tx.id_transaccion]);

        changed=true;
      }
    }else{
      if(tx.estado==='PAID')throw new Error('TRANSFER_ALREADY_PAID');

      if(tx.estado!=='REJECTED'){
        if(order.inventario_liberado!==true){
          for(const d of details.rows){
            const qty=Number(d.cantidad||0);
            if(!Number.isInteger(qty)||qty<=0)continue;
            const type=String(d.tipo||'PRODUCT').toUpperCase();

            if(type==='TCG' && d.id_inventario){
              const r=await client.query(`SELECT
                  g.row_id AS global_row_id,
                  COALESCE(g.stock_reservado,0)::bigint AS global_reserved,
                  s.row_id AS branch_row_id,
                  COALESCE(s.stock_reservado,0)::bigint AS branch_reserved
                FROM gmx.tcg_inventario g
                JOIN gmx.tcg_inventario_sucursales s
                  ON s.id_inventario=g.id_inventario
                 AND s.id_sucursal=$2
                WHERE g.id_inventario=$1
                ORDER BY s.row_id LIMIT 1
                FOR UPDATE OF g,s`,[d.id_inventario,order.id_sucursal]);

              if(r.rowCount){
                const x=r.rows[0];
                const br=Number(x.branch_reserved||0),gr=Number(x.global_reserved||0);
                await client.query(`UPDATE gmx.tcg_inventario_sucursales
                  SET stock_reservado=$2,ultima_actualizacion=NOW()
                  WHERE row_id=$1`,[x.branch_row_id,Math.max(0,br-qty)]);
                await client.query(`UPDATE gmx.tcg_inventario
                  SET stock_reservado=$2,ultima_actualizacion=NOW()
                  WHERE row_id=$1`,[x.global_row_id,Math.max(0,gr-qty)]);
              }
            }

            if(type!=='TCG' && d.id_producto && productWasReserved){
              const r=await client.query(`SELECT row_id,COALESCE(stock,0)::bigint stock
                FROM gmx.inventario_sucursales
                WHERE id_producto=$1 AND id_sucursal=$2
                ORDER BY row_id LIMIT 1 FOR UPDATE`,[d.id_producto,order.id_sucursal]);
              if(r.rowCount){
                const before=Number(r.rows[0].stock||0);
                await client.query(`UPDATE gmx.inventario_sucursales
                  SET stock=$2,fecha_actualizacion=NOW()
                  WHERE row_id=$1`,[r.rows[0].row_id,before+qty]);
              }
            }
          }
        }

        await client.query(`UPDATE gmx.payment_transactions
          SET estado='REJECTED',fecha_actualizacion=NOW(),
              metadata_json=COALESCE(metadata_json,'{}'::jsonb) ||
                jsonb_build_object(
                  'reviewed_at',NOW(),'reviewed_by',$2::text,
                  'review_action','REJECT','reason',$3::text
                )
          WHERE row_id=$1`,[rowId,reviewer,rejectReason]);

        await client.query(`UPDATE gmx.pedidos
          SET transfer_proof_status='REJECTED',
              estado_pago='RECHAZADO',
              estado_pedido='CANCELADO',
              venta_confirmada=false,
              inventario_liberado=true,
              fecha_actualizacion=NOW()
          WHERE id_pedido=$1`,[tx.id_pedido]);

        changed=true;
      }
    }

    await client.query(`INSERT INTO gmx.auditoria(
        fecha,modulo,accion,referencia,detalle,usuario)
      VALUES(NOW(),'PAYMENTS',$1::text,$2::text,$3::text,$4::text)`,[
      mode==='APPROVE'?'TRANSFER_APPROVED':'TRANSFER_REJECTED',
      tx.id_pedido,
      `transaction=${tx.id_transaccion}; row=${rowId}; reason=${rejectReason.slice(0,300)}`,
      reviewer
    ]);

    await client.query('COMMIT');
  }catch(e){
    try{await client.query('ROLLBACK')}catch{}
    throw e;
  }finally{
    client.release();
  }

  return {
    reviewed:true,
    action:mode,
    id_pedido:tx?.id_pedido,
    changed,
    order_status:mode==='APPROVE'?'PAGADO':'CANCELADO',
    payment_status:mode==='APPROVE'?'PAGADO':'RECHAZADO'
  };
}

export async function markTransferOrderReadyAdmin(orderId,user) {
  const r=await query(`SELECT * FROM gmx.pedidos
    WHERE id_pedido=$1 LIMIT 1`,[orderId]);

  if(!r.rowCount) throw new Error('ORDER_NOT_FOUND');

  const order=r.rows[0];
  if(order.estado_pago!=='PAGADO') throw new Error('ORDER_NOT_PAID');

  if(String(order.estado_pedido||'').toUpperCase()==='LISTO'){
    return {ready:true,id_pedido:orderId,changed:false};
  }

  await query(`UPDATE gmx.pedidos
    SET estado_pedido='LISTO',fecha_actualizacion=NOW()
    WHERE id_pedido=$1`,[orderId]);

  await query(`INSERT INTO gmx.auditoria(
      fecha,modulo,accion,referencia,detalle,usuario)
    VALUES(NOW(),'PEDIDOS','ORDER_READY',$1,'Pedido marcado como listo',$2)`,[
    orderId,
    String(user?.email||user?.nombre||user?.id_admin||'ADMIN')
  ]);

  if(order.email){
    const base=String(process.env.SHINY_PUBLIC_BASE_URL||'http://127.0.0.1:5173').replace(/\/$/,'');
    const receiptUrl=`${base}/tienda/comprobante/${encodeURIComponent(order.public_token||'')}`;

    await queueAndSendEmail({
      to:order.email,
      subject:`GMX - Tu pedido ${order.id_pedido} esta listo`,
      html:paymentReceiptHtml({
        order:{...order,estado_pago:'PAGADO'},
        receiptUrl,
        paymentLabel:String(order.tipo_entrega||'').toUpperCase()==='DELIVERY'
          ? 'Tu pedido esta listo para envio.'
          : 'Tu pedido esta listo para recoger.'
      }),
      reference:order.id_pedido
    });
  }

  return {ready:true,id_pedido:orderId,changed:true};
}