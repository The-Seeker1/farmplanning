# Methods, sources and limits

Every number in FieldWise carries a badge saying how far to trust it:

| Badge | Meaning |
| --- | --- |
| **Sourced** | Read from a published document (the link is in Settings, Sources) |
| **Derived** | Computed from published numbers (the derivation is stated) |
| **Rule of thumb** | An agronomic rule of thumb compiled for this app; not a published index |
| **Assumption** | A planning choice you can change (Settings, Assumptions) |
| **Starter estimate** | A placeholder price or cost, **not** from a source. Replace it. |

## 1. Location and map

- **Address to position:** OpenStreetMap Nominatim (the typed address is sent only when you press Find address).
- **Drawing:** Leaflet with Esri World Imagery and OpenStreetMap tiles. Points are stored as meters east/north of one
  origin (a flat local plane). Over a farm-sized area the flat-plane error is far smaller than the error in where a person
  clicks. Area uses the shoelace formula; 1 acre = 4,046.856 m^2.
- **Fence posts:** length divided by a post spacing per fence type: 12 ft for barbed wire (K-State 2023 survey, Northeast
  district) and spacings derived from posts budgeted per 1,320 ft in the Missouri Extension budget for the others. Gates
  are counted separately at a starter price.

## 2. Soil lookup

1. **USDA Soil Data Access (SSURGO), preferred.** One query for the map unit at the point, its major components, and
   horizons shallower than 30 cm (`buildSdaQuery` in `src/soil.js`). pH, organic matter and texture are
   **thickness-weighted averages over 0 to 30 cm** for the dominant component; drainage class, slope and depth to a
   restrictive layer come from the component.
2. **SoilGrids (ISRIC), fallback.** Modeled global soil maps at 250 m. pH, organic carbon and sand/silt/clay for the top
   30 cm. Organic matter is estimated from organic carbon (x1.724). It carries a lower trust badge than SSURGO.
3. A soil lookup describes **one point**. A field can contain several soil types. The values are editable, and the Land
   tab says where each came from. A soil test from the K-State soil lab beats both.

## 3. Soil fit (rules of thumb)

Five factors, each 0 to 1 (`src/soilfit.js`):

- **pH.** Cut points are from K-State MF-1065 *Liming Acid Soils*: lime trigger for legumes 6.4 (east) / 6.0 (west), for
  other crops 6.0 / 5.5; aluminum is possible below about 5.2; free calcium carbonate is likely at 7.8 to 8.2; above 8.5
  suggests sodic soil. From the trigger the factor falls linearly from 1.0 to 0.4 at pH 5.2, then toward 0.15; at high pH
  it is 0.85 (0.92 for tolerant crops) in the free-lime range, 0.65 (0.8) when strongly alkaline, 0.3 (0.45) when sodic.
  *The shape between the cut points is the app's rule of thumb; the cut points are K-State's.*
- **Drainage, texture, slope, depth.** Per-crop tolerance tables in `src/data/crops.js` (for example soybeans tolerate
  somewhat-poor drainage less well than pasture grass does; steeper slopes reduce row crops sooner than hay). **These
  tables are rules of thumb**, set from general extension guidance and common sense, and are not a published index.
- **Combination.** `fit = 0.5 x weighted geometric mean + 0.5 x worst factor`, weights pH 0.30, drainage 0.28, slope 0.16,
  texture 0.14, depth 0.12. Unknown factors use 0.85 to 0.9 and lower the confidence figure.
- **Yield multiplier:** `clamp(0.4 + 0.7 x fit, 0.4, 1.1)`.

**Limit:** the fit score ranks how suited a soil is. It does not predict a yield: weather, variety, management, fertility,
weeds and pests each swing yield more than most soil differences.

## 4. Crops

- **Yields:** Kansas state averages from USDA NASS (2024 annual summaries; the 2023 values were derived from the
  year-over-year change NASS printed). Low = the weaker of the two years, high = the stronger, typical = the mean.
  Winter wheat 35 / 43 / 39 bu per acre, corn 119 / 129 / 124 bu, soybeans 26 / 35 / 30.5 bu, grain sorghum 52 / 65 /
  58.5 bu, alfalfa 2.65 / 3.05 / 2.85 tons, grass hay 1.35 / 1.50 / 1.425 tons.
