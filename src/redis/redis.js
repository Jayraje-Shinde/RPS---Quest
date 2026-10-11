import { createClient } from "redis";

const STREAM = "dbStream";
const GROUP = "db-writer";
const DEAD_STREAM = "dbStream:dead";

function makeClient() {
  const c = createClient({
    socket: {
      host: process.env.REDIS_HOST ?? "localhost",
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  });
  // Without an 'error' listener, node-redis throws on any connection error and kills the process.
  c.on("error", (err) => console.error("redis error:", err.message));
  return c;
}

const redisClient = makeClient();
await redisClient.connect();
console.log("Connected to Redis");

// A blocking XREADGROUP occupies its connection for up to BLOCK ms. Sharing one connection
// would stall XACK/XADD behind it, so the worker's blocking reads get their own connection.
let readerClient = null;
async function getReader() {
  if (!readerClient) {
    readerClient = makeClient();
    await readerClient.connect();
  }
  return readerClient;
}

// "0" (not "$") so messages queued before the group existed are not skipped.
async function ensureConsumerGroup() {
  try {
    await redisClient.xGroupCreate(STREAM, GROUP, "0", { MKSTREAM: true });
    console.log(`Created consumer group "${GROUP}" on stream "${STREAM}"`);
  } catch (err) {
    if (!String(err.message).includes("BUSYGROUP")) throw err;
  }
}

// These return the promise so callers can await it or attach .catch().
const setKV = (key, value, ttlSeconds) => redisClient.set(key, value, { EX: ttlSeconds });
const getValue = (key) => redisClient.get(key);
const delKey = (key) => redisClient.del(key);

async function writeBuffer(operation, payload) {
  return redisClient.xAdd(STREAM, "*", { operation, payload: JSON.stringify(payload) });
}

async function ackHelper(messageIds) {
  if (messageIds.length === 0) return;
  await redisClient.xAck(STREAM, GROUP, messageIds);
}

// Messages that can never succeed are parked here instead of blocking the queue forever.
async function deadLetter(originalId, message, reason) {
  await redisClient.xAdd(DEAD_STREAM, "*", {
    originalId,
    reason: String(reason).slice(0, 500),
    operation: message?.operation ?? "",
    payload: message?.payload ?? "",
  });
}

// pending=true  -> re-read messages this consumer was given but never acked (crash/failure recovery)
// pending=false -> wait up to blockMs for NEW messages; returns as soon as at least one arrives
async function readBuffer({ consumer, count, blockMs, pending }) {
  const reader = await getReader();
  const res = await reader.xReadGroup(
    GROUP,
    consumer,
    { key: STREAM, id: pending ? "0" : ">" },
    pending ? { COUNT: count } : { COUNT: count, BLOCK: blockMs },
  );
  if (!res) return [];
  return res[0]?.messages ?? [];
}

export {
  redisClient,
  setKV,
  getValue,
  delKey,
  writeBuffer,
  ackHelper,
  deadLetter,
  readBuffer,
  ensureConsumerGroup,
};
