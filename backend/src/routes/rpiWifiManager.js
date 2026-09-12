import express from 'express';
import { spawn } from 'node:child_process';

const router = express.Router();

function localOnly(req, res, next) {
  if (process.platform !== 'linux') {
    return res.status(404).json({ ok:false, success:false, error:'WIFI_NOT_AVAILABLE' });
  }

  const remote = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  const host = String(req.headers.host || '').toLowerCase();

  const loopback = remote === '127.0.0.1' || remote === '::1';
  const localHost =
    host.startsWith('127.0.0.1') ||
    host.startsWith('localhost') ||
    host.startsWith('[::1]');

  if (!loopback && !localHost) {
    return res.status(403).json({ ok:false, success:false, error:'WIFI_LOCAL_ONLY' });
  }

  next();
}

function runNmcli(args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/nmcli', args, {
      env: { ...process.env, LC_ALL:'C.UTF-8', LANG:'C.UTF-8' },
      stdio: ['ignore','pipe','pipe']
    });

    let stdout = '';
    let stderr = '';
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill('SIGKILL');
      reject(new Error('NMCLI_TIMEOUT'));
    }, timeoutMs);

    child.stdout.on('data', x => { stdout += x.toString('utf8'); });
    child.stderr.on('data', x => { stderr += x.toString('utf8'); });

    child.on('error', err => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', code => {
      if (done) return;
      done = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `nmcli exit ${code}`));
        return;
      }

      resolve(stdout);
    });
  });
}

function splitEscaped(line) {
  const out = [];
  let current = '';
  let escaped = false;

  for (const ch of line) {
    if (escaped) {
      current += ch;
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === ':') {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  out.push(current);
  return out;
}

function parseNetworks(text) {
  const bySsid = new Map();

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const p = splitEscaped(line);
    if (p.length < 4) continue;

    const item = {
      connected: p[0] === '*',
      ssid: String(p[1] || '').trim(),
      signal: Number.parseInt(p[2] || '0', 10) || 0,
      security: p.slice(3).join(':').trim()
    };

    if (!item.ssid) continue;
    item.secure = Boolean(item.security && item.security !== '--');

    const old = bySsid.get(item.ssid);
    if (!old || item.connected || item.signal > old.signal) {
      bySsid.set(item.ssid, item);
    }
  }

  return Array.from(bySsid.values()).sort((a,b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return b.signal - a.signal;
  });
}

router.get('/networks', localOnly, async (req, res) => {
  try {
    try { await runNmcli(['radio','wifi','on'], 8000); } catch {}
    try { await runNmcli(['device','wifi','rescan'], 10000); } catch {}

    const output = await runNmcli([
      '-t','--escape','yes',
      '-f','IN-USE,SSID,SIGNAL,SECURITY',
      'device','wifi','list','--rescan','yes'
    ], 15000);

    const networks = parseNetworks(output);
    const connected = networks.find(x => x.connected);

    return res.json({
      ok:true,
      success:true,
      networks,
      data:networks,
      connectedSsid:connected?.ssid || null
    });
  } catch (error) {
    console.error('[GMX][WIFI][SCAN]', error);
    return res.status(500).json({
      ok:false,
      success:false,
      error:'WIFI_SCAN_FAILED',
      message:String(error?.message || error)
    });
  }
});

router.post('/connect', localOnly, express.json(), async (req, res) => {
  try {
    const ssid = String(req.body?.ssid || '').trim();
    const password = String(req.body?.password || '');

    if (!ssid) {
      return res.status(400).json({ ok:false, success:false, error:'SSID_REQUIRED' });
    }

    const args = ['device','wifi','connect',ssid];
    if (password) args.push('password',password);

    const output = await runNmcli(args, 30000);

    return res.json({
      ok:true,
      success:true,
      ssid,
      message:output.trim() || 'CONNECTED'
    });
  } catch (error) {
    console.error('[GMX][WIFI][CONNECT]', error);
    return res.status(500).json({
      ok:false,
      success:false,
      error:'WIFI_CONNECT_FAILED',
      message:String(error?.message || error)
    });
  }
});

export default router;
