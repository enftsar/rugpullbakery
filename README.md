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
6. Add `ETHERSCAN_API_KEY` in the Vercel project environment variables.
7. Deploy.

## Notes

- `/api/proxy` is a small Vercel function with a strict host allowlist and edge cache headers.
- The Etherscan key is injected by the proxy and is never exposed in `index.html`.
- Leaderboard and live metrics use short cache windows to stay Hobby-plan friendly.
- No analytics or large embedded images are included.
- Season 8 starts at `2026-06-05 21:00 UTC` (`2026-06-06 00:00 TRT`) and ends at `2026-06-12 21:00 UTC`.
- The top 7 bakeries qualify. Bakery and member payouts are calculated from final score shares, not spendable cookies.
- `data/s8-bake-snapshot.json` covers Season 8 through `2026-06-09 22:00:00 UTC`; Player ROI scans later transactions live.
- Top ROI reporting is not included. A fresh report can be added after the Season 8 snapshot is created.

## Create Or Refresh The Season 8 Snapshot

```bash
npm run snapshot
```

Set an Etherscan API key first. To stop at an exact Unix timestamp:

```powershell
$env:ETHERSCAN_API_KEY="your-key"
$env:CUTOFF_TS="1781000000"
npm run snapshot
```

Without `CUTOFF_TS`, the script snapshots up to the current time, capped at the Season 8 end.
