# Rugpull Bakery Season 7 Calculator

Season 7 dashboard/calculator for Rugpull Bakery, ready for GitHub and Vercel.

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
- Player ROI is configured for Season 7 start (`2026-05-27 18:00 TRT`) and uses `data/s7-bake-snapshot.json`.
- Top 10 Net ROI USD has been removed from the public UI for Season 7.

## Refresh Season 7 Data

```bash
npm run snapshot
```
