#!/usr/bin/env node
/*
 * Copyright 2026 FlipFlow. All rights reserved.
 *
 * Cleo CLI: local collector + thin client for the gated /v1 API. Cheap analysis
 * (jwt, headers) runs fully local and free; scan/har call Cleo and are gated by
 * your plan. Auth: a Cleo API key (cleo_...) from Settings > API Access.
 *
 * Requires Node 18+ (global fetch). No external dependencies. Usually invoked
 * via the /cleo Claude command, not by hand.
 *   cleo login                  # browser sign in (device flow), saves a 90-day token
 *   cleo logout
 *   cleo entitlements
 *   cleo jwt <token>            # local, free
 *   cleo headers <url>          # local, free (works on localhost)
 *   cleo har <file.har>         # gated; uploads local HAR for analysis
 *   cleo scan <target>          # gated (Pro+); URL/domain incl. localhost
 *   cleo code <path>            # gated (Pro+); scans local source code
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, basename, relative, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CFG_DIR  = join(homedir(), '.cleo');
const CFG_FILE = join(CFG_DIR, 'config.json');
const DEFAULT_API = process.env.CLEO_API ?? 'https://api.flipflow.app';

function loadCfg() {
  try { return JSON.parse(readFileSync(CFG_FILE, 'utf8')); } catch { return {}; }
}
function saveCfg(cfg) {
  if (!existsSync(CFG_DIR)) mkdirSync(CFG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
// Stable per-machine id so the user can see + disconnect this device in Cleo.
function deviceId() {
  const cfg = loadCfg();
  if (cfg.deviceId) return cfg.deviceId;
  const id = randomUUID();
  saveCfg({ ...cfg, deviceId: id });
  return id;
}
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* user opens it manually */ }
}
function die(msg) { console.error(msg); process.exit(1); }
function out(obj) { console.log(JSON.stringify(obj, null, 2)); }
function tokenOrDie() {
  const cfg = loadCfg();
  const t = cfg.token ?? cfg.key;
  if (!t) die('Not signed in. Run:  /cleo login');
  return t;
}

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function apiBase() { return (loadCfg().api ?? DEFAULT_API).replace(/\/$/, ''); }

