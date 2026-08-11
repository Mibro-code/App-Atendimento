const clients = new Set();

function handle(req, res) {
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(": connected\n\n");

  const client = { res };
  clients.add(client);
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20000);
  heartbeat.unref();

  const cleanup = () => {
    clearInterval(heartbeat);
    clients.delete(client);
  };
  req.once("close", cleanup);
  res.once("error", cleanup);
}

function publish() {
  const frame = `event: inbox.updated\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`;
  for (const client of clients) {
    if (client.res.destroyed || client.res.writableEnded) {
      clients.delete(client);
      continue;
    }
    client.res.write(frame);
  }
}

module.exports = { handle, publish };
