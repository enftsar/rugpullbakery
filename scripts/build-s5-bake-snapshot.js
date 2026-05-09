const fs = require("fs");
const path = require("path");

const EXPLORER = "https://api.etherscan.io/v2/api";
const EKEY = process.env.ETHERSCAN_API_KEY || "WX9V4F65TXJNZYESEI4NWAFFRNID61KIUT";
const CHAIN_ID = 2741;
const BAKE_TO = "0xfeb79a841d69c08afcdc7b2beec8a6fbbe46c455";
const START_TS = 1778252400;
const CUTOFF_TS = 1778288400;
const OUT_FILE = path.resolve(__dirname, "../data/s5-bake-snapshot.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function getBlockByTime(timestamp) {
  const url = `${EXPLORER}?chainid=${CHAIN_ID}&module=block&action=getblocknobytime&timestamp=${timestamp}&closest=after&apikey=${EKEY}`;
  const data = await fetchJson(url);
  const block = Number(data && data.result);
  if (!(block > 0)) throw new Error(`Could not resolve block for ${timestamp}`);
  return block;
}

async function buildSnapshot() {
  const startBlock = await getBlockByTime(START_TS);
  const cutoffBlock = await getBlockByTime(CUTOFF_TS);
  const players = {};
  const seen = new Set();
  let endBlock = cutoffBlock;
  let batches = 0;
  let retries = 0;
  let earliestTimestamp = null;
  let latestTimestamp = null;

  const maxBatches = Number(process.env.MAX_BATCHES || 1200);
  while (endBlock >= startBlock && batches < maxBatches) {
    const url = `${EXPLORER}?chainid=${CHAIN_ID}&module=account&action=txlist&address=${BAKE_TO}&sort=desc&startblock=${startBlock}&endblock=${endBlock}&page=1&offset=1000&apikey=${EKEY}`;
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
      if (ts < START_TS || ts > CUTOFF_TS) continue;
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

    if (rows.length < 1000 || oldestBlock <= startBlock) break;
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
    cutoffLabel: "2026-05-09 04:00 TRT",
    startBlock,
    cutoffBlock,
    generatedAt: new Date().toISOString(),
    batches,
    retries,
    complete: endBlock < startBlock || earliestTimestamp <= START_TS,
    totalPlayers: Object.keys(players).length,
    totalBakeTx: Object.values(players).reduce((sum, player) => sum + player.bakeTx, 0),
    earliestTimestamp,
    latestTimestamp,
    players
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(snapshot, null, 2));
  console.log(`Wrote ${OUT_FILE}`);
  console.log(`Players: ${snapshot.totalPlayers}, Bake TX: ${snapshot.totalBakeTx}`);
}

buildSnapshot().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
