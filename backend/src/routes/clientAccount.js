import { Router } from 'express';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireClientAuth,setClientSessionCookie,clearClientSessionCookie } from '../middleware/clientAuth.js';
import {
  registerClient,verifyClientEmail,loginClient,logoutClient,clientProfile,clientOrders,clientLoyalty,listAddresses,saveAddress,requestPasswordReset,completePasswordReset,clientPreferences,saveClientPreferences
} from '../repositories/clientAccountRepository.js';

const router=Router();
const bad=(res,e,status=400)=>{
  const known=['CLIENT_ACCOUNT_EXISTS','CLIENT_EMAIL_ALREADY_REGISTERED','CLIENT_PHONE_ALREADY_REGISTERED','CLIENT_IDENTITY_EXISTS','CUSTOMER_IDENTITY_CONFLICT','PASSWORD_MIN_8','PASSWORD_LETTER_AND_NUMBER_REQUIRED','NAME_EMAIL_REQUIRED','INVALID_CLIENT_CREDENTIALS','EMAIL_NOT_VERIFIED','INVALID_OR_EXPIRED_VERIFICATION','INVALID_OR_EXPIRED_RESET_TOKEN'];
  const code=known.includes(e.message)?e.message:'CLIENT_REQUEST_FAILED';
  res.status(status).json({success:false,error:code});
};

router.post('/auth/register',rateLimit({keyPrefix:'CLIENT_REGISTER',max:10}),async(req,res)=>{
  try{
    const baseUrl=`${req.protocol}://${req.get('host')}`.replace(':8787',':5173');
    const r=await registerClient({...req.body,ip:req.ip,userAgent:req.headers['user-agent'],baseUrl});
    res.status(201).json({success:true,data:r});
  }catch(e){const duplicate=['CLIENT_ACCOUNT_EXISTS','CLIENT_EMAIL_ALREADY_REGISTERED','CLIENT_PHONE_ALREADY_REGISTERED','CLIENT_IDENTITY_EXISTS'].includes(e.message);bad(res,e,duplicate?409:400);}
});

router.post('/auth/verify',rateLimit({keyPrefix:'CLIENT_VERIFY',max:20}),async(req,res)=>{
  try{
    const r=await verifyClientEmail({token:req.body?.token,ip:req.ip,userAgent:req.headers['user-agent']});
    setClientSessionCookie(res,r.token,r.hours*3600);
    res.json({success:true,data:{user:r.user}});
  }catch(e){bad(res,e,400);}
});


router.post('/auth/recover',rateLimit({keyPrefix:'CLIENT_RECOVER',max:8}),async(req,res)=>{
  try{
    const baseUrl=`${req.protocol}://${req.get('host')}`.replace(':8787',':5173');
    const r=await requestPasswordReset({
      email:req.body?.email,
      ip:req.ip,
      baseUrl
    });
    // Nunca indicar al público si el correo existe.
    res.json({success:true,data:r});
  }catch(_e){
    // Incluso ante ciertos fallos internos, evitamos enumeración de cuentas.
    res.json({success:true,data:{accepted:true}});
  }
});

router.post('/auth/reset-password',rateLimit({keyPrefix:'CLIENT_RESET',max:12}),async(req,res)=>{
  try{
    const r=await completePasswordReset({
      token:req.body?.token,
      password:req.body?.password,
      ip:req.ip,
      userAgent:req.headers['user-agent']
    });
    setClientSessionCookie(res,r.token,r.hours*3600);
    res.json({success:true,data:{user:r.user}});
  }catch(e){bad(res,e,400);}
});

router.post('/auth/login',rateLimit({keyPrefix:'CLIENT_LOGIN',max:12}),async(req,res)=>{
  try{
    const r=await loginClient({...req.body,ip:req.ip,userAgent:req.headers['user-agent']});
    setClientSessionCookie(res,r.token,r.hours*3600);
    res.json({success:true,data:{user:r.user}});
  }catch(e){bad(res,e,401);}
});

router.post('/auth/logout',requireClientAuth,async(req,res)=>{
  try{await logoutClient(req.clientUser.session_id);clearClientSessionCookie(res);res.json({success:true});}
  catch(e){bad(res,e,500);}
});

router.get('/me',requireClientAuth,async(req,res)=>{
  const profile=await clientProfile(req.clientUser.id_cliente);
  res.json({success:true,data:{user:{...req.clientUser,...profile}}});
});
router.get('/orders',requireClientAuth,async(req,res)=>{try{const r=await clientOrders(req.clientUser.id_cliente);res.json({success:true,data:r.rows});}catch(e){bad(res,e,500);}});
router.get('/loyalty',requireClientAuth,async(req,res)=>{try{res.json({success:true,data:await clientLoyalty(req.clientUser.id_cliente)});}catch(e){bad(res,e,500);}});
router.get('/addresses',requireClientAuth,async(req,res)=>{try{const r=await listAddresses(req.clientUser.id_cliente);res.json({success:true,data:r.rows});}catch(e){bad(res,e,500);}});
router.post('/addresses',requireClientAuth,async(req,res)=>{try{res.status(201).json({success:true,data:await saveAddress(req.clientUser.id_cliente,req.body||{})});}catch(e){bad(res,e);}});

router.get('/preferences',requireClientAuth,async(req,res)=>{
  try{
    const data=await clientPreferences(req.clientUser.id_cliente);
    res.json({success:true,data});
  }catch(e){
    console.error('[CLIENT_PREFERENCES_GET]',e);
    res.status(500).json({
      success:false,
      error:'CLIENT_PREFERENCES_FAILED',
      message:'No fue posible cargar tus preferencias.'
    });
  }
});

router.put('/preferences',requireClientAuth,async(req,res)=>{
  try{
    const data=await saveClientPreferences(
      req.clientUser.id_cliente,
      req.body || {}
    );

    res.json({success:true,data});
  }catch(e){
    console.error('[CLIENT_PREFERENCES_PUT]',e);
    res.status(500).json({
      success:false,
      error:'CLIENT_PREFERENCES_FAILED',
      message:'No fue posible guardar tus preferencias.'
    });
  }
});
export default router;



