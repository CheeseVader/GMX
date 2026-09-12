import express from 'express';

const router = express.Router();

function localOnly(req,res,next){
  if(process.platform !== 'linux'){
    return res.status(404).json({
      ok:false,
      success:false,
      error:'WIFI_NOT_AVAILABLE'
    });
  }

  const remote = String(req.socket?.remoteAddress || '').replace(/^::ffff:/,'');
  const host = String(req.headers.host || '').toLowerCase();

  const loopback = remote === '127.0.0.1' || remote === '::1';
  const localHost =
    host.startsWith('127.0.0.1') ||
    host.startsWith('localhost') ||
    host.startsWith('[::1]');

  if(!loopback && !localHost){
    return res.status(403).json({
      ok:false,
      success:false,
      error:'WIFI_LOCAL_ONLY'
    });
  }

  next();
}

router.get('/networks', localOnly, async (req,res)=>{
  return res.status(503).json({
    ok:false,
    success:false,
    error:'WIFI_TEMPORARILY_DISABLED',
    message:'Wi-Fi temporalmente deshabilitado mientras se recupera GMX.'
  });
});

router.post('/connect', localOnly, express.json(), async (req,res)=>{
  return res.status(503).json({
    ok:false,
    success:false,
    error:'WIFI_TEMPORARILY_DISABLED',
    message:'Wi-Fi temporalmente deshabilitado mientras se recupera GMX.'
  });
});

export default router;
