const ALLOWED_HOSTS = new Set([
  "www.rugpullbakery.com",
  "api.coingecko.com",
  "api.etherscan.io",
  "backend.portal.abs.xyz",
  "abscope.live"
]);

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function cacheHeaderFor(url) {
  if (url.hostname === "api.coingecko.com") {
    return "public, s-maxage=300, stale-while-revalidate=600";
  }
  if (url.hostname === "api.etherscan.io") {
    return "public, s-maxage=60, stale-while-revalidate=120";
  }
  return "public, s-maxage=30, stale-while-revalidate=120";
}

module.exports = async function handler(req, res) {
  const rawTarget = first(req.query.url || req.query.quest);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  if (!rawTarget) {
    res.status(400).json({ error: "missing_url" });
    return;
  }

  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    res.status(400).json({ error: "invalid_url" });
    return;
  }

  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
    res.status(403).json({ error: "host_not_allowed" });
    return;
  }

  if (target.hostname === "api.etherscan.io" && !target.searchParams.get("apikey")) {
    const apiKey = process.env.ETHERSCAN_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "etherscan_api_key_missing" });
      return;
    }
    target.searchParams.set("apikey", apiKey);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(target.toString(), {
      signal: controller.signal,
      headers: {
        accept: req.headers.accept || "application/json,text/plain,*/*",
        "user-agent": "rugpull-bakery-s8-calculator/1.0"
      }
    });

    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", cacheHeaderFor(target));

    const body = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status).send(body);
  } catch (error) {
    const isAbort = error && error.name === "AbortError";
    res.status(isAbort ? 504 : 502).json({
      error: isAbort ? "upstream_timeout" : "upstream_fetch_failed"
    });
  } finally {
    clearTimeout(timer);
  }
};
