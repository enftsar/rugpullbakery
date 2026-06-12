# Rugpull Bakery Season 8 Calculator

Season 8 dashboard and Player ROI calculator for Rugpull Bakery, ready for GitHub and Vercel.

## Local Preview

```bash
npm run dev
```

## Deploy To Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, import the GitHub repository.
3. Keep the framework preset as `Other` or `Static`.
4. Leave the build command empty.
5. Leave the output directory empty.
6. Deploy. Live Bake TX data uses the public Abstract RPC and needs no Vercel environment variable.

## Notes

- `/api/proxy` is a small Vercel function with a strict host allowlist and edge cache headers.
- Live Bake TX and gas data are read from the official Abstract JSON-RPC endpoint without an API key.
- Leaderboard and live metrics use short cache windows to stay Hobby-plan friendly.
- No analytics or large embedded images are included.
- Season 8 starts at `2026-06-05 21:00 UTC` (`2026-06-06 00:00 TRT`) and ends at `2026-06-12 21:00 UTC`.
- The top 7 bakeries qualify. Bakery and member payouts are calculated from final score shares, not spendable cookies.
- `data/s8-bake-snapshot.json` covers the complete Season 8 through `2026-06-12 21:00:00 UTC` (`2026-06-13 00:00:00 TRT`).
- Top ROI reporting is not included. A fresh report can be added after the Season 8 snapshot is created.

## Create Or Refresh The Season 8 Snapshot

```bash
npm run snapshot
```

Snapshot generation still uses Etherscan locally. To stop at an exact Unix timestamp:

```powershell
$env:ETHERSCAN_API_KEY="your-key"
$env:CUTOFF_TS="1781000000"
npm run snapshot
```

Without `CUTOFF_TS`, the script snapshots up to the current time, capped at the Season 8 end.
