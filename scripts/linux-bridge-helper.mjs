#!/usr/bin/env node
import { existsSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import http from "node:http";
import net from "node:net";

const [command, ...args] = process.argv.slice(2);

function parsePort(value) {
  if (!/^\d{1,5}$/.test(value ?? "")) throw new Error("Invalid port");
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
  return port;
}

async function captureSshLog(outputPath) {
  const capacity = 64 * 1024;
  const tail = Buffer.alloc(capacity);
  let cursor = 0;
  let filled = 0;

  function copyCircular(chunk, sourceOffset, count, destinationOffset) {
    const first = Math.min(count, capacity - destinationOffset);
    chunk.copy(tail, destinationOffset, sourceOffset, sourceOffset + first);
    if (first < count) chunk.copy(tail, 0, sourceOffset + first, sourceOffset + count);
  }

  for await (const chunk of process.stdin) {
    // Keep terminal I/O out of this reader so a blocked TTY cannot stall FIFO draining.
    if (chunk.length >= capacity) {
      const sourceOffset = chunk.length - capacity;
      const oldest = (cursor + (chunk.length % capacity)) % capacity;
      copyCircular(chunk, sourceOffset, capacity, oldest);
      cursor = (cursor + (chunk.length % capacity)) % capacity;
      filled = capacity;
    } else {
      copyCircular(chunk, 0, chunk.length, cursor);
      cursor = (cursor + chunk.length) % capacity;
      filled = Math.min(capacity, filled + chunk.length);
    }
  }

  const start = filled === capacity ? cursor : 0;
  const retained = Buffer.alloc(filled);
  const first = Math.min(filled, capacity - start);
  tail.copy(retained, 0, start, start + first);
  if (first < filled) tail.copy(retained, first, 0, filled - first);
  const directory = dirname(outputPath);
  const cleanupMarker = `${outputPath}.cleanup`;
  if (existsSync(cleanupMarker)) {
    for (const path of [outputPath, `${directory}/ssh-stderr.fifo`, cleanupMarker]) {
      try { unlinkSync(path); } catch {}
    }
    try { rmdirSync(directory); } catch {}
  } else {
    writeFileSync(outputPath, retained, { mode: 0o600 });
  }
}

async function getBridgeSession(port, expectedPid) {
  const base = `http://127.0.0.1:${port}`;
  const timeout = AbortSignal.timeout(900);
  const bootstrap = await fetch(`${base}/bootstrap`, {
    headers: { Origin: "https://steamloopback.host" },
    signal: timeout,
  });
  if (!bootstrap.ok) throw new Error("Bootstrap failed");
  const { token } = await bootstrap.json();
  const health = await fetch(`${base}/health`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: timeout,
  });
  if (!health.ok) throw new Error("Health check failed");
  const identity = await health.json();
  if (String(identity.processId) !== expectedPid || !/^[0-9a-f-]{36}$/i.test(identity.sessionId)) {
    throw new Error("Bridge identity did not match the launched process");
  }
  return identity.sessionId;
}

async function shutdownBridge(port, expectedPid, expectedSessionId) {
  const base = `http://127.0.0.1:${port}`;
  const timeout = AbortSignal.timeout(1800);
  const bootstrap = await fetch(`${base}/bootstrap`, {
    headers: { Origin: "https://steamloopback.host" },
    signal: timeout,
  });
  if (!bootstrap.ok) throw new Error("Bootstrap failed");
  const { token } = await bootstrap.json();
  const headers = { Authorization: `Bearer ${token}` };
  const health = await fetch(`${base}/health`, { headers, signal: timeout });
  if (!health.ok) throw new Error("Health check failed");
  const identity = await health.json();
  if (String(identity.processId) !== expectedPid || identity.sessionId !== expectedSessionId) {
    throw new Error("Bridge identity did not match the launched process");
  }
  const response = await fetch(`${base}/shutdown`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ expectedSessionId }),
    signal: AbortSignal.timeout(1800),
  });
  if (!response.ok) throw new Error("Authenticated shutdown failed");
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(450);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(String(address.port));
      });
    });
  });
}

async function fingerprintHttpService(port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = http.get({
      hostname: "127.0.0.1",
      port,
      path: "/health",
      signal: AbortSignal.timeout(1800),
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 128) chunks.push(chunk);
        else request.destroy();
      });
      response.on("end", () => {
        if (size > 128) return finish("unknown");
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode === 401 && /^\s*\{\s*"error"\s*:\s*"Bridge authorization required"\s*\}\s*$/.test(body)) {
          finish("decky-whatsapp");
        } else {
          finish("other-http-service");
        }
      });
    });
    request.on("error", () => finish("unknown"));
  });
}

try {
  switch (command) {
    case "ssh-log-reader":
      if (!args[0]) throw new Error("Missing SSH log output path");
      await captureSshLog(args[0]);
      break;
    case "port-open":
      process.exitCode = await isPortOpen(parsePort(args[0])) ? 0 : 1;
      break;
    case "bridge-session":
      if (!/^\d+$/.test(args[1] ?? "")) throw new Error("Invalid expected process ID");
      process.stdout.write(await getBridgeSession(parsePort(args[0]), args[1]));
      break;
    case "bridge-shutdown":
      if (!/^\d+$/.test(args[1] ?? "") || !/^[0-9a-f-]{36}$/i.test(args[2] ?? "")) {
        throw new Error("Invalid expected bridge identity");
      }
      await shutdownBridge(parsePort(args[0]), args[1], args[2]);
      break;
    case "reserve-port":
      process.stdout.write(await reserveLoopbackPort());
      break;
    case "fingerprint":
      process.stdout.write(await fingerprintHttpService(parsePort(args[0])));
      break;
    default:
      throw new Error("Unknown Linux bridge helper command");
  }
} catch {
  if (command === "bridge-shutdown") process.exitCode = 2;
  else if (command === "bridge-session") process.exitCode = 1;
  else if (command === "fingerprint") process.stdout.write("unknown");
  else process.exitCode = 1;
}
