import { openStore } from '../lib/store.mjs';
import { handleAnswer } from '../lib/api.mjs';

const store = openStore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('method not allowed');
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const out = await handleAnswer(store, b, console.log);
  res.writeHead(out.status, out.headers);
  res.end(out.body);
}
