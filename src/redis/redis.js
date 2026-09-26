import { createClient } from "redis";

const redisClient = createClient();

await redisClient.connect();
console.log("Connected to Redis");

async function setKV(key, value) {
  await redisClient.set(key, value);
}

async function getValue(key) {
  return await redisClient.get(key);
}

async function deleteKey(key) {
  await redisClient.del(key);
}

async function writeBuffer(operation, payload) {
  const id = await redisClient.xAdd("dbStream", "*", {
    operation,
    payload: JSON.stringify(payload),
  });

  if (!id) throw new Error("Failed to write to buffer");

  return id;
}

async function ackHelper(messageIds) {
  if (messageIds.length === 0) return;

  await redisClient.xAck("dbStream", "db-writer", messageIds);
}

async function readBuffer(streamName) {
  const result = await redisClient.xReadGroup(
    "db-writer",
    "worker-1",
    {
      key: streamName,
      id: ">",
    },
    {
      COUNT: 100,
      BLOCK: 10_000,
    },
  );

  if (!result) return null;

  return result;
}

export {
  redisClient,
  setKV,
  getValue,
  deleteKey,
  writeBuffer,
  ackHelper,
  readBuffer,
};
