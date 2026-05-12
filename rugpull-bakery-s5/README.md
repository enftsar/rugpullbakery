# Rugpull Bakery Season 5 Calculator

Season 5 dashboard/calculator for Rugpull Bakery, ready for GitHub and Vercel.

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
6. Deploy.

## Notes

- `/api/proxy` is a small Vercel function with a strict host allowlist and edge cache headers.
- Leaderboard and live metrics use short cache windows to stay Hobby-plan friendly.
- No analytics or large embedded images are included.
- Player ROI uses `data/s5-bake-snapshot.json` for Bake TX up to `2026-05-12 01:00 TRT`, then scans only newer transactions.

## Refresh Snapshot

```bash
npm run snapshot
```

