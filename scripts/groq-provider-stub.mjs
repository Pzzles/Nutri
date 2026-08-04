import { createServer } from "node:http";

const port = Number(process.env.GATE4_GROQ_STUB_PORT ?? "5599");

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/openai/v1/chat/completions") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Not found" } }));
    return;
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const userMessage = body?.messages?.findLast?.((message) => message?.role === "user")?.content;
  if (typeof userMessage !== "string" || !/150g chicken breast/i.test(userMessage)) {
    response.writeHead(422, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Unsupported deterministic fixture" } }));
    return;
  }

  const content = JSON.stringify([{
    raw_phrase: "150g chicken breast",
    normalized_name: "chicken breast",
    quantity: 150,
    unit: "g",
    confidence_hint: "high",
    ambiguous: false,
  }]);
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    choices: [{ message: { role: "assistant", content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }));
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Gate 4 Groq provider stub listening on ${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
