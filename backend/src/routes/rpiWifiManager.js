import express from 'express';
import { spawn } from 'node:child_process';

const router = express.Router();

function hostIsLocal(req){
  const raw=String(req.headers.host||'').trim().toLowerCase();
  return /^127\.0\.0\.1(?::\d+)?$/.test(raw) ||
         /^localhost(?::\d+)?$/.test(raw) ||
         /^\[::1\](?::\d+)?$/.test(raw);
}
function loopback(req){
  const ip=String(req.socket?.remoteAddress||'').replace(/^::ffff:/,'');
  return ip==='127.0.0.1' || ip==='::1';
}
function localKioskOnly(req,res,next){
  if(process.platform!=='linux') return res.status(404).json({ok:false,error:'not_available'});
  if(!hostIsLocal(req)||!loopback(req)) return res.status(403).json({ok:false,error:'local_kiosk_only'});
  next();
}
function helper(action,payload=null,timeout=40000){
  return new Promise((resolve,reject)=>{
    const p=spawn('/usr/bin/sudo',['/usr/local/bin/gmx-wifi-helper',action],{stdio:['pipe','pipe','pipe']});
    let out='',err='';
    const timer=setTimeout(()=>{try{p.kill('SIGKILL')}catch{};reject(new Error('timeout'));},timeout);
    p.stdout.on('data',d=>out+=String(d));
    p.stderr.on('data',d=>err+=String(d));
    p.on('error',e=>{clearTimeout(timer);reject(e)});
    p.on('close',code=>{
      clearTimeout(timer);
      if(code===0) resolve(out);
      else reject(new Error((err||out||`exit_${code}`).trim()));
    });
    if(payload) p.stdin.write(JSON.stringify(payload));
    p.stdin.end();
  });
}
function splitEscaped(line){
  const out=[];let cur='',esc=false;
  for(const ch of line){
    if(esc){cur+=ch;esc=false}
    else if(ch==='\\'){esc=true}
    else if(ch===':'){out.push(cur);cur=''}
    else cur+=ch;
  }
  out.push(cur);return out;
}

router.get('/networks',localKioskOnly,async(_req,res)=>{
  try{
    const raw=await helper('scan');
    const activeRaw=await helper('active');
    let connectedSsid='';
    for(const line of activeRaw.split(/\r?\n/)){
      if(!line)continue;
      const p=splitEscaped(line);
      if(p[0]==='yes'){connectedSsid=p.slice(1,-1).join(':');break}
    }
    const by=new Map();
    for(const line of raw.split(/\r?\n/)){
      if(!line)continue;
      const [inUse,ssid,signalRaw,securityRaw]=splitEscaped(line);
      if(!ssid)continue;
      const item={ssid,signal:Math.max(0,Math.min(100,Number(signalRaw)||0)),secure:String(securityRaw||'')!==''&&String(securityRaw||'')!=='--',security:String(securityRaw||''),connected:inUse==='*'};
      const prev=by.get(ssid);
      if(!prev||item.connected||item.signal>prev.signal)by.set(ssid,item);
    }
    const networks=[...by.values()].sort((a,b)=>Number(b.connected)-Number(a.connected)||b.signal-a.signal||a.ssid.localeCompare(b.ssid));
    res.json({ok:true,connectedSsid,networks});
  }catch(e){res.status(500).json({ok:false,error:'wifi_scan_failed'})}
});

let connecting=false;
router.post('/connect',localKioskOnly,express.json(),async(req,res)=>{
  if(connecting)return res.status(409).json({ok:false,error:'connection_in_progress'});
  const ssid=String(req.body?.ssid||'').trim();
  const password=String(req.body?.password||'');
  const secure=Boolean(req.body?.secure);
  if(!ssid||ssid.length>128)return res.status(400).json({ok:false,error:'invalid_ssid'});
  if(secure&&!password)return res.status(400).json({ok:false,error:'password_required'});
  if(password.length>256)return res.status(400).json({ok:false,error:'invalid_password'});
  connecting=true;
  try{
    await helper('connect',{ssid,password,secure},45000);
    res.json({ok:true,ssid});
  }catch(e){
    const msg=String(e.message||'');
    const error=/password|secret|authentication|802-11-wireless-security/i.test(msg)?'bad_password':'connection_failed';
    res.status(400).json({ok:false,error});
  }finally{connecting=false}
});

export default router;