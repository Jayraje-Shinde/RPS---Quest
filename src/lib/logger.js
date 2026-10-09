// src/lib/logger.js
// Async, batched, droppable logger + per-window metrics.
// Design rules: (1) never block the event loop on disk, (2) never queue unbounded,
// (3) per-request logging is SAMPLED; the real signal is the periodic summary line.
import fs from "node:fs";
import path from "node:path";
import { createHistogram, monitorEventLoopDelay } from "node:perf_hooks";

const LOG_FILE = process.env.LOG_FILE ?? "./logs/app.log";
const FLUSH_MS = Number(process.env.LOG_FLUSH_MS ?? 1000);
const SUMMARY_MS = Number(process.env.LOG_SUMMARY_MS ?? 5000);
const SAMPLE_RATE = Number(process.env.LOG_SAMPLE ?? 0.01); // 0 = summaries/errors only, 1 = every request
const MAX_LINES = 500; // flush early at this many buffered lines
const MAX_PENDING_BYTES = 8 * 1024 * 1024; // disk can't keep up -> drop, don't queue forever

fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
const out = fs.createWriteStream(LOG_FILE, { flags: "a" });
out.on("error", () => {}); // logging must never crash the app

let lines = [];
let dropped = 0;

function flush() {
  if (lines.length === 0) return;
  if (out.writableLength > MAX_PENDING_BYTES) {
    dropped += lines.length;
    lines = [];
    return;
  }
  out.write(lines.join("")); // one async write for many lines
  lines = [];
}
setInterval(flush, FLUSH_MS).unref();
process.on("exit", () => {
  if (lines.length) fs.appendFileSync(LOG_FILE, lines.join(""));
});

export function log(level, msg, fields = {}) {
  lines.push(
    JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }) +
      "\n",
  );
  if (lines.length >= MAX_LINES) flush();
}

// ---- metrics window ----
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();

const newWindow = () => ({
  start: Date.now(),
  count: 0,
  errors: 0,
  hist: createHistogram(),
  routes: new Map(),
});
let win = newWindow();

const normalize = (url) => url.split("?")[0].replace(/\/\d+/g, "/:id");

// Use as: server.beforeEach(trackRequests)  (cpeak middleware signature: req, res, next -- verify in cpeak docs)
export function trackRequests(req, res, next) {
  const t0 = process.hrtime.bigint();
  res.on("finish", () => {
    const us = Math.max(1, Number((process.hrtime.bigint() - t0) / 1000n));
    win.count++;
    win.hist.record(us);
    if (res.statusCode >= 500) win.errors++;
    const route = `${req.method} ${normalize(req.url)}`;
    win.routes.set(route, (win.routes.get(route) ?? 0) + 1);
    if (res.statusCode >= 500 || Math.random() < SAMPLE_RATE) {
      log(res.statusCode >= 500 ? "error" : "info", "req", {
        route,
        status: res.statusCode,
        us,
      });
    }
  });
  next();
}

setInterval(() => {
  const w = win;
  win = newWindow();
  const secs = (Date.now() - w.start) / 1000;
  const mem = process.memoryUsage();
  log("summary", "window", {
    rps: Math.round(w.count / secs),
    errors: w.errors,
    p50_ms: w.hist.percentile(50) / 1000,
    p95_ms: w.hist.percentile(95) / 1000,
    p99_ms: w.hist.percentile(99) / 1000,
    loop_p99_ms: loop.percentile(99) / 1e6, // high => Node itself is CPU-bound
    loop_max_ms: loop.max / 1e6,
    rss_mb: Math.round(mem.rss / 1048576),
    dropped_logs: dropped,
    routes: Object.fromEntries(w.routes),
  });
  loop.reset();
}, SUMMARY_MS).unref();
