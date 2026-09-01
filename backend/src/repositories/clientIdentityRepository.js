import { query } from '../db.js';

export async function normalizeClientIdentity({email='',phone=''}){
  const r=await query(`SELECT gmx.normalize_email($1) email_normalizado,
                              gmx.normalize_phone($2) telefono_normalizado`,[email,phone]);
  return r.rows[0]||{email_normalizado:null,telefono_normalizado:null};
}

export async function identityOwners({email='',phone=''}){
  const normalized=await normalizeClientIdentity({email,phone});
  let emailOwner=null,phoneOwner=null;

  if(normalized.email_normalizado){
    const r=await query(`SELECT id_cliente FROM gmx.cliente_identidad_unica
      WHERE tipo='EMAIL' AND valor_normalizado=$1 LIMIT 1`,[normalized.email_normalizado]);
    emailOwner=r.rows[0]?.id_cliente||null;
  }
  if(normalized.telefono_normalizado){
    const r=await query(`SELECT id_cliente FROM gmx.cliente_identidad_unica
      WHERE tipo='PHONE' AND valor_normalizado=$1 LIMIT 1`,[normalized.telefono_normalizado]);
    phoneOwner=r.rows[0]?.id_cliente||null;
  }
  return {...normalized,emailOwner,phoneOwner};
}

export function resolveExistingClient(owners){
  const {emailOwner,phoneOwner}=owners;
  if(emailOwner&&phoneOwner&&emailOwner!==phoneOwner){
    const e=new Error('CUSTOMER_IDENTITY_CONFLICT');
    e.code='CUSTOMER_IDENTITY_CONFLICT';
    throw e;
  }
  return emailOwner||phoneOwner||null;
}
