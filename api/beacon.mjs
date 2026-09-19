// Uncapped heartbeat. If beacons keep arriving while the app is out of
// view, the page is still executing — which is what decides how long a
// queued card waits. Logs land in the Vercel function logs.
export default function handler(req, res) {
  const q = req.query;
  console.log(`BEACON  session=${q.s} n=${q.n} at=${q.at}s vis=${q.vis}`);
  res.status(204).end();
}
