import { query, pool } from './db.js';
import { newToken, hashToken, verifyPassword } from './security.js';
import { resolveUserAccess } from './middleware/auth.js';

const ACTION = 'DEVOLUCION_POS';
const TTL_MINUTES = 5;

function txt(v){
  return String(v ?? '').trim();
}

function authorizationError(code,statusCode=400){
  const e=new Error(code);
  e.statusCode=statusCode;
  return e;
}

export async function authorizePosReturn({
  orderId='',
  email='',
  password='',
  requester=null,
  ip='',
  userAgent=''
}={}){
  const idPedido=txt(orderId);
  const authEmail=txt(email).toLowerCase();
  const authPassword=String(password||'');

  if(!idPedido)throw authorizationError('ORDER_ID_REQUIRED',400);
  if(!authPassword)throw authorizationError('AUTHORIZER_PASSWORD_REQUIRED',400);

  const orderResult=await query(`
    SELECT id_pedido,id_sucursal,sucursal,estado_pedido
    FROM gmx.pedidos
    WHERE id_pedido=$1
    ORDER BY row_id
    LIMIT 1
  `,[idPedido]);

  if(!orderResult.rowCount)throw authorizationError('ORDER_NOT_FOUND',404);

  const order=orderResult.rows[0];

  const adminResult=await query(`
    SELECT
      row_id,
      id_admin,
      nombre,
      email,
      rol,
      activo,
      password_hash,
      sucursal_principal,
      sucursales_permitidas
    FROM gmx.administradores
    WHERE COALESCE(activo,true)=true
      AND ($1='' OR LOWER(email)=$1)
    ORDER BY row_id
  `,[authEmail]);

  const matches=[];
  for(const candidate of adminResult.rows){
    if(verifyPassword(authPassword,candidate.password_hash))matches.push(candidate);
  }

  if(!matches.length){
    throw authorizationError('INVALID_AUTHORIZER_CREDENTIALS',403);
  }

  const branchId=txt(order.id_sucursal);
  const authorized=[];
  let branchForbidden=null;

  for(const candidate of matches){
    const access=await resolveUserAccess(candidate);

    if(access.permissions?.COMERCIAL?.authorize!==true)continue;

    if(access.branchScope && !access.branchScope.all){
      const allowed=(access.branchScope.allowed||[]).map(String);

      if(!branchId || !allowed.includes(branchId)){
        branchForbidden={branchId:branchId||null,allowedBranches:allowed};
        continue;
      }
    }

    authorized.push({candidate,access});
  }

  if(authorized.length>1){
    throw authorizationError('RETURN_AUTHORIZATION_AMBIGUOUS',403);
  }

  if(!authorized.length){
    if(branchForbidden){
      const e=authorizationError('RETURN_AUTHORIZATION_BRANCH_FORBIDDEN',403);
      e.branchId=branchForbidden.branchId;
      e.allowedBranches=branchForbidden.allowedBranches;
      throw e;
    }
    throw authorizationError('RETURN_AUTHORIZATION_FORBIDDEN',403);
  }

  const authorizer=authorized[0].candidate;

  const token=newToken();
  const idAuthorization=`AUTH-DEV-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;

  await query(`
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
  `,[
    idAuthorization,
    hashToken(token),
    ACTION,
    idPedido,
    branchId||null,
    txt(requester?.id_admin)||null,
    txt(requester?.email).toLowerCase()||null,
    authorizer.id_admin,
    String(authorizer.email||'').toLowerCase(),
    String(TTL_MINUTES),
    txt(ip)||null,
    txt(userAgent).slice(0,500)||null
  ]);

  return {
    authorizationToken:token,
    authorizationId:idAuthorization,
    action:ACTION,
    orderId:idPedido,
    branchId:branchId||null,
    expiresInMinutes:TTL_MINUTES,
    authorizedBy:{
      id_admin:authorizer.id_admin,
      nombre:authorizer.nombre,
      email:authorizer.email,
      rol:authorizer.rol
    }
  };
}

export async function validatePosReturnAuthorization({
  token='',
  orderId='',
  requester=null
}={}){
  const authorizationToken=txt(token);
  const idPedido=txt(orderId);

  if(!authorizationToken){
    throw authorizationError('RETURN_AUTHORIZATION_REQUIRED',403);
  }

  if(!idPedido){
    throw authorizationError('ORDER_ID_REQUIRED',400);
  }

  const r=await query(`
    SELECT
      row_id,
      id_autorizacion,
      accion,
      id_pedido,
      id_sucursal,
      id_solicitante,
      email_solicitante,
      id_autorizador,
      email_autorizador,
      created_at,
      expires_at,
      used_at
    FROM gmx.autorizaciones_operacion
    WHERE token_hash=$1
      AND accion=$2
      AND id_pedido=$3
      AND used_at IS NULL
      AND expires_at>NOW()
    ORDER BY row_id DESC
    LIMIT 1
  `,[hashToken(authorizationToken),ACTION,idPedido]);

  if(!r.rowCount){
    throw authorizationError(
      'RETURN_AUTHORIZATION_INVALID_OR_EXPIRED',
      403
    );
  }

  const auth=r.rows[0];

  const requesterId=txt(requester?.id_admin);
  const requesterEmail=txt(requester?.email).toLowerCase();

  if(
    auth.id_solicitante &&
    requesterId &&
    String(auth.id_solicitante)!==requesterId
  ){
    throw authorizationError(
      'RETURN_AUTHORIZATION_REQUESTER_MISMATCH',
      403
    );
  }

  if(
    auth.email_solicitante &&
    requesterEmail &&
    String(auth.email_solicitante).toLowerCase()!==requesterEmail
  ){
    throw authorizationError(
      'RETURN_AUTHORIZATION_REQUESTER_MISMATCH',
      403
    );
  }

  return {
    authorizationId:auth.id_autorizacion,
    action:auth.accion,
    orderId:auth.id_pedido,
    branchId:auth.id_sucursal,
    authorizerId:auth.id_autorizador,
    authorizerEmail:auth.email_autorizador,
    expiresAt:auth.expires_at
  };
}


export async function claimPosReturnAuthorization({
  token='',
  orderId='',
  requester=null
}={}){
  const authorizationToken=txt(token);
  const idPedido=txt(orderId);

  if(!authorizationToken){
    throw authorizationError('RETURN_AUTHORIZATION_REQUIRED',403);
  }

  if(!idPedido){
    throw authorizationError('ORDER_ID_REQUIRED',400);
  }

  const requesterId=txt(requester?.id_admin);
  const requesterEmail=txt(requester?.email).toLowerCase();
  const claimId=`CLAIM-${Date.now()}-${Math.random().toString(36).slice(2,10).toUpperCase()}`;

  const client=await pool.connect();

  try{
    await client.query('BEGIN');

    const r=await client.query(`
      SELECT *
      FROM gmx.autorizaciones_operacion
      WHERE token_hash=$1
        AND accion=$2
        AND id_pedido=$3
        AND used_at IS NULL
        AND expires_at>NOW()
      ORDER BY row_id DESC
      LIMIT 1
      FOR UPDATE
    `,[hashToken(authorizationToken),ACTION,idPedido]);

    if(!r.rowCount){
      throw authorizationError(
        'RETURN_AUTHORIZATION_INVALID_OR_EXPIRED',
        403
      );
    }

    const auth=r.rows[0];

    if(
      auth.id_solicitante &&
      requesterId &&
      String(auth.id_solicitante)!==requesterId
    ){
      throw authorizationError(
        'RETURN_AUTHORIZATION_REQUESTER_MISMATCH',
        403
      );
    }

    if(
      auth.email_solicitante &&
      requesterEmail &&
      String(auth.email_solicitante).toLowerCase()!==requesterEmail
    ){
      throw authorizationError(
        'RETURN_AUTHORIZATION_REQUESTER_MISMATCH',
        403
      );
    }

    const claimed=await client.query(`
      UPDATE gmx.autorizaciones_operacion
      SET used_at=NOW(),
          referencia_uso=$2
      WHERE row_id=$1
        AND used_at IS NULL
      RETURNING *
    `,[auth.row_id,claimId]);

    if(!claimed.rowCount){
      throw authorizationError(
        'RETURN_AUTHORIZATION_ALREADY_USED',
        403
      );
    }

    await client.query('COMMIT');

    return {
      authorizationId:auth.id_autorizacion,
      claimId,
      rowId:auth.row_id,
      orderId:auth.id_pedido,
      branchId:auth.id_sucursal,
      authorizerId:auth.id_autorizador,
      authorizerEmail:auth.email_autorizador
    };

  }catch(e){
    await client.query('ROLLBACK');
    throw e;
  }finally{
    client.release();
  }
}

export async function releasePosReturnAuthorization({
  authorizationId='',
  claimId=''
}={}){
  const id=txt(authorizationId);
  const claim=txt(claimId);

  if(!id||!claim)return false;

  const r=await query(`
    UPDATE gmx.autorizaciones_operacion
    SET used_at=NULL,
        referencia_uso=NULL
    WHERE id_autorizacion=$1
      AND referencia_uso=$2
    RETURNING row_id
  `,[id,claim]);

  return r.rowCount===1;
}

export async function finalizePosReturnAuthorization({
  authorizationId='',
  claimId='',
  returnId=''
}={}){
  const id=txt(authorizationId);
  const claim=txt(claimId);
  const ref=txt(returnId);

  if(!id||!claim||!ref){
    throw authorizationError(
      'RETURN_AUTHORIZATION_FINALIZE_DATA_REQUIRED',
      500
    );
  }

  const r=await query(`
    UPDATE gmx.autorizaciones_operacion
    SET referencia_uso=$3
    WHERE id_autorizacion=$1
      AND referencia_uso=$2
      AND used_at IS NOT NULL
    RETURNING *
  `,[id,claim,ref]);

  if(!r.rowCount){
    throw authorizationError(
      'RETURN_AUTHORIZATION_FINALIZE_FAILED',
      500
    );
  }

  return r.rows[0];
}

export async function consumePosReturnAuthorization({
  token='',
  orderId='',
  requester=null,
  reference=''
}={}){
  const authorizationToken=txt(token);
  const idPedido=txt(orderId);

  if(!authorizationToken){
    throw authorizationError('RETURN_AUTHORIZATION_REQUIRED',403);
  }

  if(!idPedido){
    throw authorizationError('ORDER_ID_REQUIRED',400);
  }

  const client=await pool.connect();

  try{
    await client.query('BEGIN');

    const r=await client.query(`
      SELECT *
      FROM gmx.autorizaciones_operacion
      WHERE token_hash=$1
        AND accion=$2
        AND id_pedido=$3
        AND used_at IS NULL
        AND expires_at>NOW()
      ORDER BY row_id DESC
      LIMIT 1
      FOR UPDATE
    `,[hashToken(authorizationToken),ACTION,idPedido]);

    if(!r.rowCount){
      throw authorizationError('RETURN_AUTHORIZATION_INVALID_OR_EXPIRED',403);
    }

    const auth=r.rows[0];

    const requesterId=txt(requester?.id_admin);
    const requesterEmail=txt(requester?.email).toLowerCase();

    if(auth.id_solicitante &&
       requesterId &&
       String(auth.id_solicitante)!==requesterId){
      throw authorizationError('RETURN_AUTHORIZATION_REQUESTER_MISMATCH',403);
    }

    if(auth.email_solicitante &&
       requesterEmail &&
       String(auth.email_solicitante).toLowerCase()!==requesterEmail){
      throw authorizationError('RETURN_AUTHORIZATION_REQUESTER_MISMATCH',403);
    }

    await client.query(`
      UPDATE gmx.autorizaciones_operacion
      SET used_at=NOW(),
          referencia_uso=$2
      WHERE row_id=$1
    `,[auth.row_id,txt(reference)||null]);

    await client.query('COMMIT');

    return auth;

  }catch(e){
    await client.query('ROLLBACK');
    throw e;
  }finally{
    client.release();
  }
}
