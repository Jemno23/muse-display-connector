import { think } from '../lib/think.mjs';

// The glasses call this while the wearer holds their gaze. It aborts
// naturally when they look away: the client drops the request, and this
// function's own timeout keeps a slow call from outliving the moment.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('method not allowed');

  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const card = b.card || {};
  const effort = b.effort || 'high';

  const ctl = new AbortController();
  const bail = setTimeout(() => ctl.abort(), 20_000);

  try {
    const out = await think({ card, effort, signal: ctl.signal });
    console.log(`THINK   effort=${effort} ok=${out.ok} `
      + (out.ok ? `"${out.text}"` : `${out.reason} ${out.message}`));
    res.status(out.ok ? 200 : 503).json(out);
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    console.log(`THINK   effort=${effort} ${aborted ? 'timed out' : 'failed'} ${err && err.message}`);
    res.status(aborted ? 504 : 500).json({ ok: false, reason: aborted ? 'timeout' : 'error' });
  } finally {
    clearTimeout(bail);
  }
}
