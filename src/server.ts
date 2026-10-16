// HTTP and WebSocket bridge between the Decky plugin and WhatsAppService.
import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { WhatsAppService } from "./whatsapp.js";
import type { BridgeEvent } from "./types.js";

const host = process.env.HOST ?? "127.0.0.1";
const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
if (!loopbackHosts.has(host)) {
  throw new Error(`Refusing to expose the WhatsApp bridge on non-loopback host: ${host}`);
}
const port = Number(process.env.PORT ?? 8787);
// A new token is created for each bridge process. It is bootstrapped only over
// the local/reverse-tunnel connection and is never embedded in the plugin.
const bridgeToken = randomBytes(32).toString("hex");
const sessionId = randomUUID();
const allowedOrigins = new Set([
  "https://steamloopback.host",
  "http://steamloopback.host",
  "http://localhost",
  "http://127.0.0.1"
]);
const app = express();
const httpServer = createServer(app);
const socketServer = new WebSocketServer({ server: httpServer, path: "/events" });
const whatsapp = new WhatsAppService();
const clients = new Set<WebSocket>();
let shuttingDown = false;

// Authenticate and validate origin before reading request bodies. Parser errors
// are handled below with fixed messages so body contents never reach logs.
app.use((request, response, next) => {
  const origin = request.header("Origin");
  if (origin && !allowedOrigins.has(origin)) {
    response.sendStatus(403);
    return;
  }
  if (origin) response.header("Access-Control-Allow-Origin", origin);
  response.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  if (request.path === "/bootstrap") {
    if (!origin || !allowedOrigins.has(origin)) {
      response.sendStatus(403);
      return;
    }
    next();
    return;
  }
  const authorization = request.header("Authorization");
  if (authorization !== `Bearer ${bridgeToken}`) {
    response.status(401).json({ error: "Bridge authorization required" });
    return;
  }
  next();
});

app.use(express.json({ limit: "32kb" }));

app.get("/bootstrap", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({ token: bridgeToken });
});

app.get("/health", (_request, response) => {
  response.json({ ok: true, status: whatsapp.getStatus(), sessionId, processId: process.pid });
});

app.post("/shutdown", async (request, response) => {
  const expectedSessionId = request.body?.expectedSessionId;
  if (expectedSessionId !== undefined && (typeof expectedSessionId !== "string" || expectedSessionId !== sessionId)) {
    response.status(409).json({ error: "Bridge session changed; refusing shutdown" });
    return;
  }
  if (shuttingDown) {
    response.json({ shuttingDown: true });
    return;
  }
  shuttingDown = true;
  response.json({ shuttingDown: true });
  console.log("[bridge] shutdown requested");
  setTimeout(async () => {
    // Close bridge listeners so the tunnel supervisor can observe that its local target has stopped.
    httpServer.close();
    for (const client of clients) client.close();
    clients.clear();
    const stopPromise = whatsapp.stop().catch(() => console.error("[bridge] WhatsApp shutdown failed"));
    await Promise.race([
      stopPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 3000))
    ]);
    socketServer.close();
    httpServer.close();
    setTimeout(() => process.exit(0), 1000);
  }, 250);
});

app.get("/messages", (_request, response) => {
  response.json({ messages: whatsapp.getRecentMessages() });
});

