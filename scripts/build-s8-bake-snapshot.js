const fs = require("fs");
const path = require("path");

const envFile = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const EXPLORER = "https://api.etherscan.io/v2/api";
const EKEY = process.env.ETHERSCAN_API_KEY || "";
const CHAIN_ID = 2741;
const BAKE_TO = "0x30b49389d5271712b7e539a690b2f7b92afa3c31";
const START_TS = 1780693200;
const SEASON_END_TS = 1781298000;
const CUTOFF_TS = Math.min(
  Number(process.env.CUTOFF_TS || Math.floor(Date.now() / 1000)),
  SEASON_END_TS
);
const CUTOFF_LABEL = process.env.CUTOFF_LABEL ||
  `${new Date((CUTOFF_TS + 10800) * 1000).toISOString().replace("T", " ").slice(0, 19)} TRT`;
const OUT_FILE = path.resolve(__dirname, "../data/s8-bake-snapshot.json");
const CHECKPOINT_FILE = `${OUT_FILE}.checkpoint`;
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 10000);
const BLOCK_WINDOW = Number(process.env.BLOCK_WINDOW || 50000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
      await sleep(1200 + attempt * 500);
    }
  }
  throw lastError;
}

async function getBlockByTime(timestamp, closest = "after") {
  const url = `${EXPLORER}?chainid=${CHAIN_ID}&module=block&action=getblocknobytime&timestamp=${timestamp}&closest=${closest}&apikey=${EKEY}`;
  let last = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const data = await fetchJson(url);
    last = data;
    const block = Number(data && data.result);
    if (block > 0) return block;
    await sleep(1200);
  }
  throw new Error(`Could not resolve block for ${timestamp}: ${JSON.stringify(last)}`);
}

