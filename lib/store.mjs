// Session state lives here, never in a module-level variable.
//
// On a single long-lived process either backend works. On serverless only
// the REST one does: Muse's `show_card` and the wearer's poll land on
// different function instances, so anything held in memory is written
// where the reader will never look.
//
// Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to use Redis.
// Vercel KV exposes the same REST interface under the same names.

const ANSWER_TTL = 60 * 60; // an unanswered card is stale after an hour

function memoryStore() {
  const cards = new Map();   // session -> [card]
  const answers = new Map(); // ticket  -> { answer, at }
  const seen = new Map();    // session -> timestamp of last poll

  return {
    kind: 'memory',
    async touch(session) { seen.set(session, Date.now()); },
    async lastSeen(session) { return seen.get(session) || 0; },
    async pushCard(session, card) {
      if (!cards.has(session)) cards.set(session, []);
      cards.get(session).push(card);
      return card.ticket;
    },
    async takePending(session) {
      const queued = cards.get(session) || [];
      cards.set(session, []);
      return queued;
    },
    async peekDepth(session) {
      return (cards.get(session) || []).length;
    },
    async setAnswer(ticket, answer) {
      answers.set(ticket, { answer, at: Date.now() });
    },
    async getAnswer(ticket) {
      const hit = answers.get(ticket);
      if (!hit) return null;
      if (Date.now() - hit.at > ANSWER_TTL * 1000) { answers.delete(ticket); return null; }
      return hit.answer;
    }
  };
}

function redisStore(url, token) {
  // Upstash REST: POST a command as a JSON array, get { result }.
  async function cmd(...parts) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(parts)
    });
    if (!res.ok) throw new Error(`redis ${res.status} on ${parts[0]}`);
    const body = await res.json();
    return body.result;
  }

  const cardsKey  = (s) => `cards:${s}`;
  const answerKey = (t) => `ans:${t}`;
  const seenKey   = (s) => `seen:${s}`;

  return {
    kind: 'redis',
    // A short TTL is the liveness signal: if the key has expired, the
    // display stopped polling and nobody is looking.
    async touch(session) {
      await cmd('SET', seenKey(session), String(Date.now()), 'EX', 120);
    },
    async lastSeen(session) {
      const raw = await cmd('GET', seenKey(session));
      return raw ? Number(raw) : 0;
    },
    async pushCard(session, card) {
      await cmd('RPUSH', cardsKey(session), JSON.stringify(card));
      return card.ticket;
    },
    async takePending(session) {
      // LPOP with a count drains and clears in one round trip, so two
      // overlapping polls cannot both receive the same card.
      const raw = await cmd('LPOP', cardsKey(session), 50);
      if (!raw) return [];
      const list = Array.isArray(raw) ? raw : [raw];
      return list.map((s) => { try { return JSON.parse(s); } catch { return null; } })
                 .filter(Boolean);
    },
    async peekDepth(session) {
      return (await cmd('LLEN', cardsKey(session))) || 0;
    },
    async setAnswer(ticket, answer) {
      await cmd('SET', answerKey(ticket), JSON.stringify(answer), 'EX', ANSWER_TTL);
    },
    async getAnswer(ticket) {
      const raw = await cmd('GET', answerKey(ticket));
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }
  };
}

export function openStore(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? redisStore(url, token) : memoryStore();
}

export function newTicket() {
  return 't_' + Math.random().toString(36).slice(2, 10);
}
