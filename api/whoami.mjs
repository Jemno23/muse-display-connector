import { sessionFromAuth } from '../lib/api.mjs';

// Setup helper: which display id does this credential map to?
export default function handler(req, res) {
  const session = sessionFromAuth(req.headers.authorization);
  res.status(200).json({ session, paired: Boolean(session) });
}