async function buildSnapshot() {
  if (!EKEY) throw new Error("ETHERSCAN_API_KEY is required.");
  if (!Number.isFinite(CUTOFF_TS) || CUTOFF_TS < START_TS) {
    throw new Error(`CUTOFF_TS must be between ${START_TS} and ${SEASON_END_TS}.`);
  }
  const existing = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, "utf8")) : null;
  const checkpoint = fs.existsSync(CHECKPOINT_FILE) ? JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8")) : null;
  const canExtend = existing &&
    existing.complete === true &&
    existing.startTs === START_TS &&
    existing.cutoffTs < CUTOFF_TS &&
    String(existing.contract || "").toLowerCase() === BAKE_TO;
  const canResume = checkpoint &&
    checkpoint.season === 8 &&
    checkpoint.startTs === START_TS &&
    checkpoint.cutoffTs === CUTOFF_TS &&
    String(checkpoint.contract || "").toLowerCase() === BAKE_TO;
  const startBlock = canResume
    ? Number(checkpoint.startBlock)
    : canExtend && existing.startBlock
      ? Number(existing.startBlock)
      : await getBlockByTime(START_TS);
  const scanStartTs = canExtend ? Number(existing.cutoffTs) + 1 : START_TS;
  const scanStartBlock = canExtend && existing.cutoffBlock ? Number(existing.cutoffBlock) + 1 : startBlock;
  const cutoffBlock = canResume ? Number(checkpoint.cutoffBlock) : await getBlockByTime(CUTOFF_TS, "before");
  const players = canResume ? { ...checkpoint.players } : canExtend ? { ...existing.players } : {};
  const seen = new Set();
  let endBlock = canResume ? Number(checkpoint.nextEndBlock) : cutoffBlock;
  let batches = canResume ? Number(checkpoint.batches || 0) : 0;
  let retries = canResume ? Number(checkpoint.retries || 0) : 0;
  let earliestTimestamp = canResume ? checkpoint.earliestTimestamp : null;
  let latestTimestamp = canResume ? checkpoint.latestTimestamp : null;
  let reachedScanStart = false;

  const maxBatches = Number(process.env.MAX_BATCHES || 1200);
  function saveCheckpoint(nextEndBlock) {
    const state = {
      season: 8,
      contract: BAKE_TO,
      startTs: START_TS,
      cutoffTs: CUTOFF_TS,
      startBlock,
      cutoffBlock,
      nextEndBlock,
      batches,
      retries,
      earliestTimestamp,
      latestTimestamp,
      players
    };
    fs.mkdirSync(path.dirname(CHECKPOINT_FILE), { recursive: true });
    fs.writeFileSync(`${CHECKPOINT_FILE}.tmp`, JSON.stringify(state));
    fs.renameSync(`${CHECKPOINT_FILE}.tmp`, CHECKPOINT_FILE);
  }

  while (endBlock >= scanStartBlock && batches < maxBatches) {
    const queryStartBlock = Math.max(scanStartBlock, endBlock - BLOCK_WINDOW + 1);
    const url = `${EXPLORER}?chainid=${CHAIN_ID}&module=account&action=txlist&address=${BAKE_TO}&sort=desc&startblock=${queryStartBlock}&endblock=${endBlock}&page=1&offset=${PAGE_SIZE}&apikey=${EKEY}`;
    const data = await fetchJson(url);
    const rows = Array.isArray(data.result) ? data.result : [];
    if (data.status !== "1" || !rows.length) {
      const message = `${data.message || ""} ${typeof data.result === "string" ? data.result : ""}`.toLowerCase();
      if (message.includes("rate limit") || message.includes("max calls")) {
        retries += 1;
        if (retries % 25 === 0) saveCheckpoint(endBlock);
        await sleep(1200);
        continue;
      }
      if (message.includes("query timeout") || message.includes("smaller result")) {
        saveCheckpoint(endBlock);
        throw new Error(`Explorer query timeout at endBlock=${endBlock}; checkpoint saved.`);
      }
      console.log(`Stopped at endBlock=${endBlock}: ${data.message || "empty"} ${typeof data.result === "string" ? data.result : ""}`);
      reachedScanStart = true;
      break;
    }
    batches += 1;
    if (batches % 25 === 0) {
      console.log(`Scanned ${batches} batches, endBlock=${endBlock}, players=${Object.keys(players).length}`);
    }

    let oldestBlock = Number.MAX_SAFE_INTEGER;
    for (const tx of rows) {
      const block = Number(tx.blockNumber || 0);
      const ts = Number(tx.timeStamp || 0);
      if (block > 0 && block < oldestBlock) oldestBlock = block;
      if (ts < scanStartTs || ts > CUTOFF_TS) continue;
      if (tx.isError === "1" || tx.txreceipt_status === "0") continue;
      const to = String(tx.to || "").toLowerCase();
      const from = String(tx.from || "").toLowerCase();
      const hash = String(tx.hash || "").toLowerCase();
      if (to !== BAKE_TO || !from || !hash || seen.has(hash)) continue;
      seen.add(hash);
      if (ts > 0 && (!earliestTimestamp || ts < earliestTimestamp)) earliestTimestamp = ts;
      if (ts > 0 && (!latestTimestamp || ts > latestTimestamp)) latestTimestamp = ts;

      if (!players[from]) {
        players[from] = { bakeTx: 0, gasEth: 0, firstTs: ts, lastTs: ts };
      }
      const gasUsed = Number(tx.gasUsed || 0);
      const gasPrice = Number(tx.gasPrice || 0);
      players[from].bakeTx += 1;
      if (gasUsed && gasPrice) players[from].gasEth += (gasUsed * gasPrice) / 1e18;
      if (ts < players[from].firstTs) players[from].firstTs = ts;
      if (ts > players[from].lastTs) players[from].lastTs = ts;
    }

    if (rows.length < PAGE_SIZE || oldestBlock <= queryStartBlock) {
      if (queryStartBlock <= scanStartBlock) {
        reachedScanStart = true;
        break;
      }
      endBlock = queryStartBlock - 1;
      if (batches % 10 === 0) saveCheckpoint(endBlock);
      await sleep(120);
      continue;
    }
    endBlock = oldestBlock - 1;
    if (batches % 10 === 0) saveCheckpoint(endBlock);
    await sleep(120);
  }

  const playerRows = Object.values(players);
  const firstTimestamps = playerRows.map((player) => Number(player.firstTs) || 0).filter(Boolean);
  const lastTimestamps = playerRows.map((player) => Number(player.lastTs) || 0).filter(Boolean);
  const snapshot = {
    season: 8,
    contract: BAKE_TO,
    chainId: CHAIN_ID,
    timezone: "Europe/Istanbul",
    startTs: START_TS,
    cutoffTs: CUTOFF_TS,
    cutoffLabel: CUTOFF_LABEL,
    startBlock,
    cutoffBlock,
    generatedAt: new Date().toISOString(),
    batches,
    retries,
    extendedFromCutoffTs: canExtend ? existing.cutoffTs : null,
    complete: reachedScanStart || endBlock < scanStartBlock || earliestTimestamp <= scanStartTs,
    totalPlayers: Object.keys(players).length,
    totalBakeTx: playerRows.reduce((sum, player) => sum + player.bakeTx, 0),
    earliestTimestamp: firstTimestamps.length ? Math.min(...firstTimestamps) : earliestTimestamp,
    latestTimestamp: lastTimestamps.length ? Math.max(...lastTimestamps) : latestTimestamp,
    players
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(`${OUT_FILE}.tmp`, JSON.stringify(snapshot, null, 2));
  fs.renameSync(`${OUT_FILE}.tmp`, OUT_FILE);
  if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);
  console.log(`Wrote ${OUT_FILE}`);
  console.log(`Players: ${snapshot.totalPlayers}, Bake TX: ${snapshot.totalBakeTx}`);
}

buildSnapshot().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
