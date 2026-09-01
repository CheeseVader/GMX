import { randomInt } from 'node:crypto';
import { query, pool } from './db.js';
import { newToken, hashToken } from './security.js';
import { resolveUserAccess } from './middleware/auth.js';

const ACTION = 'DEVOLUCION_POS';
const TTL_MINUTES = 5;

function txt(value) {
  return String(value ?? '').trim();
}

function authorizationError(code, statusCode = 400) {
  const error = new Error(code);
  error.statusCode = statusCode;
  return error;
}

async function getOrder(orderId) {
  const idPedido = txt(orderId);
  if (!idPedido) throw authorizationError('ORDER_ID_REQUIRED', 400);

  const result = await query(`
    SELECT id_pedido,id_sucursal,sucursal,estado_pedido
    FROM gmx.pedidos
    WHERE id_pedido=$1
    ORDER BY row_id
    LIMIT 1
  `, [idPedido]);

  if (!result.rowCount) throw authorizationError('ORDER_NOT_FOUND', 404);
  return result.rows[0];
}

async function getAdminByIdOrEmail({ id = '', email = '' } = {}) {
  const idAdmin = txt(id);
  const userEmail = txt(email).toLowerCase();

  const result = await query(`
    SELECT
      row_id,id_admin,nombre,email,rol,activo,
      sucursal_principal,sucursales_permitidas
    FROM gmx.administradores
    WHERE COALESCE(activo,true)=true
      AND (
        ($1<>'' AND id_admin=$1)
        OR
        ($2<>'' AND LOWER(email)=$2)
      )
    ORDER BY CASE WHEN id_admin=$1 THEN 0 ELSE 1 END,row_id
    LIMIT 1
  `, [idAdmin, userEmail]);

  return result.rows[0] || null;
}

function isSuperAdmin(user) {
  return String(user?.rol || user?.role || '').trim().toUpperCase() === 'SUPERADMIN';
}

async function getAuthorizationContext(user) {
  if (!user) return { canAuthorize: false, access: null, admin: null };

  const admin = await getAdminByIdOrEmail({
    id: user?.id_admin || user?.id || '',
    email: user?.email || ''
  });

  const subject = admin || user;
  const access = await resolveUserAccess(subject);
  const canAuthorize =
    isSuperAdmin(subject) ||
    access?.permissions?.COMERCIAL?.authorize === true;

  return { canAuthorize, access, admin: subject };
}

function assertBranchAllowed(access, branchId) {
  const idSucursal = txt(branchId);
  if (!idSucursal) return;

  if (access?.branchScope && !access.branchScope.all) {
    const allowed = (access.branchScope.allowed || []).map(String);
    if (!allowed.includes(idSucursal)) {
      const error = authorizationError('RETURN_AUTHORIZATION_BRANCH_FORBIDDEN', 403);
      error.branchId = idSucursal;
      error.allowedBranches = allowed;
      throw error;
    }
  }
}

