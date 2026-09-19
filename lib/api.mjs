// Every handler is a plain function over (store, input) -> { status, headers, body }.
// The Node server wraps them today; Vercel route handlers wrap the same
// functions after the port, so the logic moves without being rewritten.

import { newTicket } from './store.mjs';

const PROTOCOL = '2025-06-18';
const WAIT_BOUND_MS = 25_000; // stay under the shortest plausible function cap
const WAIT_TICK_MS = 500;

// Identity comes from the per-user credential Muse stores when the
// connector is added. Nothing documents Muse passing a stable user id,
// so the credential is the session key.
export function sessionFromAuth(header) {
  const raw = (header || '').replace(/^Bearer\s+/i, '').trim();
  if (!raw) return null;
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return 'd_' + (h >>> 0).toString(36);
}

const TOOLS = [
  {
    name: 'notify',
    description: 'Show one dim line on the wearer\'s display. Returns immediately. '
      + 'Use for progress the wearer does not need to act on.',
    inputSchema: {
      type: 'object',
      properties: { line: { type: 'string', description: 'One short sentence, ideally under seven words.' } },
      required: ['line']
    }
  },
  {
    name: 'show_card',
    description: 'Show a card with options and return a ticket. Does not wait. '
      + 'Call wait_for_answer with the ticket to collect the choice.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        options: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 }
      },
      required: ['body', 'options']
    }
  },
  {
    name: 'ask_approval',
    description: 'CONSEQUENTIAL. Ask the wearer to approve an action with real-world '
      + 'effect before performing it. Renders on hardware outside this agent\'s runtime. '
      + 'Returns a ticket; collect the decision with wait_for_answer.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'What will happen if approved.' },
        detail: { type: 'string', description: 'Amount, recipient or other specifics.' }
      },
      required: ['action']
    }
  },
  {
    name: 'wait_for_answer',
    description: 'Collect the wearer\'s answer for a ticket. Waits briefly, then returns '
      + 'status "pending" if the wearer has not answered yet. Call again to keep waiting.',
    inputSchema: {
      type: 'object',
      properties: { ticket: { type: 'string' } },
      required: ['ticket']
    }
  }
];

function ok(id, payload) {
  return { jsonrpc: '2.0', id, result: payload };
}
function fail(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
function content(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }], structuredContent: obj };
}

async function callTool(store, session, name, args, log) {
  if (!session) return content({ error: 'no paired display for this credential' });

  switch (name) {
    case 'notify': {
      const ticket = newTicket();
      await store.pushCard(session, { ticket, kind: 'notify', line: args.line, at: Date.now() });
      log(`TOOL    notify session=${session} "${args.line}"`);
      return content({ status: 'queued', ticket });
    }
    case 'show_card': {
      const ticket = newTicket();
      await store.pushCard(session, {
        ticket, kind: 'card', title: args.title || '', body: args.body,
        options: args.options, at: Date.now()
      });
      log(`TOOL    show_card session=${session} ticket=${ticket}`);
      return content({ status: 'queued', ticket });
    }
    case 'ask_approval': {
      const ticket = newTicket();
      await store.pushCard(session, {
        ticket, kind: 'approval', title: 'APPROVE', body: args.action,
        detail: args.detail || '', options: ['Approve', 'Decline'], at: Date.now()
      });
      log(`TOOL    ask_approval session=${session} ticket=${ticket}`);
      return content({ status: 'queued', ticket });
    }
    case 'wait_for_answer': {
      const until = Date.now() + WAIT_BOUND_MS;
      while (Date.now() < until) {
        const answer = await store.getAnswer(args.ticket);
        if (answer) {
          log(`ANSWER  ticket=${args.ticket} -> ${answer.choice}`);
          return content({ status: 'answered', ...answer });
        }
        await new Promise((r) => setTimeout(r, WAIT_TICK_MS));
      }
      const depth = await store.peekDepth(session);
      log(`PENDING ticket=${args.ticket} queue=${depth}`);
      return content({
        status: 'pending',
        ticket: args.ticket,
        // Undelivered means the app is not open. Say so plainly, so the
        // agent can fall back to chat rather than assume a refusal.
        display: depth > 0 ? 'unreachable' : 'showing',
        hint: 'Call wait_for_answer again, or collect this on your next run.'
      });
    }
    default:
      return content({ error: `unknown tool ${name}` });
  }
}

export async function handleMcp(store, { body, auth, accept }, log = () => {}) {
  let msg;
  try { msg = JSON.parse(body); } catch { return json(400, fail(null, -32700, 'parse error')); }

  const session = sessionFromAuth(auth);
  const wantsStream = (accept || '').includes('text/event-stream');
  const reply = (payload) => wantsStream
    ? { status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: `data: ${JSON.stringify(payload)}\n\n` }
    : json(200, payload);

  switch (msg.method) {
    case 'initialize':
      return reply(ok(msg.id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'Display Connector', version: '0.1.0' }
      }));
    case 'tools/list':
      return reply(ok(msg.id, { tools: TOOLS }));
    case 'tools/call': {
      const { name, arguments: args } = msg.params || {};
      const result = await callTool(store, session, name, args || {}, log);
      return reply(ok(msg.id, { ...result, isError: false }));
    }
    default:
      // Notifications carry no id and expect no response.
      if (msg.id === undefined) return { status: 202, headers: {}, body: '' };
      return reply(fail(msg.id, -32601, `unknown method ${msg.method}`));
  }
}

// --- the glasses side -------------------------------------------------

export async function handlePending(store, session) {
  if (!session) return json(400, { error: 'missing session' });
  const cards = await store.takePending(session);
  return json(200, { cards });
}

export async function handleAnswer(store, { ticket, choice, index }, log = () => {}) {
  if (!ticket) return json(400, { error: 'missing ticket' });
  await store.setAnswer(ticket, { choice, index, at: Date.now() });
  log(`PINCH   ticket=${ticket} -> ${choice}`);
  return json(200, { ok: true });
}

function json(status, obj) {
  return { status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

export { json, TOOLS };
