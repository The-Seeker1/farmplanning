# FieldWise

A free web app that helps you plan what a piece of Kansas land can support: how many animals, which crops, what it
costs, and why. Type an address or draw your land on a map, and FieldWise looks up the soil, works out stocking and
crop numbers, compares plans, shows the farm in 3D, and builds a quiz from your own field's soil.

There is no server, no account and no tracking. Everything is saved in your own browser.

> FieldWise gives planning estimates for learning and early planning. It is not agronomic, veterinary, legal or
> financial advice. Check numbers with a soil test and your county K-State Research and Extension office.

## Features

| Tab | What you can do |
| --- | --- |
| **Land** | Find an address, set the size, get soil data (USDA SSURGO, with SoilGrids as a backup), or type in your own soil test. Add a photo. |
| **Map** | Draw the boundary, zones (pasture, crops, garden, barn, pond) and fence lines on a satellite map. Place animals. |
| **Plans** | Get suggested plans or build your own: head counts, crop acres, water, yields, start-up cost, yearly net, warnings. |
| **Compare** | Rank plans on profit, soil fit, risk and start-up cost, test lower prices, and see a 5-year cash chart. |
| **3D view** | A simple low-poly 3D model of your plan. |
| **Learn** | Lessons and a quiz about your own soil; topics you miss come back first. |
| **Settings** | Optional Gemini key, your own prices, planning assumptions, export/import, privacy, sources. |

Animals: beef cattle, sheep, goats, hogs, chickens, horses. Crops: winter wheat, corn, soybeans, grain sorghum,
alfalfa hay, grass hay, and a vegetable garden.

## Optional AI

Everything works without AI. If you add a free Google Gemini API key in Settings, the app can also review a plan in
plain English, write lessons and quizzes for your land, and read a photo of your field. Only rounded land numbers are
sent, never your name, address or map coordinates. Gemini keys are for people 18 or older.

## Run it

You need [Node.js](https://nodejs.org/) 20 or newer.

```
npm install
npm run dev       # open http://localhost:5173
npm test          # unit tests
npm run build     # builds the site into dist/
```

`npm run smoke` runs a full test in a real browser (needs Chromium installed).

## Put it online (GitHub Pages)

1. Push this repository to GitHub.
2. In the repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` builds the site and publishes it at `https://<your-user>.github.io/<repo-name>/`.

## Project layout

```
src/data/      livestock, crops, fences and the source list behind every number
src/geo.js     map math: area, length, fence posts
src/soil.js    USDA SSURGO and SoilGrids lookups
src/soilfit.js soil fit score and lime advice
src/planner.js stocking, water, yields, costs, plans and comparison
src/learn.js   lessons and quiz
src/photo.js   photo checks and the color reader
src/ai/        optional Gemini connection
src/ui/        the tabs
tests/         unit tests and the browser test
docs/          how it works, formulas and sources, security
```

## Data sources

USDA Soil Data Access (SSURGO), ISRIC SoilGrids, OpenStreetMap Nominatim, Esri World Imagery, K-State Research and
Extension, USDA NASS, and university extension publications. The full list, with links, is in the app under
**Settings > Sources** and in `docs/METHODS.md`.

## Limits

- Prices marked with a yellow "starter" badge are placeholders, not published figures. Replace them in Settings.
- Stocking and yield figures are planning estimates, not measurements of your land.
- Built for Kansas first; soil and crop guidance elsewhere may differ.
