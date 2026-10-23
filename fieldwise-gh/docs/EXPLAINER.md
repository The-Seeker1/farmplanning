# How FieldWise works 

## The big picture

FieldWise is a **web page that does all its work in your browser**. There is no FieldWise server. The page:

1. **Collects facts** about your land: from an address lookup, the USDA soil survey, a drawing on a map, a photo, or
   numbers you type from a soil test.
2. **Does math** on those facts: stocking rate, water, fence length, crop yield, money. This is plain JavaScript in
   `src/planner.js` and `src/soilfit.js`, with no AI involved.
3. **Shows it** in six tabs, including a 3D view (`src/scene.js`) and a quiz (`src/learn.js`).
4. **Optionally asks an AI** (Gemini, if you paste a key) to read photos and write lessons and quizzes.

The most important design rule: **the app works fully without AI.** The AI is an extra, never a requirement, and
anything the AI says is checked and labeled before you see it.

## The five ideas to understand

### 1. Local map math (`src/geo.js`)

Latitude and longitude are angles, which are awkward for area. The app picks one point on your land as the origin and
measures everything in **meters east and north of it** (a flat "local" map). That is accurate for a farm. Area comes from
the shoelace formula, perimeter from adding the sides, and fence posts from dividing a fence length by the post spacing.
Example: a rectangle 1,320 ft by 660 ft has area 871,200 sq ft, which is 871,200 / 43,560 = **20.0 acres**.

### 2. Soil fit: how well does this soil suit this crop? (`src/soilfit.js`)

Each crop has a tolerance for five soil facts: **pH, drainage, slope, texture and depth to a hard layer**. Each fact gets
a number from 0 (terrible) to 1 (no problem). For example corn on soil pH 5.5 gets less than 1 because K-State's lime
trigger for non-legumes in eastern Kansas is 6.0.

The five numbers are combined with weights (pH 30%, drainage 28%, slope 16%, texture 14%, depth 12%). A plain average
would hide a disaster: a field that is perfect except underwater half the year should not score "pretty good". So the
score is **half a weighted geometric mean and half the single worst factor**. This follows the idea that the scarcest
resource limits a crop ("law of the minimum"). The result is a **fit score from 0 to 100**. Missing facts count as slightly
below average and lower the "confidence" so the app does not pretend to know what you did not enter.

### 3. How many animals fit? (`stockingCapacity` in `src/planner.js`)

For grazers (cattle, sheep, goats, horses) the limit is **how much grass grows**:

```
acres x pounds of forage per acre per year x share the animals actually eat / forage one animal needs per year
```

Worked example: 100 acres x 7,000 lb per acre = 700,000 lb grown. Rotational grazing uses about 40% (the rest is
trampled or left to regrow) = 280,000 lb. A cow with her calf eats about 26 lb a day = 9,490 lb a year. 280,000 / 9,490 =
29.5, which rounds **down** to **29 pairs**. Season-long grazing uses only 25%, which carries 18 pairs.

Pasture growth itself is a range (2 to 5 tons per acre) scaled by the soil fit, so poorer soil means less grass.
Hogs and chickens are limited more by **space and manure** than by grass, so the app uses published animals-per-acre figures.
The app suggests starting at 75% of the maximum, a planning assumption you can change in Settings.

### 4. Crop yield and money (`cropEstimate` in `src/planner.js`)

Expected yield starts with the **Kansas state average** from USDA NASS (the last two years, so you can see a weak year
and a better year). It is then multiplied by a factor from 0.4 to 1.1 that rises with soil fit:

```
factor = clamp(0.4 + 0.7 x fit, 0.4, 1.1)
```

A perfect fit gives 1.1 (a bit above average), a poor fit cuts yield by more than half. Revenue is yield x price. Net is
revenue minus cost. The plan's low, typical and high results come from the weaker year, the average and the stronger year.

**Prices and costs are "starter estimates".** They are not published numbers. That is why they carry a yellow badge, why
the app keeps telling you to replace them in Settings, and why the Compare tab is more trustworthy for "which plan is
better?" than any single profit figure. Fence costs and yields do come from sources (University of Missouri Extension,
K-State, USDA NASS).

### 5. Comparing plans (`comparePlans`, `applyScenario` in `src/planner.js`; `src/ui/compareTab.js`)

Plans are compared on four things: **profit, soil fit, risk and start-up cost**. Each is rescaled to 0 to 1 across the plans
(the best plan on that measure gets 1, the worst 0), then combined with the weights you choose with the sliders. Rescaling
is what lets dollars and scores share one ranking. The "what if prices fall" slider re-runs the money without changing
your saved plans.

## The AI part, and why it is built the way it is

- **One small adapter.** `src/ai/provider.js` says what an AI provider must do (`generateJson` and `testConnection`);
  `src/ai/gemini.js` does it for Google. To use another model you add one file. The tasks in `src/ai/tasks.js` never
  mention Gemini.
- **Only safe facts leave your device.** `buildAIContext` in `src/ai/tasks.js` is the single place that decides what is sent:
  rounded soil numbers, field size, plan totals. It never includes your name, address, coordinates or the profile title.
- **AI answers are untrusted.** `src/ai/validate.js` copies only the fields it expects, cleans the text, clamps numbers, and
  throws away quiz questions whose answer key is invalid. The app prints text as text (never as HTML), and anything that
  would change your land (like "slope: steep") waits for you to press **Apply**.
- **Guard rails for a free key.** `guardProvider` waits at least 4 seconds between calls, answers repeats from memory, and
  stops after 60 calls a session, so a bug cannot use up the free quota.
- **Free mode still teaches.** Without a key, the app uses a rule-based lesson and quiz engine (`src/learn.js`) and a
  color-based photo reader (`src/photo.js`).

## The learning tab (`src/learn.js`)

Each soil fact has a "card": for example, pH 7.9 is "high, free lime likely" with one **true benefit** (no lime needed,
aluminum is not a worry, calcium is plentiful), one **true limit** (free lime can tie up iron, zinc and phosphorus) and
three plausible **false** statements for each. The quiz asks "Which is a real BENEFIT of your pH?" and "Which problem is MOST
likely?" with the false statements as wrong answers, then adds calculation questions that use your acreage, boundary and
prices through the same functions the planner uses, so the quiz and the Plans tab can never disagree. Topics you miss come
first next time. With an AI key, Gemini writes the questions instead, from the same safe facts plus your weak topics.

## A tour of the files, smallest idea first

| File | One-sentence job |
| --- | --- |
| `src/data/*.js` | Every number, each tagged with where it came from and how much to trust it |
| `src/geo.js` | Area, length, post counts, projection between map and meters |
| `src/soilfit.js` | The soil-fit score, pH factors and lime advice |
| `src/planner.js` | Stocking, water, yield, money, fences, plans and the ranking |
| `src/soil.js` | Ask USDA (or SoilGrids) for soil at a point and turn the reply into numbers |
| `src/net.js` | The only door to the network: https only, allowlist, time and size limits |
| `src/storage.js` | Saving on the device, cleaning everything that is loaded or imported |
| `src/photo.js` | Check and clean photos, read land cover (color rules or the trained network) |
| `src/learn.js` | Lessons and quiz questions from your land |
| `src/ai/*` | The AI adapter, the tasks and the validators |
| `src/scene.js`, `models3d.js`, `layout.js` | Turn the plan into a low-poly 3D scene |
| `src/ui/*` | The tabs |
