import express from 'express';
import { spawn } from 'node:child_process';

const router = express.Router();

function isLocalRequest(req) {
  const remote = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  const host = String(req.headers.host || '').toLowerCase();

  const loopback = remote === '127.0.0.1' || remote === '::1';
  const localHost =
    host.startsWith('127.0.0.1') ||
    host.startsWith('localhost') ||
    host.startsWith('[::1]');

  return loopback || localHost;
}

function localOnly(req, res, next) {
  if (process.platform !== 'linux') {
    return res.status(404).json({
      ok: false,
      success: false,
      error: 'WIFI_NOT_AVAILABLE'
    });
  }

  if (!isLocalRequest(req)) {
    return res.status(403).json({
      ok: false,
      success: false,
      error: 'WIFI_LOCAL_ONLY'
    });
  }

  next();
}

function runNmcli(args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/nmcli', args, {
      env: {
        ...process.env,
        LC_ALL: 'C.UTF-8',
        LANG: 'C.UTF-8'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('NMCLI_TIMEOUT'));
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        const msg = stderr.trim() || stdout.trim() || `nmcli exit ${code}`;
        reject(new Error(msg));
        return;
      }

      resolve(stdout);
    });
  });
}

function splitNmcliEscaped(line) {
  const parts = [];
  let current = '';
  let escaped = false;

  for (const ch of line) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === ':') {
      parts.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  parts.push(current);
  return parts;
}

function parseNetworks(text) {
  const bySsid = new Map();

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = splitNmcliEscaped(line);
    if (parts.length < 4) continue;

    const inUse = parts[0] === '*';
    const ssid = String(parts[1] || '').trim();
    const signal = Number.parseInt(parts[2] || '0', 10) || 0;
    const security = parts.slice(3).join(':').trim();

    if (!ssid) continue;

    const candidate = {
      ssid,
      signal,
      security,
      secure: Boolean(security && security !== '--'),
      connected: inUse
    };

    const previous = bySsid.get(ssid);
    if (!previous || candidate.connected || candidate.signal > previous.signal) {
      bySsid.set(ssid, candidate);
    }
  }

  return Array.from(bySsid.values()).sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return b.signal - a.signal;
  });
}

router.get('/networks', localOnly, async (req, res) => {
  try {
    try {
      await runNmcli(['radio', 'wifi', 'on'], 8000);
    } catch (_) {
      // A scan can still work when the radio is already enabled.
    }

    try {
      await runNmcli(['device', 'wifi', 'rescan'], 10000);
    } catch (_) {
      // Continue with the cached scan if rescan is temporarily unavailable.
    }

    const output = await runNmcli([
      '-t',
      '--escape',
      'yes',
      '-f',
      'IN-USE,SSID,SIGNAL,SECURITY',
      'device',
      'wifi',
      'list',
      '--rescan',
      'yes'
    ], 15000);

    const networks = parseNetworks(output);
    const connected = networks.find(item => item.connected);

    return res.json({
      ok: true,
      success: true,
      networks,
      data: networks,
      connectedSsid: connected?.ssid || null
    });
  } catch (error) {
    console.error('[GMX][WIFI][SCAN]', error);

    return res.status(500).json({
      ok: false,
      success: false,
      error: 'WIFI_SCAN_FAILED',
      message: String(error?.message || error)
    });
  }
});

router.post('/connect', localOnly, express.json(), async (req, res) => {
  try {
    const ssid = String(req.body?.ssid || '').trim();
    const password = String(req.body?.password || '');

    if (!ssid) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'SSID_REQUIRED'
      });
    }

    const args = ['device', 'wifi', 'connect', ssid];

    if (password) {
      args.push('password', password);
    }

    const output = await runNmcli(args, 30000);

    return res.json({
      ok: true,
      success: true,
      ssid,
      message: output.trim() || 'CONNECTED'
    });
  } catch (error) {
    console.error('[GMX][WIFI][CONNECT]', error);

    return res.status(500).json({
      ok: false,
      success: false,
      error: 'WIFI_CONNECT_FAILED',
      message: String(error?.message || error)
    });
  }
});

export default router;
