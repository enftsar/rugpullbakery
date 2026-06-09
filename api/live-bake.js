const RPC_URL = "https://api.mainnet.abs.xyz";
const BAKE_TO = "0x30b49389d5271712b7e539a690b2f7b92afa3c31";
const BAKE_EVENT_TOPIC = "0xdfb2307530b804c690e75bb4df897c4d1ebb5e3e1187ce9e25eb7ed674c66db6";
const SNAPSHOT_CUTOFF_TS = 1781042400;
const SNAPSHOT_CUTOFF_BLOCK = 68925300;
const LOG_BLOCK_WINDOW = 5000;
const RECEIPT_BATCH_SIZE = 100;
const MAX_LOG_WINDOWS = 400;
const MAX_RECEIPTS = 50000;

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function isWallet(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

function hexNumber(value) {
  return `0x${Math.max(0, Number(value) || 0).toString(16)}`;
}

function topicAddress(address) {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

async function rpc(payload, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`rpc_http_${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) && data && data.error) {
      throw new Error(`rpc_${data.error.code || "error"}:${data.error.message || "unknown"}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function latestBlock() {
  const data = await rpc({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
  const block = Number.parseInt(data && data.result, 16);
  if (!(block > 0)) throw new Error("latest_block_unavailable");
  return block;
}

async function getBakeLogs(address, endBlock) {
  const logs = [];
  const seen = new Set();
  let fromBlock = SNAPSHOT_CUTOFF_BLOCK + 1;
  let windows = 0;

  while (fromBlock <= endBlock && windows < MAX_LOG_WINDOWS) {
    const toBlock = Math.min(fromBlock + LOG_BLOCK_WINDOW - 1, endBlock);
    const data = await rpc({
      jsonrpc: "2.0",
      id: windows + 1,
      method: "eth_getLogs",
      params: [{
        fromBlock: hexNumber(fromBlock),
        toBlock: hexNumber(toBlock),
        address: BAKE_TO,
        topics: [BAKE_EVENT_TOPIC, topicAddress(address)]
      }]
    });
    const rows = Array.isArray(data && data.result) ? data.result : [];
    for (const log of rows) {
      const hash = String(log.transactionHash || "").toLowerCase();
      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      logs.push(log);
      if (logs.length > MAX_RECEIPTS) throw new Error("live_tx_limit");
    }
    fromBlock = toBlock + 1;
    windows += 1;
  }

  if (fromBlock <= endBlock) throw new Error("live_block_window_limit");
  return logs;
}

async function totalGasEth(logs) {
  let gasWei = 0n;
  for (let start = 0; start < logs.length; start += RECEIPT_BATCH_SIZE) {
    const slice = logs.slice(start, start + RECEIPT_BATCH_SIZE);
    const payload = slice.map((log, index) => ({
      jsonrpc: "2.0",
      id: start + index + 1,
      method: "eth_getTransactionReceipt",
      params: [log.transactionHash]
    }));
    const data = await rpc(payload, 25000);
    if (!Array.isArray(data)) throw new Error("receipt_batch_invalid");
    const byId = new Map(data.map((item) => [Number(item.id), item]));
    for (let index = 0; index < slice.length; index += 1) {
      const item = byId.get(start + index + 1);
      if (!item || item.error || !item.result) throw new Error("receipt_unavailable");
      const receipt = item.result;
      if (receipt.status === "0x0") continue;
      gasWei += BigInt(receipt.gasUsed || "0x0") * BigInt(receipt.effectiveGasPrice || "0x0");
    }
  }
  return Number(gasWei) / 1e18;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const address = String(first(req.query.address) || "").toLowerCase();
  if (!isWallet(address)) return res.status(400).json({ error: "invalid_address" });

  const requestedFromTs = Number(first(req.query.fromTs)) || SNAPSHOT_CUTOFF_TS + 1;
  if (requestedFromTs < SNAPSHOT_CUTOFF_TS + 1) {
    return res.status(400).json({ error: "range_precedes_snapshot" });
  }

  try {
    const endBlock = await latestBlock();
    const logs = await getBakeLogs(address, endBlock);
    const gasEth = await totalGasEth(logs);
    const scanToTs = Math.floor(Date.now() / 1000);

    res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=40");
    return res.status(200).json({
      ok: true,
      source: "abstract-rpc",
      address,
      contract: BAKE_TO,
      fromTs: SNAPSHOT_CUTOFF_TS + 1,
      toTs: scanToTs,
      startBlock: SNAPSHOT_CUTOFF_BLOCK + 1,
      endBlock,
      bakeTx: logs.length,
      gasEth,
      incomplete: false
    });
  } catch (error) {
    const timeout = error && error.name === "AbortError";
    return res.status(timeout ? 504 : 502).json({
      error: timeout ? "abstract_rpc_timeout" : "live_bake_scan_failed",
      detail: String(error && error.message || "unknown").slice(0, 240)
    });
  }
};
