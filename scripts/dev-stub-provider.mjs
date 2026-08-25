/**
 * Local OpenAI-compatible stub used ONLY to exercise the gateway end-to-end.
 *
 * It is a test double for an external service (llama.cpp / Ollama), not part of
 * the product: it lets us prove that provider registration → model discovery →
 * model assignment → routed call → usage accounting really works, without
 * depending on a machine we cannot reach from here.
 *
 * Usage: node scripts/dev-stub-provider.mjs  → listens on 127.0.0.1:8099
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 8099);

const MODELS = [
  { id: 'stub-reasoner-7b', name: 'Stub Reasoner 7B', context: 32768 },
  { id: 'stub-coder-13b', name: 'Stub Coder 13B', context: 16384 },
];

const server = createServer((req, res) => {
  const send = (status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
    });
    res.end();
    return;
  }

  if (req.url === '/v1/models' || req.url === '/models') {
    send(200, { object: 'list', data: MODELS.map((m) => ({ id: m.id, object: 'model', owned_by: 'stub' })) });
    return;
  }

  if (req.url === '/health') {
    send(200, { status: 'ok' });
    return;
  }

  if (req.url === '/v1/chat/completions' || req.url === '/chat/completions') {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let parsed = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* keep going — a malformed body still gets a shaped reply */
      }
      const messages = parsed.messages ?? [];
      const last = messages[messages.length - 1]?.content ?? '';
      const model = parsed.model ?? MODELS[0].id;
      const reply = `STUB(${model}) réponse déterministe à : ${String(last).slice(0, 120)}`;
      send(200, {
        id: `chatcmpl-stub-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 42, completion_tokens: 18, total_tokens: 60 },
      });
    });
    return;
  }

  send(404, { error: { message: `stub has no route for ${req.url}` } });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub provider listening on http://127.0.0.1:${PORT}/v1`);
});