- **Planting windows:** K-State L-818 (1996, marked as old in the source list) and MF-315 for vegetables.
- **Prices and per-acre costs: starter estimates.** The Compare tab is robust to a wrong price level because it ranks
  plans against each other; the dollar figures are not.

## 5. Livestock

- **Forage animals:** capacity = acres x forage x utilization / (animal's yearly forage). A cow with a calf is 1.00 animal
  unit (AU), about 26 lb of dry forage a day (National Range and Pasture Handbook, via Oregon State EM 9552); a ewe is
  0.20 AU, a doe 0.15, a horse 1.25 (K-State MF3634).
- **Pasture growth:** 2 to 5 tons per acre (Hay & Forage Grower: tall fescue 2 to 5 tons), scaled by the pasture soil fit.
- **Utilization:** 40% rotational, 25% season-long. These are planning assumptions (published "take half, leave half"
  guidance is more conservative or less, depending on grass and season).
- **Space animals:** hogs and poultry use animals-per-acre densities from NC State CEFS, UC ANR and Certified Humane
  definitions, scaled by 0.6 for non-rotated use.
- **Water:** gallons per head per day, typical and hot (cattle hot = typical x 1.63, the 90 F / 70 F ratio in NDSU AS1763).
  Sheep and goats from NDSU and eXtension.
- **Fence fit:** which fence suits which animal is a rule of thumb (`fenceFit` tables); the app warns about poor matches.
- **Animal prices and yearly costs: starter estimates.**

## 6. Fences

Installed cost per foot comes from University of Missouri Extension G1193 (January 2024), including a 5% terrain
allowance, and is cross-checked against the K-State Land Use Survey of 2023 (a quarter-section of 5-wire barbed wire
cost about $1.27 per foot in materials plus about $1.55 labor, about $2.82 before gates and corners, which is **lower**
than Missouri's $3.55). Treat fence costs as a range. Electrified netting and gates are starter estimates.

## 7. Money, risk and ranking

- **Revenue/cost/net** per plan, low/typical/high for crops. Start-up = animals + shelters + fence + gates.
- **Cash projection:** start-up cost taken out once, then the same net every year for the number of years you choose
  (default 5): no interest, tax, inflation or price change.
- **Risk (0 calm to 100):** 35% the yield swing between the two NASS years (weighted by each crop's revenue), 25% how
  poorly the soil fits (1 minus fit), 15% how much of the soil data is unentered or guessed, 25% the drop from typical to
  low-year net as a share of revenue, plus a flat 20 points if any herd is over its carrying capacity and 15 if animals have
  no water source. The mix is the app's rule of thumb, not a published risk model.
- **Ranking:** each criterion is rescaled to 0..1 across your plans, then combined with your slider weights.
- **What-if:** product prices and costs can be changed by up to 40% without altering saved plans.

## 8. Photos

- **Safety first:** the file type is checked from its bytes, size is limited, and the picture is re-drawn on a canvas
  (this removes location and camera metadata) before any use.
- **Color reader (always available):** per-pixel hue/saturation rules assign water, trees, grass, bare soil or "other". It
  cannot tell crops from pasture, and shadows and season change the result.
- **Gemini (optional):** can describe vegetation condition, weeds, slope and drainage from a picture. These are
  impressions, shown with a confidence level, and nothing changes in your land data until you press Apply.
  A single photo cannot reliably show slope or drainage, and the app says so.

## 9. 3D view

A stylized low-poly picture built from your drawing (`src/scene.js`). Terrain height uses your slope number and the
direction you set; animals are drawn **larger than life** so they are visible; fences and posts follow your lines. It is
an illustration of the plan, not a survey, a flood map or a design drawing.

## 10. Learning content

Benefit and limit statements for each soil band (`src/learn.js`) are written from K-State liming guidance (pH) and
common extension rules of thumb (organic matter, texture, drainage, slope; badge: rule of thumb). Calculation questions call
the same planner functions as the Plans tab. AI-written lessons and quizzes can be wrong: they are labeled, and
calculation questions in them are **not** re-checked by the app.

## 11. What this app cannot do

- It cannot replace a soil test, a stocking plan from NRCS or your county agent, a veterinarian, a lender or a lawyer.
- It does not know your pasture species, rainfall this year, soil microbiology, water rights, zoning, leases, taxes,
  insurance, labor or market access.
- Kansas first: other states have different pH triggers, crops, prices and soils. Nothing outside Kansas has been checked.
- Dollar results are only as good as the prices you enter.
