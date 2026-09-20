// Dwell-to-think: the wearer holding their gaze is the signal to reason
// harder about the card in front of them.
//
// This calls Muse Spark directly on Meta Model API rather than going
// through Muse the agent, because a connector cannot call the agent — the
// integration only runs one way. A direct model call is the only route
// from "she is still looking" to "think about this again, properly".
//
// Needs MODEL_API_KEY. Without it the endpoint says so plainly and the
// glasses fall back to showing the detail the agent already attached.

const ENDPOINT = 'https://api.meta.ai/v1/chat/completions';
const MODEL = 'muse-spark-1.3';

// A heads-up display is not a chat window. The reader is walking, the text
// sits over traffic, and they can spare under a second. Brevity is not a
// style preference here, it is the medium.
const SYSTEM = [
  'You are answering on a heads-up display worn on the wearer\'s face.',
  'Reply with ONE sentence of at most 14 words.',
  'No preamble, no restating the question, no lists, no markdown, no emoji.',
  'If the honest answer is that it depends, say what it depends on.',
  'The wearer is walking and can glance for under a second.'
].join(' ');

const EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);

export async function think({ card, effort, signal }, env = process.env) {
  const key = env.MODEL_API_KEY;
  if (!key) {
    return { ok: false, reason: 'no-key',
             message: 'MODEL_API_KEY is not set on this deployment.' };
  }
  if (!EFFORTS.has(effort)) effort = 'high';

  const question = [
    card.title ? `Context: ${card.title}` : null,
    `The wearer is looking at: "${card.body || card.line || ''}"`,
    card.detail ? `Detail already shown: ${card.detail}` : null,
    card.options && card.options.length
      ? `Their options are: ${card.options.join(' / ')}`
      : null,
    'They have held their gaze on it, which means they want a considered',
    'view rather than a summary. Give them the one thing worth knowing.'
  ].filter(Boolean).join('\n');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: effort,
      max_tokens: 160,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: question }
      ]
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, reason: 'upstream',
             message: `Model API ${res.status}`, detail: body.slice(0, 300) };
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || '';
  return {
    ok: true,
    effort,
    text,
    // Reasoning tokens bill as output, so it is worth seeing what a tier costs.
    usage: data?.usage || null
  };
}
