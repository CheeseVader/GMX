import express from 'express';
import { spawn } from 'node:child_process';

const router=express.Router();

function hostIsLocal(req){
  const raw=String(req.headers.host||'').trim().toLowerCase();
  const host=raw.startsWith('[')
    ? raw.slice(1,raw.indexOf(']'))
    : raw.split(':')[0];
  return host==='127.0.0.1'||host==='localhost'||host==='::1';
}

function loopback(req){
  const ip=String(req.socket?.remoteAddress||'').replace(/^::ffff:/,'');
  return ip==='127.0.0.1'||ip==='::1';
}

function localKioskOnly(req,res,next){
  if(process.platform!=='linux'){
    return res.status(404).json({ok:false,success:false,error:'WIFI_NOT_AVAILABLE'});
  }
  // Nginx -> Node llega por loopback; Host local tambien se permite.
  if(!hostIsLocal(req)&&!loopback(req)){
    return res.status(403).json({ok:false,success:false,error:'WIFI_LOCAL_ONLY'});
  }
  next();
}

function runHelper(action,payload=null,timeout=45000){
  return new Promise((resolve,reject)=>{
    const p=spawn('/usr/local/bin/gmx-wifi-helper',[action],{
      stdio:['pipe','pipe','pipe']
    });

    let stdout='';
    let stderr='';
    let finished=false;

    const timer=setTimeout(()=>{
      if(finished)return;
      p.kill('SIGKILL');
      const e=new Error(`WIFI_HELPER_TIMEOUT_${action}`);
      e.code='ETIMEDOUT';
      reject(e);
    },timeout);

    p.stdout.on('data',d=>{stdout+=String(d)});
    p.stderr.on('data',d=>{stderr+=String(d)});

    p.on('error',e=>{
      if(finished)return;
      finished=true;
      clearTimeout(timer);
      reject(e);
    });

    p.on('close',code=>{
      if(finished)return;
      finished=true;
      clearTimeout(timer);
      if(code!==0){
        const e=new Error(String(stderr||stdout||`WIFI_HELPER_EXIT_${code}`).trim());
        e.code=code;
        e.stderr=stderr;
        return reject(e);
      }
      resolve({stdout:String(stdout),stderr:String(stderr)});
    });

    if(payload!==null){
      p.stdin.end(JSON.stringify(payload));
    }else{
      p.stdin.end();
    }
  });
}

function splitEscaped(line){
  const out=[];
  let cur='';
  let esc=false;
  for(const ch of String(line)){
    if(esc){cur+=ch;esc=false;continue}
    if(ch==='\\'){esc=true;continue}
    if(ch===':'){out.push(cur);cur='';continue}
    cur+=ch;
  }
  out.push(cur);
  return out;
}

router.get('/networks',localKioskOnly,async(req,res)=>{
  try{
    const {stdout}=await runHelper('scan',null,30000);
    const raw=String(stdout||'').trim();

    const by=new Map();
    for(const line of raw.split(/\r?\n/)){
      if(!line.trim())continue;
      const parts=splitEscaped(line.trim());
      if(parts.length<4)continue;

      const inUse=String(parts[0]||'').trim();
      const security=String(parts[parts.length-1]||'').trim();
      const signal=Math.max(0,Math.min(100,Number(parts[parts.length-2])||0));
      const ssid=parts.slice(1,-2).join(':').trim();
      if(!ssid)continue;

      const item={
        ssid,
        signal,
        security,
        secure:security!==''&&security!=='--'&&!/^OPEN$/i.test(security),
        connected:inUse==='*'||/^yes$/i.test(inUse)
      };
      const prev=by.get(ssid);
      if(!prev||item.connected||item.signal>prev.signal)by.set(ssid,item);
    }

    const networks=[...by.values()].sort((a,b)=>
      Number(b.connected)-Number(a.connected)||
      b.signal-a.signal||
      a.ssid.localeCompare(b.ssid)
    );

    res.json({
      ok:true,
      success:true,
      connectedSsid:networks.find(n=>n.connected)?.ssid||'',
      networks,
      data:networks,
      diagnostic:`NETWORKS_${networks.length}`
    });
  }catch(e){
    const detail=String(e?.stderr||e?.message||e||'WIFI_SCAN_FAILED').trim();
    console.error('[GMX][WIFI][SCAN]',detail);
    res.status(500).json({
      ok:false,
      success:false,
      error:'WIFI_SCAN_FAILED',
      message:detail
    });
  }
});

let connecting=false;

router.post('/connect',localKioskOnly,express.json(),async(req,res)=>{
  if(connecting){
    return res.status(409).json({ok:false,success:false,error:'CONNECTION_IN_PROGRESS'});
  }

  const ssid=String(req.body?.ssid||'').trim();
  const password=String(req.body?.password||'');
  const secure=Boolean(req.body?.secure);

  if(!ssid||ssid.length>128){
    return res.status(400).json({ok:false,success:false,error:'INVALID_SSID'});
  }
  if(secure&&!password){
    return res.status(400).json({ok:false,success:false,error:'PASSWORD_REQUIRED'});
  }
  if(password.length>256){
    return res.status(400).json({ok:false,success:false,error:'INVALID_PASSWORD'});
  }

  connecting=true;
  try{
    await runHelper('connect',{ssid,password,secure},50000);
    res.json({ok:true,success:true,ssid});
  }catch(e){
    const detail=String(e?.stderr||e?.message||e||'WIFI_CONNECT_FAILED').trim();
    console.error('[GMX][WIFI][CONNECT]',detail);
    const error=/password|secret|authentication|802-11-wireless-security/i.test(detail)
      ? 'BAD_PASSWORD'
      : 'WIFI_CONNECT_FAILED';
    res.status(400).json({ok:false,success:false,error,message:detail});
  }finally{
    connecting=false;
  }
});

export default router;