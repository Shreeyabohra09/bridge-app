// Vercel serverless function: Mo's live replies and feedback, powered by Claude.
// Needs the ANTHROPIC_API_KEY environment variable (set it in Vercel, never in code).

const MODEL = 'claude-haiku-5-5';
const CRISIS = /\b(kill myself|end my life|suicid|self[- ]?harm|hurt myself|want to die|don'?t want to (be here|live)|no reason to live)\b/i;

const clean = (t, max = 500) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, max);

async function askClaude(system, messages, maxTokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature: 0.7, system, messages }),
  });
  if (!r.ok) throw new Error('Claude API ' + r.status);
  const data = await r.json();
  return (data.content || []).map((c) => c.text || '').join('').trim();
}

// Turn [['me', text], ['them', text]] into alternating user/assistant turns
function toTurns(history) {
  const turns = [];
  for (const [who, text] of history) {
    const role = who === 'me' ? 'user' : 'assistant';
    const t = clean(text);
    if (!t) continue;
    if (turns.length && turns[turns.length - 1].role === role) turns[turns.length - 1].content += '\n' + t;
    else turns.push({ role, content: t });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Missing API key' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const mode = body.mode === 'feedback' ? 'feedback' : 'reply';
  const partner = clean(body.partner, 40) || 'Alex';
  const relation = clean(body.relation, 60) || 'a friend';
  const scene = clean(body.scene, 300);
  const goal = clean(body.goal, 200);
  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
  const lastMine = clean((history.filter((h) => h[0] === 'me').pop() || [])[1]);

  // Safety first: never role-play through a crisis message
  if (CRISIS.test(lastMine)) return res.status(200).json({ crisis: true });

  try {
    if (mode === 'reply') {
      const system =
        `You are ${partner}, the user's ${relation}, texting them in a chat app. ${scene}\n` +
        `Reply as ${partner} would: casual, warm, 1-2 short sentences, like a real text message. ` +
        `React to what they actually said and sometimes ask a simple question back. ` +
        `No emojis overload, no lectures, no advice about social skills, never mention being an AI. ` +
        `Keep it friendly and safe: no romance, no requests for money, addresses or personal details.`;
      const turns = toTurns(history);
      if (!turns.length) return res.status(400).json({ error: 'No message' });
      const reply = await askClaude(system, turns, 120);
      return res.status(200).json({ reply });
    }

    // Practice feedback: one thing that went well, one thing to try
    const system =
      `You are Mo, a calm, kind social coach for a neurodivergent young adult practicing a conversation. ` +
      `Judge their reply only against their own goal, never against neurotypical norms. ` +
      `Return exactly two lines and nothing else:\n` +
      `WELL: <one specific thing that went well, under 25 words>\n` +
      `TRY: <one gentle, concrete thing to try next time, under 25 words, may include a short example>\n` +
      `Plain words. No scores, no diagnosis, no judgement.`;
    const prompt =
      `Scenario: ${scene || 'a chat with ' + partner}\n` +
      `Their goal: ${goal || 'sound friendly and clear'}\n` +
      `${partner} said: "${clean(body.opener) || '(they started the chat)'}"\n` +
      `They replied: "${lastMine}"`;
    const out = await askClaude(system, [{ role: 'user', content: prompt }], 160);
    const well = (out.match(/WELL:\s*(.+)/i) || [])[1] || '';
    const tryNext = (out.match(/TRY:\s*(.+)/i) || [])[1] || '';
    return res.status(200).json({ well: well.trim(), tryNext: tryNext.trim() });
  } catch (e) {
    return res.status(502).json({ error: 'AI unavailable' });
  }
}