app.get("/chats", async (_request, response) => {
  try {
    const rawLimit = Number(_request.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : undefined;
    const result = await whatsapp.getRecentChats(limit);
    console.log(`[bridge] returning ${result.chats.length} chats${result.hasMore ? " (more available)" : ""}`);
    response.json(result);
  } catch {
    console.error("[bridge] chats request failed");
    response.status(409).json({ error: "Unable to load chats" });
  }
});

app.get("/chats/:chatId/profile", async (request, response) => {
  if (shuttingDown) {
    response.status(503).json({ error: "Bridge is shutting down" });
    return;
  }
  try {
    console.log(`[bridge] profile request for ${request.params.chatId}`);
    const profilePicUrl = await whatsapp.getProfilePicUrl(request.params.chatId);
    response.json({ profilePicUrl: profilePicUrl || null });
  } catch {
    console.error("[bridge] profile request failed");
    response.status(409).json({ error: "Unable to load profile picture" });
  }
});

app.get("/chats/:chatId/messages", async (request, response) => {
  const controller = new AbortController();
  response.on("close", () => { if (!response.writableEnded) controller.abort(); });
  try {
    const rawLimit = Number(request.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 100) : 5;
    response.json(await whatsapp.getChatHistory(request.params.chatId, limit, controller.signal));
  } catch {
    if (!response.destroyed) response.status(409).json({ error: "Unable to load chat history" });
  }
});

app.post("/chats/:chatId/read", async (request, response) => {
  if (shuttingDown) {
    response.status(503).json({ error: "Bridge is shutting down" });
    return;
  }
  try {
    const marked = await whatsapp.markChatRead(request.params.chatId);
    response.json({ marked });
  } catch {
    console.error("[bridge] unable to mark chat as read");
    response.status(409).json({ error: "Unable to mark chat as read" });
  }
});

app.post("/messages", async (request, response) => {
  const { chatId, body, quotedMessageId } = request.body as { chatId?: unknown; body?: unknown; quotedMessageId?: unknown };
  if (typeof chatId !== "string" || typeof body !== "string" || !body.trim()) {
    response.status(400).json({ error: "chatId and a non-empty body are required" });
    return;
  }
  if (quotedMessageId !== undefined && typeof quotedMessageId !== "string") {
    response.status(400).json({ error: "quotedMessageId must be a string" });
    return;
  }

  try {
    console.log("[bridge] sending message", {
      chatId,
      bodyLength: body.trim().length,
      quotedMessageId: quotedMessageId || null
    });
    await whatsapp.sendMessage(chatId, body, quotedMessageId as string | undefined);
    console.log("[bridge] message accepted", { chatId, quotedMessageId: quotedMessageId || null });
    response.status(202).json({ accepted: true });
  } catch {
    console.error("[bridge] message send failed");
    response.status(409).json({ error: "Unable to send message" });
  }
});

app.post("/messages/delete", async (request, response) => {
  const { chatId, messageId } = request.body as { chatId?: unknown; messageId?: unknown };
  if (typeof chatId !== "string" || !chatId || typeof messageId !== "string" || !messageId) {
    response.status(400).json({ error: "chatId and messageId are required" });
    return;
  }
  try {
    console.log("[bridge] deleting message", { chatId, messageId });
    await whatsapp.deleteMessage(chatId, messageId);
    response.json({ deleted: true });
  } catch {
    console.error("[bridge] message deletion failed");
    response.status(409).json({ error: "Unable to delete message" });
  }
});

app.post("/reactions", async (request, response) => {
  const { chatId, messageId, emoji } = request.body as { chatId?: unknown; messageId?: unknown; emoji?: unknown };
  if (typeof chatId !== "string" || !chatId || typeof messageId !== "string" || !messageId) {
    response.status(400).json({ error: "chatId and messageId are required" });
    return;
  }
  if (emoji !== undefined && typeof emoji !== "string") {
    response.status(400).json({ error: "emoji must be a string" });
    return;
  }
  try {
    await whatsapp.reactToMessage(chatId, messageId, typeof emoji === "string" ? emoji : "❤️");
    response.json({ reacted: typeof emoji !== "string" || emoji.length > 0 });
  } catch {
    console.error("[bridge] reaction failed");
    response.status(409).json({ error: "Unable to react to message" });
  }
});

// WebSocket connections and live bridge-event delivery.
socketServer.on("connection", (socket, request) => {
  socket.on("error", () => {
    console.warn("[bridge] closing failed event connection");
    clients.delete(socket);
    socket.terminate();
  });
  if (request.url && new URL(request.url, "http://127.0.0.1").searchParams.get("token") !== bridgeToken) {
    socket.close(1008, "Bridge authorization required");
    return;
  }
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    socket.close(1008, "Origin not allowed");
    return;
  }
  clients.add(socket);
  socket.send(JSON.stringify({ type: "status", status: whatsapp.getStatus() } satisfies BridgeEvent));
  socket.on("close", () => clients.delete(socket));
});

whatsapp.onEvent((event) => {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
});

// Listener startup, port conflicts, and process shutdown.
httpServer.listen(port, host, () => {
  console.log(`Decky WhatsApp bridge listening on http://${host}:${port}`);
  console.log(`WebSocket events available at ws://${host}:${port}/events`);
  void whatsapp.start().catch(() => {
    console.error("Unable to start WhatsApp Web; recovery scheduled.");
  });
});

const serverError = (error: NodeJS.ErrnoException) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(error.code === "EADDRINUSE"
    ? `Bridge port ${port} is already in use. Close the existing bridge before starting another.`
    : "Bridge server failed to start.");
  socketServer.close();
  httpServer.close();
  process.exitCode = 1;
};
httpServer.on("error", serverError);
socketServer.on("error", serverError);

// Parser and otherwise-unhandled request errors must never expose body contents
// or implementation details to clients or logs.
app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (!response.headersSent) response.status(400).json({ error: "Invalid request" });
});

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const client of clients) client.terminate();
  clients.clear();
  socketServer.close();
  httpServer.close();
  await whatsapp.stop();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
