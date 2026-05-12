const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_FILE = path.join(ROOT, "data", "s5-bake-snapshot.json");
const OUT_JSON = path.join(ROOT, "reports", "top-roi-chefs.json");
const OUT_CSV = path.join(ROOT, "reports", "top-roi-chefs.csv");
const TRPC = "https://www.rugpullbakery.com/api/trpc";
const HOME_URL = "https://www.rugpullbakery.com/";
const QUALIFIED_BAKERY_COUNT = 10;
const KNOWN_NAMES = {
  "0xdfb3296753e8a91c7d2e47da0e3d677cd20c9729": "Misix",
  "0x6968c93abfdf34e9ec6b2609501cfeb465d6532a": "FlooKi",
  "0xb5748a472adfa371244cdc5a0a13189410cf8097": "Azin0",
  "0x164cb4eacf03e4635f7c040d28e2fb2f129bb462": "TheVs",
  "0x808d581031c8a39f861df563b35e2c8f548f7b59": "LeandreF",
  "0xe134e9dbf5cc2f6a17026fd5b24135dff946b52f": "Husak",
  "0xd564d3f5e1322ce77c2192ac28b7e74d86b0a231": "HakanWinners",
  "0x34b04d588e29334180a1052add4c219356759e85": "Tonerre",
  "0xbb7bcd4d6b53a92105f6eed1c7b176e31544623a": "Sarah69"
};

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
async function fetchJson(url, tries = 6){
  let last;
  for(let i=0;i<tries;i++){
    try{
      const res = await fetch(url, { headers: { "accept": "application/json,text/html,*/*", "user-agent": "Mozilla/5.0" } });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get("content-type") || "";
      if(ct.includes("application/json")) return await res.json();
      const text = await res.text();
      try { return JSON.parse(text); } catch { return text; }
    }catch(e){ last=e; await sleep(1000 + i*500); }
  }
  throw last;
}
function trpcUrl(proc, input){
  const payload = JSON.stringify({0:{json:input === undefined ? null : input}});
  return `${TRPC}/${proc}?batch=1&input=${encodeURIComponent(payload)}`;
}
function extr(payload){
  const arr = Array.isArray(payload) ? payload : [payload];
  return arr[0] && arr[0].result && arr[0].result.data && arr[0].result.data.json;
}
async function tRPC(proc, input){ return extr(await fetchJson(trpcUrl(proc, input))); }
function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function readBakeryScore(b){ return toNum(b.score ?? b.effectiveTxCount ?? b.txCount ?? b.bakedTxCount); }
function weiToEth(v){ return Number(v || 0) / 1e18; }
function readEthUsdFromHtml(html){
  const m = String(html).match(/ethUsd[^0-9]{0,80}([0-9]+(?:\.[0-9]+)?)/i) || String(html).match(/ethereum[^0-9]{0,80}([0-9]+(?:\.[0-9]+)?)/i);
  return m ? Number(m[1]) : null;
}
async function getEthUsdFallback(){
  const html = await fetchJson(HOME_URL);
  const parsed = readEthUsdFromHtml(html);
  if(parsed) return parsed;
  return 2339.44;
}
async function fetchAllBakeries(){
  let all = [], cursor = null;
  for(let page=0; page<20; page++){
    const input = { limit: 100, tierId: 1 };
    if(cursor) input.cursor = cursor;
    const data = await tRPC("leaderboard.getTopBakeries", input);
    const items = data && data.items ? data.items : (Array.isArray(data) ? data : []);
    all = all.concat(items);
    const next = data && data.nextCursor;
    if(!next || !items.length || items.length < 100) break;
    cursor = { id: next.id };
    if(next.txCount != null) cursor.txCount = String(Math.floor(Number(next.txCount)));
  }
  return all;
}
async function fetchAllTopChefs(){
  let all = [], cursor = null;
  for(let page=0; page<80; page++){
    const input = { limit: 100, tierId: 1 };
    if(cursor) input.cursor = cursor;
    const data = await tRPC("leaderboard.getTopChefs", input);
    const items = data && data.items ? data.items : (Array.isArray(data) ? data : []);
    all = all.concat(items);
    const next = data && data.nextCursor;
    if(!next || !items.length || items.length < 100) break;
    cursor = {};
    if(next.txCount != null) cursor.txCount = String(Math.floor(Number(next.txCount)));
    if(next.address != null) cursor.address = String(next.address);
    await sleep(80);
  }
  return all;
}
function csvEscape(v){
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function main(){
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
  if(!snapshot.complete) throw new Error("Snapshot is not complete");
  const activeSeasonPayload = await tRPC("leaderboard.getActiveSeason", undefined);
  const season = Array.isArray(activeSeasonPayload) ? activeSeasonPayload[0] : activeSeasonPayload;
  const poolEth = season && season.prizePool ? weiToEth(season.prizePool) : 0;
  const ethUsd = await getEthUsdFallback();
  const bakeries = await fetchAllBakeries();
  const qualified = bakeries.slice(0, QUALIFIED_BAKERY_COUNT);
  const qualifiedIds = new Set(qualified.map(b => Number(b.id ?? b.bakeryId)));
  const bakeryById = new Map(qualified.map((b, i) => [Number(b.id ?? b.bakeryId), { bakery: b, rank: i + 1 }]));
  const totalTop10BakeryScore = qualified.reduce((sum, b) => sum + readBakeryScore(b), 0);
  const rows = [];
  const chefs = await fetchAllTopChefs();
  const topChefRows = chefs.length;
  for(const chef of chefs){
      const bakeryId = Number(chef.bakeryId);
      if(!qualifiedIds.has(bakeryId)) continue;
      const match = bakeryById.get(bakeryId);
      const bakery = match.bakery;
      const bakeryRank = match.rank;
      const address = String(chef.address || "").toLowerCase();
      const snap = snapshot.players && snapshot.players[address];
      if(!address || !snap) continue;
      const chefScore = toNum(chef.score ?? chef.effectiveTxCount ?? chef.txCount ?? chef.bakedTxCount);
      if(!chefScore || !totalTop10BakeryScore) continue;
      const rewardEth = poolEth * (chefScore / totalTop10BakeryScore);
      const gasEth = toNum(snap.gasEth);
      const netEth = rewardEth - gasEth;
      rows.push({
        address,
        bakeryId,
        bakeryName: bakery.name || chef.bakeryName || `Bakery #${bakeryRank}`,
        bakeryRank,
        chefScore,
        topChefTxCount: toNum(chef.txCount),
        snapshotBakeTx: toNum(snap.bakeTx),
        rewardEth,
        gasEth,
        netEth,
        rewardUsd: rewardEth * ethUsd,
        gasUsd: gasEth * ethUsd,
        netUsd: netEth * ethUsd,
        roiPct: gasEth > 0 ? (netEth / gasEth) * 100 : null,
        name: KNOWN_NAMES[address] || chef.name || chef.displayName || chef.username || chef.portalName || ""
      });
  }
  console.log(`Fetched global top chefs: ${topChefRows}`);
  rows.sort((a,b) => b.netUsd - a.netUsd);
  const top10 = rows.slice(0,10).map((row, idx) => ({ rank: idx + 1, ...row }));
  const report = {
    generatedAt: new Date().toISOString(),
    snapshot: {
      cutoffTs: snapshot.cutoffTs,
      cutoffLabel: snapshot.cutoffLabel,
      totalPlayers: snapshot.totalPlayers,
      totalBakeTx: snapshot.totalBakeTx
    },
    inputs: {
      poolEth,
      ethUsd,
      totalTop10BakeryScore,
      topChefRows,
      qualifiedSnapshotChefRows: rows.length
    },
    top10
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  const headers = ["rank","name","address","bakeryName","bakeryRank","snapshotBakeTx","rewardUsd","gasUsd","netUsd","roiPct","rewardEth","gasEth","netEth"];
  const csv = [headers.join(",")].concat(top10.map(row => headers.map(h => csvEscape(row[h])).join(","))).join("\n") + "\n";
  fs.writeFileSync(OUT_CSV, csv);
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_CSV}`);
  console.log(`Top rows: ${top10.length}, matched chefs: ${rows.length}, top chef rows: ${topChefRows}`);
}
main().catch(err => { console.error(err); process.exitCode = 1; });
