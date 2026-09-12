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

router.get('/networks', async (req,res)=>{
  try{
    if(process.platform!=='linux'){
      return res.status(400).json({success:false,error:'WIFI_ONLY_AVAILABLE_ON_RPI'});
    }

    const host=String(req.hostname||req.headers.host||'').toLowerCase().split(':')[0];
    const remote=String(req.socket?.remoteAddress||'');
    const localHost=['127.0.0.1','localhost','::1'].includes(host);
    const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote);

    if(!localHost && !loopback){
      return res.status(403).json({success:false,error:'WIFI_LOCAL_ONLY'});
    }

    const {stdout,stderr}=await execFileAsync('sudo',['/usr/local/bin/gmx-wifi-helper','scan'],{
      timeout:20000,
      maxBuffer:1024*1024
    });

    const text=String(stdout||'').trim();
    if(!text){
      throw new Error(String(stderr||'WIFI_SCAN_EMPTY').trim());
    }

    const rows=text.split(/\r?\n/)
      .map(line=>line.trim())
      .filter(Boolean)
      .map(line=>{
        const parts=line.split(':');
        if(parts.length<4) return null;
        const inUse=parts.shift();
        const security=parts.pop();
        const signal=parts.pop();
        const ssid=parts.join(':').replace(/\\:/g,':').replace(/\\\\/g,'\\').trim();
        if(!ssid) return null;
        return {
          ssid,
          signal:Number(signal)||0,
          security:String(security||'').trim(),
          connected:String(inUse||'').trim()==='*'
        };
      })
      .filter(Boolean)
      .sort((a,b)=>Number(b.connected)-Number(a.connected)||b.signal-a.signal);

    res.json({success:true,data:rows,diagnostic:rows.length?'OK':'NO_NETWORKS_RETURNED'});
  }catch(e){
    console.error('[GMX][WIFI][SCAN]',e);
    res.status(500).json({
      success:false,
      error:'WIFI_SCAN_FAILED',
      message:e?.stderr?.trim?.() || e?.message || String(e)
    });
  }
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