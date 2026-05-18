# Rugpull Bakery Season 6 Calculator

Season 6 dashboard/calculator for Rugpull Bakery, ready for GitHub and Vercel.

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
- Player ROI is configured for Season 6 start (`2026-05-18 18:00 TRT`) and uses `data/s6-bake-snapshot.json` once a Season 6 snapshot is generated.
- Top 10 Net ROI USD reads `reports/top-roi-chefs-s6.json`; it starts empty until a Season 6 snapshot/report is generated.

## Refresh Season 6 Data

```bash
npm run snapshot
npm run roi:s6
```
