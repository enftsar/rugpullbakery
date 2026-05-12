const fs = require("fs");
const path = require("path");

const EXPLORER = "https://api.etherscan.io/v2/api";
const EKEY = process.env.ETHERSCAN_API_KEY || "WX9V4F65TXJNZYESEI4NWAFFRNID61KIUT";
const CHAIN_ID = 2741;
const BAKE_TO = "0xfeb79a841d69c08afcdc7b2beec8a6fbbe46c455";
const START_TS = 1778252400;
const CUTOFF_TS = 1778625900;
const OUT_FILE = path.resolve(__dirname, "../data/s5-bake-snapshot.json");
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 10000);

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

async function getBlockByTime(timestamp) {
  const url = `${EXPLORER}?chainid=${CHAIN_ID}&module=block&action=getblocknobytime&timestamp=${timestamp}&closest=after&apikey=${EKEY}`;
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
  const existing = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, "utf8")) : null;
  const canExtend = existing &&
    existing.complete === true &&
    existing.startTs === START_TS &&
    existing.cutoffTs < CUTOFF_TS &&
    String(existing.contract || "").toLowerCase() === BAKE_TO;
  const startBlock = canExtend && existing.startBlock ? Number(existing.startBlock) : await getBlockByTime(START_TS);
  const scanStartTs = canExtend ? Number(existing.cutoffTs) + 1 : START_TS;
  const scanStartBlock = canExtend && existing.cutoffBlock ? Number(existing.cutoffBlock) + 1 : startBlock;
  const cutoffBlock = await getBlockByTime(CUTOFF_TS);
  const players = canExtend ? { ...existing.players } : {};
  const seen = new Set();
  let endBlock = cutoffBlock;
  let batches = 0;
  let retries = 0;
  let earliestTimestamp = null;
  let latestTimestamp = null;

  const maxBatches = Number(process.env.MAX_BATCHES || 1200);
  while (endBlock >= scanStartBlock && batches < maxBatches) {
    const url = `${EXPLORER}?chainid=${CHAIN_ID}&module=account&action=txlist&address=${BAKE_TO}&sort=desc&startblock=${scanStartBlock}&endblock=${endBlock}&page=1&offset=${PAGE_SIZE}&apikey=${EKEY}`;
    const data = await fetchJson(url);
    const rows = Array.isArray(data.result) ? data.result : [];
    if (data.status !== "1" || !rows.length) {
      const message = `${data.message || ""} ${typeof data.result === "string" ? data.result : ""}`.toLowerCase();
      if (message.includes("rate limit") || message.includes("max calls")) {
        retries += 1;
        await sleep(1200);
        continue;
      }
      console.log(`Stopped at endBlock=${endBlock}: ${data.message || "empty"} ${typeof data.result === "string" ? data.result : ""}`);
      break;
    }
    batches += 1;

    let oldestBlock = Number.MAX_SAFE_INTEGER;
    for (const tx of rows) {
      const block = Number(tx.blockNumber || 0);
      const ts = Number(tx.timeStamp || 0);
      if (block > 0 && block < oldestBlock) oldestBlock = block;
      if (ts > 0 && (!earliestTimestamp || ts < earliestTimestamp)) earliestTimestamp = ts;
      if (ts > 0 && (!latestTimestamp || ts > latestTimestamp)) latestTimestamp = ts;
      if (ts < scanStartTs || ts > CUTOFF_TS) continue;
      if (tx.isError === "1" || tx.txreceipt_status === "0") continue;
      const to = String(tx.to || "").toLowerCase();
      const from = String(tx.from || "").toLowerCase();
      const hash = String(tx.hash || "").toLowerCase();
      if (to !== BAKE_TO || !from || !hash || seen.has(hash)) continue;
      seen.add(hash);

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

    if (rows.length < PAGE_SIZE || oldestBlock <= scanStartBlock) break;
    endBlock = oldestBlock - 1;
    await sleep(120);
  }

  const snapshot = {
    season: 5,
    contract: BAKE_TO,
    chainId: CHAIN_ID,
    timezone: "Europe/Istanbul",
    startTs: START_TS,
    cutoffTs: CUTOFF_TS,
    cutoffLabel: "2026-05-13 01:45 TRT",
    startBlock,
    cutoffBlock,
    generatedAt: new Date().toISOString(),
    batches,
    retries,
    extendedFromCutoffTs: canExtend ? existing.cutoffTs : null,
    complete: endBlock < scanStartBlock || earliestTimestamp <= scanStartTs,
    totalPlayers: Object.keys(players).length,
    totalBakeTx: Object.values(players).reduce((sum, player) => sum + player.bakeTx, 0),
    earliestTimestamp,
    latestTimestamp,
    players
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(`${OUT_FILE}.tmp`, JSON.stringify(snapshot, null, 2));
  fs.renameSync(`${OUT_FILE}.tmp`, OUT_FILE);
  console.log(`Wrote ${OUT_FILE}`);
  console.log(`Players: ${snapshot.totalPlayers}, Bake TX: ${snapshot.totalBakeTx}`);
}

buildSnapshot().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

