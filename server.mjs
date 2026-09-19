// Standalone Node wrapper. All logic lives in lib/, so the Vercel port is
// a set of thin route handlers around the same functions. The WebSocket
// endpoint below exists only for the spike's telemetry test and does not
// move to Vercel — the card loop is short-polled HTTP and needs no socket.

import { createServer } from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { openStore } from './lib/store.mjs';
import { handleMcp, handlePending, handleAnswer, sessionFromAuth, json } from './lib/api.mjs';

const PORT = process.env.PORT || 8080;
const PUBLIC = join(import.meta.dirname, 'public');
const LOG = join(import.meta.dirname, 'spike.log');
const store = openStore();

const TYPES = { '.html': 'text/html', '.png': 'image/png',
                '.css': 'text/css', '.js': 'text/javascript' };

async function log(line) {
  const stamped = `${new Date().toISOString()}  ${line}`;
  console.log(stamped);
  await appendFile(LOG, stamped + '\n').catch(() => {});
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

function send(res, out) {
  res.writeHead(out.status, out.headers);
  res.end(out.body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    if (p === '/api/mcp' && req.method === 'POST') {
      return send(res, await handleMcp(store, {
        body: await readBody(req),
        auth: req.headers.authorization,
        accept: req.headers.accept
      }, log));
    }

    if (p === '/api/pending') {
      return send(res, await handlePending(store, url.searchParams.get('s')));
    }

    // Setup helper: tells you which display id a credential maps to, so you
    // can open the page at /?s=<that id> until QR pairing is built.
    //   curl -H "Authorization: Bearer my-test-key" http://localhost:8080/whoami
    if (p === '/api/whoami') {
      const session = sessionFromAuth(req.headers.authorization);
      return send(res, json(200, { session, paired: Boolean(session) }));
    }

    if (p === '/api/answer' && req.method === 'POST') {
      const { ticket, choice, index } = JSON.parse(await readBody(req) || '{}');
      return send(res, await handleAnswer(store, { ticket, choice, index }, log));
    }

    if (p === '/api/beacon') {
      const q = url.searchParams;
      await log(`BEACON  session=${q.get('s')} n=${q.get('n')} `
              + `at=${q.get('at')}s vis=${q.get('vis')}`);
      res.writeHead(204).end();
      return;
    }

    if (p === '/api/flush' && req.method === 'POST') {
      const { session, events } = JSON.parse(await readBody(req) || '{}');
      await log(`FLUSH   session=${session} buffered=${(events || []).length}`);
      for (const e of events || []) {
        await log(`  replay  ${e.kind} at=${e.at}s vis=${e.vis} ${e.detail || ''}`.trim());
      }
      res.writeHead(204).end();
      return;
    }

    const name = p === '/' ? '/index.html' : p;
    const buf = await readFile(join(PUBLIC, name));
    res.writeHead(200, { 'Content-Type': TYPES[extname(name)] || 'application/octet-stream' });
    res.end(buf);
  } catch (err) {
    if (err && err.code === 'ENOENT') { res.writeHead(404).end('not found'); return; }
    await log(`ERROR   ${p} ${err && err.message}`);
    res.writeHead(500).end('server error');
  }
});

// Spike telemetry only, and optional: Vercel never installs ws.
const WebSocketServer = await import('ws').then(m => m.WebSocketServer).catch(() => null);
const wss = WebSocketServer ? new WebSocketServer({ server, path: '/ws' }) : null;
if (wss) wss.on('connection', (sock, req) => {
  const session = new URL(req.url, 'http://x').searchParams.get('s');
  const since = Date.now();
  log(`OPEN    session=${session}`);

  sock.on('message', (raw) => {
    try {
      const e = JSON.parse(raw);
      if (e.kind === 'ping') log(`  ping   session=${session} n=${e.n} at=${e.at}s vis=${e.vis}`);
      else log(`EVENT   session=${session} ${e.kind} at=${e.at}s vis=${e.vis} ${e.detail || ''}`.trim());
    } catch { /* ignore malformed frames */ }
  });

  sock.on('close', (code) => {
    log(`CLOSE   session=${session} code=${code} held=${Math.round((Date.now() - since) / 1000)}s`);
  });
});

server.listen(PORT, () => log(`listening on ${PORT}  store=${store.kind}`));
