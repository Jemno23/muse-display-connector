import { openStore } from '../lib/store.mjs';

const store = openStore();

// The client says "this is on screen now". Delivery to the poll queue is
// not the same thing, and only the glasses know the difference.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('method not allowed');
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (!b.ticket) return res.status(400).json({ error: 'missing ticket' });
  await store.markRendered(b.ticket);
  console.log(`DRAWN   ticket=${b.ticket}`);
  res.status(200).json({ ok: true });
}
