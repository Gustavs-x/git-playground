import { readFile } from "node:fs/promises";
import express from "express";
import { createClient } from "redis";

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Invalid PORT");
}

if (!process.env.REDIS_USERNAME) {
  throw new Error("REDIS_USERNAME is required");
}

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is required");
}

if (!process.env.REDIS_PASSWORD_FILE) {
  throw new Error("REDIS_PASSWORD_FILE is required");
}

const redisPassword = (
  await readFile(process.env.REDIS_PASSWORD_FILE, "utf8")
).trim();

if (!redisPassword) {
  throw new Error("Redis password is empty");
}

const redis = createClient({
  url: process.env.REDIS_URL,
  username: process.env.REDIS_USERNAME,
  password: redisPassword,
  disableClientInfo: true,
  disableOfflineQueue: true,
  commandsQueueMaxLength: 100,
  socket: { connectTimeout: 5000 },
  commandOptions: { timeout: 2000 }
});

redis.on("error", (error) => console.error("Redis error:", error.name));
redis.on("ready", () => console.log("Redis connected"));
await redis.connect();


async function runRedis(operation) {
  try {
    if (!redis.isReady) throw new Error("Not connected");
    return await operation();
  } catch {
    const error = new Error("Redis unavailable");
    error.status = 503;
    throw error;
  }
}

const app = express();
const messageKey = "compose-demo:api:message";
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "2kb" }));

app.get("/health/live", (_req, res) => {
  res.json({ status: "alive" });
});

app.get("/health/ready", async (_req, res) => {
  const pong = await runRedis(() => redis.ping());
  res.json({ status: "ready", redis: pong });
});

app.get("/message", async (_req, res) => {
  const message = await runRedis(() => redis.get(messageKey));
  res.json({ message });
});

app.put("/message", async (req, res) => {
  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim() || message.length > 500) {
    return res.status(400).json({
      error: "message must be a string of 1-500 characters"
    });
  }
  await runRedis(() => redis.set(messageKey, message));
  res.json({ message });
});

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) &&
    error.status >= 400 && error.status <= 599 ? error.status : 500;

  console.error("Request failed:", status, error.name);
  res.status(status).json({
    error: status === 503 ? "Redis unavailable" :
      status < 500 ? "Invalid request" : "Internal server error"
  });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log("API listening on port", port);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(1), 8000).unref();
  server.close(async () => {
    try {
      if (redis.isOpen) await redis.close();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);