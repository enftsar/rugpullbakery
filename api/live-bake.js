const BAKE_TO = "0x30b49389d5271712b7e539a690b2f7b92afa3c31";
const SNAPSHOT_CUTOFF_TS = 1781298000;
const SNAPSHOT_CUTOFF_BLOCK = 69826412;

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function isWallet(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const address = String(first(req.query.address) || "").toLowerCase();
  if (!isWallet(address)) return res.status(400).json({ error: "invalid_address" });

  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  return res.status(200).json({
    ok: true,
    source: "final-snapshot",
    address,
    contract: BAKE_TO,
    fromTs: SNAPSHOT_CUTOFF_TS + 1,
    toTs: SNAPSHOT_CUTOFF_TS,
    startBlock: SNAPSHOT_CUTOFF_BLOCK + 1,
    endBlock: SNAPSHOT_CUTOFF_BLOCK,
    bakeTx: 0,
    gasEth: 0,
    incomplete: false,
    seasonComplete: true
  });
};