async function insertAuthorization({
  token,
  orderId = null,
  branchId = null,
  requester = null,
  authorizer,
  ip = '',
  userAgent = ''
}) {
  const idAuthorization =
    `AUTH-DEV-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const result = await query(`
    INSERT INTO gmx.autorizaciones_operacion(
      id_autorizacion,
      token_hash,
      accion,
      id_pedido,
      id_sucursal,
      id_solicitante,
      email_solicitante,
      id_autorizador,
      email_autorizador,
      expires_at,
      ip_address,
      user_agent
    )
    VALUES(
      $1,$2,$3,$4,$5,
      $6,$7,$8,$9,
      NOW()+($10||' minutes')::interval,
      $11,$12
    )
    RETURNING id_autorizacion,created_at,expires_at
  `, [
    idAuthorization,
    hashToken(token),
    ACTION,
    txt(orderId) || null,
    txt(branchId) || null,
    txt(requester?.id_admin || requester?.id) || null,
    txt(requester?.email).toLowerCase() || null,
    txt(authorizer?.id_admin || authorizer?.id),
    txt(authorizer?.email).toLowerCase(),
    String(TTL_MINUTES),
    txt(ip) || null,
    txt(userAgent).slice(0, 500) || null
  ]);

  return result.rows[0];
}

export async function getReturnAuthorizationCapability(requester) {
  const { canAuthorize, access, admin } = await getAuthorizationContext(requester);
  return {
    canAuthorize,
    role: String(admin?.rol || requester?.rol || ''),
    allBranches: Boolean(access?.branchScope?.all),
    allowedBranches: access?.branchScope?.all ? [] : (access?.branchScope?.allowed || [])
  };
}

export async function issueCurrentUserReturnAuthorization({
  orderId = '',
  requester = null,
  ip = '',
  userAgent = ''
} = {}) {
  const order = await getOrder(orderId);
  const { canAuthorize, access, admin } = await getAuthorizationContext(requester);

  if (!canAuthorize) {
    throw authorizationError('RETURN_AUTHORIZATION_REQUIRED', 403);
  }

  assertBranchAllowed(access, order.id_sucursal);

  const token = newToken();
  const record = await insertAuthorization({
    token,
    orderId: order.id_pedido,
    branchId: order.id_sucursal,
    requester,
    authorizer: admin,
    ip,
    userAgent
  });

  return {
    authorizationToken: token,
    authorizationId: record.id_autorizacion,
    action: ACTION,
    orderId: order.id_pedido,
    branchId: order.id_sucursal || null,
    expiresAt: record.expires_at,
    expiresInMinutes: TTL_MINUTES,
    automatic: true,
    authorizedBy: {
      id_admin: admin?.id_admin || admin?.id || '',
      nombre: admin?.nombre || '',
      email: admin?.email || requester?.email || '',
      rol: admin?.rol || requester?.rol || ''
    }
  };
}

async function createUniquePin() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pin = String(randomInt(0, 10000)).padStart(4, '0');
    const exists = await query(`
      SELECT 1
      FROM gmx.autorizaciones_operacion
      WHERE token_hash=$1
      LIMIT 1
    `, [hashToken(pin)]);

    if (!exists.rowCount) return pin;
  }

  throw authorizationError('RETURN_PIN_GENERATION_FAILED', 500);
}

export async function generateReturnPin({
  requester = null,
  ip = '',
  userAgent = ''
} = {}) {
  const { canAuthorize, admin } = await getAuthorizationContext(requester);

  if (!canAuthorize) {
    throw authorizationError('RETURN_AUTHORIZATION_FORBIDDEN', 403);
  }

  const authorizerId = txt(admin?.id_admin || admin?.id);
  if (!authorizerId) {
    throw authorizationError('RETURN_AUTHORIZER_NOT_FOUND', 403);
  }

  // Un autorizador conserva un solo PIN genérico activo.
  await query(`
    UPDATE gmx.autorizaciones_operacion
    SET used_at=COALESCE(used_at,NOW()),
        referencia_uso=COALESCE(referencia_uso,'REEMPLAZADO')
    WHERE accion=$1
      AND id_autorizador=$2
      AND id_pedido IS NULL
      AND used_at IS NULL
  `, [ACTION, authorizerId]);

  const pin = await createUniquePin();
  const record = await insertAuthorization({
    token: pin,
    requester: null,
    authorizer: admin,
    ip,
    userAgent
  });

  return {
    pin,
    authorizationId: record.id_autorizacion,
    expiresAt: record.expires_at,
    expiresInMinutes: TTL_MINUTES,
    singleUse: true,
    purpose: ACTION,
    authorizedBy: {
      id_admin: admin?.id_admin || admin?.id || '',
      nombre: admin?.nombre || '',
      email: admin?.email || '',
      rol: admin?.rol || ''
    }
  };
}

export async function redeemReturnPin({
  orderId = '',
  pin = '',
  requester = null
} = {}) {
  const idPedido = txt(orderId);
  const code = txt(pin);

  if (!idPedido) throw authorizationError('ORDER_ID_REQUIRED', 400);
  if (!/^\d{4}$/.test(code)) throw authorizationError('RETURN_PIN_INVALID_FORMAT', 400);

  const order = await getOrder(idPedido);
  const requesterId = txt(requester?.id_admin || requester?.id);
  const requesterEmail = txt(requester?.email).toLowerCase();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(`
      SELECT *
      FROM gmx.autorizaciones_operacion
      WHERE token_hash=$1
        AND accion=$2
        AND id_pedido IS NULL
        AND used_at IS NULL
        AND expires_at>NOW()
      ORDER BY row_id DESC
      LIMIT 1
      FOR UPDATE
    `, [hashToken(code), ACTION]);

    if (!result.rowCount) {
      throw authorizationError('RETURN_PIN_INVALID_OR_EXPIRED', 403);
    }

    const authorization = result.rows[0];
    const authorizer = await getAdminByIdOrEmail({
      id: authorization.id_autorizador,
      email: authorization.email_autorizador
    });

    if (!authorizer) {
      throw authorizationError('RETURN_AUTHORIZER_NOT_FOUND', 403);
    }

    const access = await resolveUserAccess(authorizer);
    const canAuthorize =
      isSuperAdmin(authorizer) ||
      access?.permissions?.COMERCIAL?.authorize === true;

    if (!canAuthorize) {
      throw authorizationError('RETURN_AUTHORIZATION_FORBIDDEN', 403);
    }

    assertBranchAllowed(access, order.id_sucursal);

    const bound = await client.query(`
      UPDATE gmx.autorizaciones_operacion
      SET id_pedido=$2,
          id_sucursal=$3,
          id_solicitante=$4,
          email_solicitante=$5
      WHERE row_id=$1
        AND id_pedido IS NULL
        AND used_at IS NULL
        AND expires_at>NOW()
      RETURNING *
    `, [
      authorization.row_id,
      order.id_pedido,
      txt(order.id_sucursal) || null,
      requesterId || null,
      requesterEmail || null
    ]);

    if (!bound.rowCount) {
      throw authorizationError('RETURN_PIN_ALREADY_USED', 403);
    }

    await client.query('COMMIT');

    return {
      authorizationToken: code,
      authorizationId: authorization.id_autorizacion,
      action: ACTION,
      orderId: order.id_pedido,
      branchId: order.id_sucursal || null,
      expiresAt: authorization.expires_at,
      singleUse: true,
      authorizedBy: {
        id_admin: authorizer.id_admin,
        nombre: authorizer.nombre,
        email: authorizer.email,
        rol: authorizer.rol
      }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// SHINY_POS_DISCOUNT_PIN_R31
// Consume the same generic 4-digit POS authorization PIN for a manual discount.
// The caller provides its existing DB transaction, so PIN consumption and sale
// creation commit or roll back together.
export async function consumeManualDiscountPinTx(client,{
  pin='',
  branchId='',
  requester=null,
  reference=''
}={}){
  const code=txt(pin);
  const idSucursal=txt(branchId);

  if(!/^\d{4}$/.test(code)){
    throw authorizationError('MANUAL_DISCOUNT_PIN_INVALID_FORMAT',400);
  }
  if(!idSucursal){
    throw authorizationError('BRANCH_REQUIRED',400);
  }

  const result=await client.query(`
    SELECT *
    FROM gmx.autorizaciones_operacion
    WHERE token_hash=$1
      AND accion=$2
      AND used_at IS NULL
      AND expires_at>NOW()
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE
  `,[hashToken(code),ACTION]);

  if(!result.rowCount){
    throw authorizationError('MANUAL_DISCOUNT_PIN_INVALID_OR_EXPIRED',403);
  }

  const authorization=result.rows[0];

  const {canAuthorize,access}=await getAuthorizationContext({
    id_admin:authorization.id_autorizador,
    id:authorization.id_autorizador,
    email:authorization.email_autorizador
  });

  if(!canAuthorize){
    throw authorizationError('MANUAL_DISCOUNT_AUTHORIZATION_FORBIDDEN',403);
  }

  assertBranchAllowed(access,idSucursal);

  const requesterId=txt(requester?.id_admin||requester?.id);
  const requesterEmail=txt(requester?.email).toLowerCase();

  const consumed=await client.query(`
    UPDATE gmx.autorizaciones_operacion
    SET used_at=NOW(),
        id_sucursal=$2,
        id_solicitante=$3,
        email_solicitante=$4,
        referencia_uso=$5
    WHERE row_id=$1
      AND used_at IS NULL
    RETURNING *
  `,[
    authorization.row_id,
    idSucursal,
    requesterId||null,
    requesterEmail||null,
    txt(reference)||null
  ]);

  if(!consumed.rowCount){
    throw authorizationError('MANUAL_DISCOUNT_PIN_ALREADY_USED',403);
  }

  return {
    authorizationId:authorization.id_autorizacion,
    action:authorization.accion,
    branchId:idSucursal,
    authorizerId:authorization.id_autorizador||null
  };
}