// Raw call (no auth) used by the login flow.
async function rawApi(path, { method = 'GET', body, token, timeoutMs = 60000 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `ApiKey ${token}`;
  let res;
  try {
    res = await fetch(apiBase() + path, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e.name === 'TimeoutError') die(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${apiBase()}${path}.`);
    die(`Network error reaching ${apiBase()}${path}: ${e.message}`);
  }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { res, json };
}

async function api(path, { method = 'GET', body, timeoutMs } = {}) {
  const { res, json } = await rawApi(path, { method, body, token: tokenOrDie(), timeoutMs });
  if (!res.ok) {
    if (res.status === 401) die('Session expired or revoked. Run:  /cleo login');
    const msg = json?.error ?? res.statusText;
    const up  = json?.upgradeUrl ? `  Upgrade: ${json.upgradeUrl}` : '';
    die(`[${res.status}] ${msg}${up}`);
  }
  return json;
}

// ── Commands ──────────────────────────────────────────────────────────────────

// Browser-based sign in (no key to copy). Opens Cleo, the user approves this
// device with their MFA, and a 90-day token is saved locally.
async function cmdLogin(args) {
  const apiIdx = args.indexOf('--api');
  if (apiIdx >= 0) saveCfg({ ...loadCfg(), api: args[apiIdx + 1] });

  const start = await rawApi('/v1/auth/device', {
    method: 'POST',
    body: { deviceId: deviceId(), platform: 'claude', hostname: hostname() },
  });
  if (!start.res.ok) die(`Could not start sign in: ${start.json?.error ?? start.res.status}`);
  const { deviceCode, userCode, verifyUrl, interval = 5, expiresIn = 600 } = start.json;

  console.error('\n  Sign in to Cleo to connect this computer:\n');
  console.error(`    Opening:       ${verifyUrl}`);
  console.error(`    Confirm code:  ${userCode}`);
  console.error('    Then approve with your MFA. Waiting...\n');
  openBrowser(verifyUrl);

  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const { res, json } = await rawApi('/v1/auth/device/token', { method: 'POST', body: { deviceCode } });
    if (res.status === 202) continue;                       // still pending
    if (res.ok && json.token) {
      saveCfg({ ...loadCfg(), token: json.token });
      console.error('  Connected. You can now use /cleo code, /cleo scan, /cleo har.\n');
      return;
    }
    if (res.status === 403) die('  Sign in was denied in the browser.');
    if (res.status === 410) die('  Sign in timed out. Run /cleo login again.');
  }
  die('  Sign in timed out. Run /cleo login again.');
}

function cmdLogout() {
  const cfg = loadCfg();
  // Keep only the stable deviceId; drop token/key and any custom api host so a
  // fresh login goes back to the default Cleo server.
  saveCfg({ deviceId: cfg.deviceId });
  console.error('Signed out on this computer. Revoke fully in Cleo > Settings > Connected devices.');
}

// Manual API-key sign in (fallback for non-interactive / CI use).
function cmdAuth(args) {
  const key = args[0];
  if (!key || !key.startsWith('cleo_')) die('Usage: auth cleo_yourkey [--api https://api.host]');
  const apiIdx = args.indexOf('--api');
  const api = apiIdx >= 0 ? args[apiIdx + 1] : (loadCfg().api ?? DEFAULT_API);
  saveCfg({ ...loadCfg(), key, api });
  console.error(`Saved. API: ${api}`);
}

async function cmdEntitlements() { out(await api('/v1/entitlements')); }

// Local, free: decode a JWT and flag obvious issues. No network.
function cmdJwt(args) {
  const tok = args[0];
  if (!tok || tok.split('.').length < 2) die('Usage: jwt <token>');
  const [h, p] = tok.split('.');
  let header, payload;
  try { header = JSON.parse(b64urlDecode(h)); payload = JSON.parse(b64urlDecode(p)); }
  catch { die('Not a valid JWT (could not decode header/payload).'); }
  const issues = [];
  if ((header.alg ?? '').toLowerCase() === 'none') issues.push('alg=none: token is unsigned (critical).');
  if (header.alg && /^hs/i.test(header.alg)) issues.push('HMAC alg: verify the secret is strong and not a public key (alg-confusion risk).');
  if (payload.exp) {
    const exp = new Date(payload.exp * 1000);
    if (exp < new Date()) issues.push(`Expired at ${exp.toISOString()}.`);
  } else issues.push('No exp claim: token does not expire.');
  if (!payload.iat) issues.push('No iat claim.');
  out({ header, payload, issues });
}

// Local, free: fetch a URL (incl. localhost) and lint security response headers.
async function cmdHeaders(args) {
  const url = args[0];
  if (!url) die('Usage: headers <url>   (e.g. http://localhost:3000)');
  let res;
  try { res = await fetch(url, { redirect: 'manual' }); }
  catch (e) { die(`Could not reach ${url}: ${e.message}`); }
  const h = Object.fromEntries(res.headers.entries());
  const wants = {
    'strict-transport-security': 'HSTS missing (no forced HTTPS).',
    'content-security-policy':   'CSP missing (XSS/injection mitigation).',
    'x-content-type-options':    'X-Content-Type-Options missing (MIME sniffing).',
    'x-frame-options':           'X-Frame-Options missing (clickjacking) - or use CSP frame-ancestors.',
    'referrer-policy':           'Referrer-Policy missing.',
  };
  const missing = Object.entries(wants).filter(([k]) => !(k in h)).map(([, v]) => v);
  out({ url, status: res.status, headers: h, missing });
}

// Server-side (all tiers): upload a local HAR capture for flow analysis.
async function cmdHar(args) {
  const file = args[0];
  if (!file) die('Usage: har <file.har>');
  let content;
  try { content = readFileSync(file, 'utf8'); } catch (e) { die(`Cannot read ${file}: ${e.message}`); }
  out(await api('/v1/har', { method: 'POST', body: { content }, timeoutMs: 540000 }));
}

function isPrivateHost(host) {
  return /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    || host === '::1' || host === '[::1]' || host.endsWith('.local');
}

// Server-side (gated, Pro+): AI security scan of a URL/domain. Localhost / private
// targets are probed locally (the server cannot reach them) and the capture is
// uploaded; public targets are probed server-side.
async function cmdScan(args) {
  const target = args[0];
  if (!target) die('Usage: scan <target>   (e.g. http://localhost:3000 or example.com)');

  let captured;
  let host = '';
  try { host = new URL(/^https?:\/\//.test(target) ? target : `https://${target}`).hostname; } catch { /* ignore */ }
  if (host && isPrivateHost(host)) {
    const url = /^https?:\/\//.test(target) ? target : `http://${target}`;
    try {
      const r = await fetch(url, { redirect: 'manual' });
      captured = { status: r.status, headers: Object.fromEntries(r.headers.entries()), tlsInfo: url.startsWith('https') ? 'client-probed (TLS not inspected)' : 'N/A (http)' };
    } catch (e) {
      captured = { status: 0, headers: {}, tlsInfo: 'unreachable', error: `Local probe failed: ${e.message}` };
    }
  }
  out(await api('/v1/scan', { method: 'POST', body: { target, ...(captured ? { captured } : {}) }, timeoutMs: 540000 }));
}

// Local source collection for code scan. Skips heavy/vendor dirs + binaries +
// secret files; caps per-file and total size.
const SKIP_DIRS  = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', 'vendor',
  '__pycache__', '.venv', 'venv', 'target', '.cache',
  // Test / generated / capture output: no production attack surface, just burns
  // the scan budget on snapshots and fixtures instead of real source.
  'test', 'tests', '__tests__', '__snapshots__', 'e2e', 'fixtures', 'mocks', '__mocks__',
  'test-results', 'playwright-report', 'cypress', '.test', 'output', 'snapshots',
  'tmp', 'temp', 'logs',
  // Generated / non-source artifact trees.
  'graphify-out', '.obsidian', 'my-vault', '.playwright-mcp',
]);
const CODE_EXT   = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.rb', '.php', '.go', '.java', '.rs', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.sql', '.sh', '.yml', '.yaml', '.vue', '.svelte', '.kt', '.swift']);
// Junk / generated / lock files: skip - no security value, just burns tokens.
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'Gemfile.lock', 'poetry.lock', 'Cargo.lock']);
// Test, spec, snapshot and declaration files carry no production attack surface.
const isJunk = (name) =>
  SKIP_FILES.has(name) ||
  /\.(min\.js|min\.css|map|lock|snap)$/i.test(name) ||
  /\.(test|spec)\.[cm]?[jt]sx?$/i.test(name) ||
  /\.d\.ts$/i.test(name) ||
  name.startsWith('.env');
