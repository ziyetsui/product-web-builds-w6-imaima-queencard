const http = require("node:http");
const { createApp } = require("./app");
const { getListenOptions } = require("./listen-options");

const app = createApp();
const listenOptions = getListenOptions(process.env);

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    try {
      const origin = `http://${req.headers.host || `${listenOptions.host}:${listenOptions.port}`}`;
      const request = new Request(new URL(req.url || "/", origin), {
        method: req.method,
        headers: req.headers,
        body: ["GET", "HEAD"].includes(req.method || "") ? undefined : Buffer.concat(chunks),
      });
      const response = await app.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${response.status} ${Date.now() - startedAt}ms`);
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, error: error.message || "Server error" }));
      console.error(`${new Date().toISOString()} ${req.method} ${req.url} 500 ${Date.now() - startedAt}ms ${error.message || error}`);
    }
  });
});

server.listen(listenOptions.port, listenOptions.host, () => {
  console.log(`ima miniapp backend listening on http://${listenOptions.host}:${listenOptions.port}`);
});
