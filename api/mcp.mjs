import { openStore } from '../lib/store.mjs';
import { handleMcp } from '../lib/api.mjs';

// The bounded wait needs to finish inside the function's lifetime, or the
// caller gets a dropped connection instead of a pending response.
export const maxDuration = 60;

const store = openStore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('method not allowed');
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  const out = await handleMcp(store, {
    body,
    auth: req.headers.authorization,
    accept: req.headers.accept
  }, console.log);
  res.writeHead(out.status, out.headers);
  res.end(out.body);
}
