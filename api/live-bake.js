const EXPLORER = "https://api.etherscan.io/v2/api";
const CHAIN_ID = 2741;
const BAKE_TO = "0x30b49389d5271712b7e539a690b2f7b92afa3c31";
const SNAPSHOT_CUTOFF_TS = 1781042400;
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function isWallet(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

async function explorerRequest(params, apiKey) {
  const url = new URL(EXPLORER);
  url.searchParams.set("chainid", String(CHAIN_ID));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("apikey", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error(`etherscan_http_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function blockAt(timestamp, closest, apiKey) {
  const data = await explorerRequest({
    module: "block",
    action: "getblocknobytime",
    timestamp,
    closest
  }, apiKey);
  const block = Number(data && data.result);
  if (!(block > 0)) {
    throw new Error(`block_lookup_failed:${data && data.message || "unknown"}`);
  }
  return block;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "etherscan_api_key_missing" });
  }

  const address = String(first(req.query.address) || "").toLowerCase();
  if (!isWallet(address)) {
    return res.status(400).json({ error: "invalid_address" });
  }

  const now = Math.floor(Date.now() / 1000);
  const fromTs = Math.max(Number(first(req.query.fromTs)) || SNAPSHOT_CUTOFF_TS + 1, SNAPSHOT_CUTOFF_TS + 1);
  const toTs = Math.min(Number(first(req.query.toTs)) || now, now);
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs > toTs) {
    return res.status(400).json({ error: "invalid_time_range" });
  }

  try {
    const [startBlock, endBlock] = await Promise.all([
      blockAt(fromTs, "after", apiKey),
      blockAt(toTs, "before", apiKey)
    ]);

    let bakeTx = 0;
    let gasEth = 0;
    let page = 1;
    let incomplete = false;
    const seen = new Set();

    while (page <= MAX_PAGES) {
      const data = await explorerRequest({
        module: "account",
        action: "txlist",
        address,
        startblock: startBlock,
        endblock: endBlock,
        page,
        offset: PAGE_SIZE,
        sort: "asc"
      }, apiKey);

      const rows = Array.isArray(data && data.result) ? data.result : [];
      if (!rows.length) {
        const message = `${data && data.message || ""} ${typeof (data && data.result) === "string" ? data.result : ""}`;
        if (data && data.status === "0" && !/no transactions found/i.test(message)) {
          throw new Error(`etherscan_response:${message.trim() || "unknown"}`);
        }
        break;
      }

      for (const tx of rows) {
        const timestamp = Number(tx.timeStamp || 0);
        const hash = String(tx.hash || "").toLowerCase();
        if (timestamp < fromTs || timestamp > toTs) continue;
        if (tx.isError === "1" || tx.txreceipt_status === "0") continue;
        if (String(tx.from || "").toLowerCase() !== address) continue;
        if (String(tx.to || "").toLowerCase() !== BAKE_TO) continue;
        if (hash && seen.has(hash)) continue;
        if (hash) seen.add(hash);

        bakeTx += 1;
        const gasUsed = Number(tx.gasUsed || 0);
        const gasPrice = Number(tx.gasPrice || 0);
        if (gasUsed > 0 && gasPrice > 0) gasEth += (gasUsed * gasPrice) / 1e18;
      }

      if (rows.length < PAGE_SIZE) break;
      page += 1;
    }

    if (page > MAX_PAGES) incomplete = true;
    res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=40");
    return res.status(200).json({
      ok: true,
      address,
      contract: BAKE_TO,
      fromTs,
      toTs,
      startBlock,
      endBlock,
      bakeTx,
      gasEth,
      incomplete
    });
  } catch (error) {
    const timeout = error && error.name === "AbortError";
    return res.status(timeout ? 504 : 502).json({
      error: timeout ? "etherscan_timeout" : "live_bake_scan_failed",
      detail: String(error && error.message || "unknown").slice(0, 240)
    });
  }
};
