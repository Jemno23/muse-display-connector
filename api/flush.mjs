// Events the page buffered while it had no connection at all.
export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('method not allowed');
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  console.log(`FLUSH   session=${b.session} buffered=${(b.events || []).length}`);
  for (const e of b.events || []) {
    console.log(`  replay  ${e.kind} at=${e.at}s vis=${e.vis} ${e.detail || ''}`.trim());
  }
  res.status(204).end();
}
