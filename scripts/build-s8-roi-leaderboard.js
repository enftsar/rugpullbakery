const fs = require("fs");
const path = require("path");

const TRPC = "https://www.rugpullbakery.com/api/trpc";
const PORTAL = "https://backend.portal.abs.xyz/api";
const SNAPSHOT_FILE = path.resolve(__dirname, "../data/s8-bake-snapshot.json");
const OUTPUT_FILE = path.resolve(__dirname, "../data/s8-roi-leaderboard.json");
const CHECKPOINT_FILE = `${OUTPUT_FILE}.checkpoint`;
const QUALIFIED_BAKERY_COUNT = 7;
const FALLBACK_ETH_USD = 2284.79;
const CONCURRENCY = Math.max(1, Number(process.env.ROI_CONCURRENCY || 5));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options, attempts = 6) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await sleep(500 + attempt * 700);
    }
  }
  throw lastError;
}

async function trpc(procedure, input) {
  const query = encodeURIComponent(JSON.stringify({ 0: { json: input } }));
  const data = await fetchJson(`${TRPC}/${procedure}?batch=1&input=${query}`);
  return data && data[0] && data[0].result && data[0].result.data
    ? data[0].result.data.json
    : null;
}

async function getBakeries() {
  const all = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const input = { limit: 100, tierId: 1 };
    if (cursor) input.cursor = cursor;
    const data = await trpc("leaderboard.getTopBakeries", input);
    const items = data && Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [];
    all.push(...items);
    if (!data || !data.nextCursor || items.length < 100) break;
    cursor = {
      id: data.nextCursor.id,
      txCount: String(Math.floor(Number(data.nextCursor.txCount || 0)))
    };
  }
  return all;
}

async function getEthUsd() {
  try {
    const data = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
    const value = Number(data && data.ethereum && data.ethereum.usd);
    if (value > 0) return value;
  } catch {}
  return FALLBACK_ETH_USD;
}

async function getProfile(address) {
  try {
    const data = await fetchJson(`${PORTAL}/user/address/${encodeURIComponent(address)}`, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 RugpullBakeryCalculator/1.0"
      }
    }, 3);
    const user = data && data.user ? data.user : data;
    const avatar = user && (user.overrideProfilePictureUrl || user.profilePictureUrl);
    return {
      name: user && (user.name || user.username) || null,
      avatar: typeof avatar === "string" ? avatar : null
    };
  } catch {
    return { name: null, avatar: null };
  }
}

function writeJsonAtomic(file, value, compact = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, compact ? 0 : 2));
  fs.renameSync(`${file}.tmp`, file);
}

function writeCheckpoint(value) {
  fs.mkdirSync(path.dirname(CHECKPOINT_FILE), { recursive: true });
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(value));
}

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
  if (!snapshot.complete || snapshot.cutoffTs !== 1781298000) {
    throw new Error("The final Season 8 snapshot is required.");
  }

  const bakeries = await getBakeries();
  if (bakeries.length < QUALIFIED_BAKERY_COUNT) throw new Error("Bakery leaderboard is incomplete.");
  const bakeryById = new Map(bakeries.map((bakery, index) => [
    String(bakery.id),
    { ...bakery, rank: index + 1 }
  ]));
  const qualified = bakeries.slice(0, QUALIFIED_BAKERY_COUNT);
  const totalQualifiedScore = qualified.reduce((sum, bakery) => sum + Number(bakery.score || 0), 0);
  if (!(totalQualifiedScore > 0)) throw new Error("Qualified bakery score is unavailable.");

  const addresses = Object.keys(snapshot.players).sort();
  const checkpoint = fs.existsSync(CHECKPOINT_FILE)
    ? JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8"))
    : { cutoffTs: snapshot.cutoffTs, players: {} };
  if (checkpoint.cutoffTs !== snapshot.cutoffTs) {
    throw new Error("ROI checkpoint belongs to a different snapshot.");
  }

  let prizePoolEth = Number(checkpoint.prizePoolEth || 0);
  let completed = Object.keys(checkpoint.players).length;

  async function processAddress(address) {
    if (checkpoint.players[address]) return;
    const [init, profile] = await Promise.all([
      trpc("leaderboard.getMyBakeryInit", { address }),
      getProfile(address)
    ]);
    const player = init && init.player || {};
    const bakery = init && (init.bakery || init.clan) || {};
    const season = init && init.season || {};
    const snapshotRow = snapshot.players[address];
    const bakeryId = String(player.bakeryId || bakery.id || "");
    const rankedBakery = bakeryById.get(bakeryId);
    const bakeryRank = rankedBakery ? rankedBakery.rank : null;
    const eligible = bakeryRank != null && bakeryRank <= QUALIFIED_BAKERY_COUNT;
    const playerScore = Number(player.score || player.finalScore || player.effectiveTxCount || 0);
    const pool = Number(season.prizePool || 0) / 1e18;
    if (pool > 0) prizePoolEth = pool;
    const rewardEth = eligible && prizePoolEth > 0 && playerScore > 0
      ? prizePoolEth * playerScore / totalQualifiedScore
      : 0;
    const gasEth = Number(snapshotRow.gasEth || 0);
    const netEth = rewardEth - gasEth;
    checkpoint.players[address] = {
      address,
      name: profile.name || player.name || player.username || null,
      avatar: profile.avatar || null,
      bakeryId: bakeryId || null,
      bakeryName: bakery.name || rankedBakery && rankedBakery.name || "No bakery",
      bakeryRank,
      eligible,
      score: playerScore,
      bakeTx: Number(snapshotRow.bakeTx || 0),
      gasEth,
      rewardEth,
      netEth,
      roiPercent: gasEth > 0 ? netEth / gasEth * 100 : null
    };
    completed += 1;
    checkpoint.prizePoolEth = prizePoolEth;
    checkpoint.updatedAt = new Date().toISOString();
    writeCheckpoint(checkpoint);
    if (completed % 10 === 0 || completed === addresses.length) {
      console.log(`Processed ${completed}/${addresses.length}`);
    }
  }

  let cursor = 0;
  async function worker() {
    while (cursor < addresses.length) {
      const address = addresses[cursor];
      cursor += 1;
      await processAddress(address);
      await sleep(100);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const ethUsd = await getEthUsd();
  const players = Object.values(checkpoint.players).map((player) => ({
    ...player,
    gasUsd: player.gasEth * ethUsd,
    rewardUsd: player.rewardEth * ethUsd,
    netUsd: player.netEth * ethUsd
  })).sort((a, b) => b.netUsd - a.netUsd || b.rewardUsd - a.rewardUsd || a.address.localeCompare(b.address));

  players.forEach((player, index) => {
    player.rank = index + 1;
  });

  const output = {
    season: 8,
    snapshotCutoffTs: snapshot.cutoffTs,
    snapshotCutoffUtc: "2026-06-12 21:00:00 UTC",
    generatedAt: new Date().toISOString(),
    ethUsd,
    prizePoolEth,
    qualifiedBakeryCount: QUALIFIED_BAKERY_COUNT,
    totalQualifiedScore,
    totalPlayers: players.length,
    profitablePlayers: players.filter((player) => player.netUsd > 0).length,
    players
  };
  writeJsonAtomic(OUTPUT_FILE, output);
  fs.unlinkSync(CHECKPOINT_FILE);
  console.log(`Wrote ${OUTPUT_FILE}`);
  console.log(`Players: ${players.length}, profitable: ${output.profitablePlayers}, ETH: $${ethUsd}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