const PER_FILE_CAP = 1 * 1024 * 1024;     // 1 MB per file
const TOTAL_CAP    = 4 * 1024 * 1024;     // CLI-side guard; server enforces the per-tier limit

function collectFiles(root) {
  const files = [];
  let total = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name) || isJunk(name)) continue;
      const full = join(dir, name);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (!CODE_EXT.has(extname(name).toLowerCase())) continue;
      if (total >= TOTAL_CAP) return;
      let content; try { content = readFileSync(full, 'utf8'); } catch { continue; }
      content = content.slice(0, PER_FILE_CAP);
      total += content.length;
      files.push({ path: relative(root, full) || name, content });
    }
  };
  walk(root);
  return files;
}

// Server-side (gated, Pro+): AI security review of local source code.
async function cmdCode(args) {
  const all  = args.includes('--all');           // scan the whole repo, not the default scope cap
  const path = args.find(a => !a.startsWith('--'));
  if (!path) die('Usage: code <file-or-directory> [--all]');
  let st; try { st = statSync(path); } catch (e) { die(`Cannot read ${path}: ${e.message}`); }

  let filename, code;
  if (st.isDirectory()) {
    const files = collectFiles(path);
    if (!files.length) die('No source files found (checked common code extensions).');
    filename = basename(path.replace(/\/$/, '')) || 'project';
    code = files.map(f => `// ==== FILE: ${f.path} ====\n${f.content}`).join('\n\n');
  } else {
    filename = basename(path);
    code = readFileSync(path, 'utf8').slice(0, TOTAL_CAP);
  }

  // The server returns the report inline for small inputs, or a 202 job for a
  // large repo (audited in the background to dodge request-timeout limits). For
  // the async case, poll the job until it finishes.
  const first = await api('/v1/code', { method: 'POST', body: { filename, code, all }, timeoutMs: 120000 });
  if (first?.status === 'running' && first.jobId) {
    console.error(`\n  Deep scan: auditing ${first.totalChunks} code chunk(s) in the background.`);
    if (first.dropped) console.error(`  ${first.dropped} chunk(s) skipped${all ? ' (daily budget)' : ' - pass --all to scan the whole repo'}.`);
    console.error('  This can take a few minutes for a large repo. Waiting...\n');
    out(await pollCodeJob(first.jobId));
    return;
  }
  out(first);
}

// Poll an async deep code-scan job until it completes (or errors / times out).
async function pollCodeJob(jobId) {
  const deadline = Date.now() + 30 * 60 * 1000; // 30 min hard cap
  let lastDone = -1;
  while (Date.now() < deadline) {
    await sleep(4000);
    const j = await api(`/v1/code/job/${jobId}`, { timeoutMs: 30000 });
    if (j.status === 'done')  return j;
    if (j.status === 'error') die(`[scan failed] ${j.error ?? 'unknown error'}`);
    if (typeof j.done === 'number' && j.done !== lastDone) {
      lastDone = j.done;
      console.error(`  progress: ${j.done}/${j.total} chunks audited`);
    }
  }
  die(`Scan did not finish within 30 minutes. Job id: ${jobId} (poll /v1/code/job/${jobId} later).`);
}

const [cmd, ...rest] = process.argv.slice(2);
const table = {
  login: cmdLogin, logout: cmdLogout, auth: cmdAuth, entitlements: cmdEntitlements,
  jwt: cmdJwt, headers: cmdHeaders, har: cmdHar, scan: cmdScan, code: cmdCode,
};
const fn = table[cmd];
if (!fn) {
  console.error('Cleo. Commands: login, logout, entitlements, code, scan, har, jwt, headers');
  process.exit(1);
}
await fn(rest);
