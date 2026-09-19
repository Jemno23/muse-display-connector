import { openStore } from '../lib/store.mjs';
import { handlePending } from '../lib/api.mjs';

const store = openStore();

export default async function handler(req, res) {
  const out = await handlePending(store, req.query.s);
  res.writeHead(out.status, out.headers);
  res.end(out.body);
}
