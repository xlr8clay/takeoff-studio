'use strict';
/**
 * Ask AI on the server: POST /api/ai/chat streams Claude's reply as plain text.
 * Used by the page when it is not running inside claude.ai (Render, local server).
 * Needs ANTHROPIC_API_KEY on the server; without it the route answers 503 AI_OFF.
 * The key never reaches the browser. Nothing here is stored in the database.
 */
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5-5';
const MAX_TURNS = 30;
const MAX_CHARS = 200000; // whole conversation, page text included
const EFFORTS = ['low', 'medium'];

function createClient(apiKey) {
  return apiKey ? new Anthropic({ apiKey }) : null;
}

// Accepts [{ role: 'user'|'assistant', content: string }], first and last from the user.
function cleanMessages(body) {
  const list = body && body.messages;
  if (!Array.isArray(list) || !list.length || list.length > MAX_TURNS) return null;
  let total = 0;
  const out = [];
  for (const m of list) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) return null;
    total += m.content.length;
    out.push({ role: m.role, content: m.content });
  }
  if (total > MAX_CHARS || out[0].role !== 'user' || out[out.length - 1].role !== 'user') return null;
  return out;
}

function errorReply(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { status: 502, code: 'AI_KEY', message: 'The server\'s Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Render.' };
  }
  if (err instanceof Anthropic.RateLimitError) return { status: 429, code: 'AI_BUSY', message: 'Claude is busy or the limit was reached. Try again in a minute.' };
  if (err instanceof Anthropic.APIError) return { status: 502, code: 'AI_ERROR', message: `Claude returned an error (${err.status || 'no status'}).` };
  return { status: 502, code: 'AI_ERROR', message: 'Could not reach Claude.' };
}

function mountAi(app, { requireUser, client }) {
  app.post('/api/ai/chat', requireUser, async (req, res) => {
    if (!client) return res.status(503).json({ code: 'AI_OFF', message: 'AI chat is off on this server: ANTHROPIC_API_KEY is not set.' });
    const messages = cleanMessages(req.body);
    if (!messages) return res.status(400).json({ code: 'INVALID', message: 'messages must be 1-30 user/assistant text turns, starting and ending with the user.' });

    // Chat runs at low effort; reading a plan set for its earthwork requirements asks for medium.
    const effort = EFFORTS.includes(req.body.effort) ? req.body.effort : 'low';
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // a declined request is retried on a fallback model in the same call
      messages,
    });
    let closed = false;
    res.on('close', () => { if (!res.writableFinished) { closed = true; stream.abort(); } });

    let started = false;
    const begin = () => {
      if (started) return;
      started = true;
      res.status(200).set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
    };
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          begin();
          res.write(event.delta.text);
        }
      }
      const final = await stream.finalMessage();
      begin();
      if (final.stop_reason === 'refusal') res.write('\n\n(Claude declined to answer this one.)');
      else if (final.stop_reason === 'max_tokens') res.write('\n\n(The answer was cut off at the length limit.)');
      res.end();
    } catch (err) {
      if (closed) return;
      const r = errorReply(err);
      console.error(`ai chat: ${r.code} ${err && err.message}`);
      if (!started) return res.status(r.status).json({ code: r.code, message: r.message });
      res.end(`\n\n(${r.message})`);
    }
  });
}

module.exports = { mountAi, createClient, cleanMessages, MODEL };
