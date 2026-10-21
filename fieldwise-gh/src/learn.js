import { seededRng, polygonPerimeter, toFeet } from './geo.js';
import { LIVESTOCK, getLivestock } from './data/livestock.js';
import { CROPS, LIME_TRIGGER, PH_THRESHOLDS } from './data/crops.js';
import { FENCES } from './data/fences.js';
import { TEXTURE_LABEL, DRAINAGE_LABEL, textureGroup, phFactor, limeAdvice, pastureForageLbPerAc, cropSoilFit } from './soilfit.js';
import { stockingCapacity, usableAcres, waterNeed, cropEstimate, rankOptions, fenceCostPerFt, DEFAULT_ASSUMPTIONS } from './planner.js';

export const TOPIC_LABEL = {
  ph: 'Soil pH',
  organic_matter: 'Organic matter',
  texture: 'Soil texture',
  drainage: 'Drainage',
  slope: 'Slope and erosion',
  stocking: 'How many animals?',
  crops: 'Crops and your soil',
  water: 'Water for animals',
  fencing: 'Fencing',
  economics: 'Costs, prices and risk',
};
export const TOPICS = Object.keys(TOPIC_LABEL);

const formatNumber = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const dollars = (n) => `$${formatNumber(Math.round(n))}`;

function phBand(ph, region) {
  if (!Number.isFinite(ph)) return null;
  const west = region === 'west' ? 'west' : 'east';
  const phLimits = PH_THRESHOLDS;
  if (ph < phLimits.aluminum) return 'very_acid';
  if (ph < LIME_TRIGGER.nonlegume[west]) return 'acid';
  if (ph < LIME_TRIGGER.legume[west]) return 'legume_gap';
  if (ph <= phLimits.carbonateLow) return 'good';
  if (ph <= phLimits.carbonateHigh) return 'free_lime';
  if (ph <= phLimits.sodic) return 'alkaline';
  return 'sodic';
}

const PH_BANDS = {
  very_acid: {
    label: 'strongly acidic',
    summary: () => `Below ${PH_THRESHOLDS.aluminum}, K-State warns that aluminum can reach levels that harm plants.`,
    benefit: 'Iron, manganese and zinc stay easy for plants to reach, and lime can raise the pH.',
    limit: 'Aluminum can damage roots, phosphorus is harder to use, and legumes such as alfalfa and soybeans struggle.',
    manage: 'Ask the K-State soil lab for a buffer-pH test; it gives a lime rate that pH alone cannot.',
    wrongBenefits: ['Free lime in the soil protects crops from every nutrient problem.', 'No lime will ever be needed on this soil.', 'Legumes fix the most nitrogen at this pH.'],
    wrongLimits: ['Iron and zinc are locked up by free lime.', 'Sodium makes the soil crust and shed water.', 'Nothing limits crops at this pH.'],
  },
  acid: {
    label: 'acidic, below the lime trigger',
    summary: (r) => `It is under K-State's ${LIME_TRIGGER.nonlegume[r]} lime trigger for non-legume crops in ${r === 'west' ? 'western' : 'eastern'} Kansas.`,
    benefit: 'Iron and zinc stay available, and aluminum is not yet a problem (pH is still above about 5.2).',
    limit: 'It is below the lime trigger, so wheat, corn and especially legumes can lose yield until lime is applied.',
    manage: 'Get a buffer-pH test to find how much lime to apply.',
    wrongBenefits: ['Free lime buffers the soil so pH never changes.', 'Lime is never needed here.', 'Alfalfa grows best at this pH without any lime.'],
    wrongLimits: ['Free lime is tying up iron and zinc.', 'Sodium is dispersing the soil.', 'The soil is too alkaline for sorghum.'],
  },
  legume_gap: {
    label: 'acid enough that legumes want lime',
    summary: (r) => `It is above the ${LIME_TRIGGER.nonlegume[r]} trigger for grain and grass but below the ${LIME_TRIGGER.legume[r]} trigger for legumes.`,
    benefit: 'Wheat, corn, sorghum and grass do not need lime at this pH.',
    limit: 'Legumes such as alfalfa and soybeans are below their lime trigger and can respond to lime.',
    manage: 'If you plan legumes, get a buffer-pH test before planting.',
    wrongBenefits: ['Lime is needed for every crop at this pH.', 'Aluminum toxicity is a serious danger at this pH.', 'Free lime protects the iron supply.'],
    wrongLimits: ['Free lime ties up iron and zinc.', 'Sodium crusts the soil surface.', 'Wheat and corn need lime immediately at this pH.'],
  },
  good: {
    label: 'in the comfortable range',
    summary: () => 'Most nutrients are available, and no lime is needed.',
    benefit: 'Nutrients are broadly available, soil microbes are active, and no lime is needed.',
    limit: 'pH drifts down slowly because nitrogen fertilizer acidifies soil, so a good pH today does not stay good by itself.',
    manage: 'Retest every few years, and especially before planting alfalfa.',
    wrongBenefits: ['Free lime in the soil supplies extra iron.', 'Sodium improves soil structure at this pH.', 'Aluminum helps roots grow.'],
    wrongLimits: ['Iron and zinc are locked up by free lime.', 'Aluminum toxicity damages roots.', 'The soil is sodic and crusts over.'],
  },
  free_lime: {
    label: 'high, with free lime likely',
    summary: () => `K-State says a pH of ${PH_THRESHOLDS.carbonateLow} to ${PH_THRESHOLDS.carbonateHigh} usually means free calcium carbonate in the soil.`,
    benefit: 'No lime is needed, aluminum is not a worry, and calcium and magnesium are plentiful.',
    limit: 'Free lime can tie up iron, zinc and phosphorus, so sensitive crops can turn yellow.',
    manage: 'Choose tolerant crops where you can, and ask the K-State soil lab for phosphorus and zinc advice.',
    wrongBenefits: ['Iron and zinc become more available than at neutral pH.', 'Lime must be added each year to keep this pH.', 'Aluminum toxicity is a danger.'],
    wrongLimits: ['Aluminum is damaging roots.', 'Lime is needed to fix the pH.', 'The soil is too acidic for legumes.'],
  },
  alkaline: {
    label: 'strongly alkaline',
    summary: () => `It is above ${PH_THRESHOLDS.carbonateHigh}, past the usual free-lime range, but not yet in the sodic range (above ${PH_THRESHOLDS.sodic}).`,
    benefit: 'Lime is still not needed and aluminum is not a worry.',
    limit: 'Iron, zinc and phosphorus lock-up is stronger, and crops that dislike high pH lose yield.',
    manage: 'Favor tolerant crops and ask the K-State soil lab for nutrient advice. Lowering pH across a whole field is rarely practical.',
    wrongBenefits: ['Iron and zinc are more available than at neutral pH.', 'Lime is needed each year to hold this pH.', 'All crops tolerate this pH equally well.'],
    wrongLimits: ['Aluminum is damaging roots.', 'The soil needs lime to raise pH.', 'It is too acidic for alfalfa.'],
  },
  sodic: {
    label: 'high enough to suggest sodic soil',
    summary: () => `K-State links a pH above ${PH_THRESHOLDS.sodic} to high exchangeable sodium.`,
    benefit: 'Little. Lime is not needed and aluminum is not a problem, but the soil needs special management.',
    limit: 'Sodium can make soil particles disperse, crust and drain poorly. Fixing it takes a sodium soil test and expert advice.',
    manage: 'Talk to your county extension agent or NRCS before investing in this ground.',
    wrongBenefits: ['Sodium makes soil structure better.', 'Iron and zinc are plentiful.', 'Lime will fix it quickly.'],
    wrongLimits: ['Aluminum toxicity is the main danger.', 'The soil needs lime to raise pH.', 'Nothing limits crops at this pH.'],
  },
};

function omBand(organicMatter) {
  if (!Number.isFinite(organicMatter)) return null;
  return organicMatter < 2 ? 'low' : organicMatter <= 4 ? 'moderate' : 'high';
}
const OM_BANDS = {
  low: {
    label: 'low',
    summary: () => 'Under about 2 percent is low for most Kansas cropland.',
    benefit: 'It can be built up with residue, manure, cover crops and less tillage, and every bit gained helps water and nutrient holding.',
    limit: 'It holds less water and nutrients, supplies less nitrogen, and the surface can crust or erode.',
    manage: 'Leave residue, reduce tillage, add manure or cover crops. Change is slow.',
    wrongBenefits: ['It holds more water than high-organic-matter soils.', 'It supplies extra nitrogen without fertilizer.', 'It stops erosion on its own.'],
    wrongLimits: ['The soil is too sticky to work because of excess organic matter.', 'Organic matter locks up all the phosphorus.', 'Aluminum toxicity is the main risk.'],
  },
  moderate: {
    label: 'moderate',
    summary: () => 'About 2 to 4 percent is a workable level for much Kansas cropland.',
    benefit: 'It stores a useful amount of water and nutrients, releases some nitrogen slowly, and gives the soil a crumbly structure.',
    limit: 'It is still easy to lose: tillage and bare soil burn it off faster than residue rebuilds it.',
    manage: 'Protect it with residue cover and less tillage.',
    wrongBenefits: ['Organic matter makes the soil lose water faster.', 'It guarantees that no fertilizer is needed.', 'It raises pH on its own.'],
    wrongLimits: ['There is too little organic matter to hold any water.', 'Organic matter is the cause of sodic soil.', 'Nothing about management matters.'],
  },
  high: {
    label: 'high',
    summary: () => 'Above about 4 percent is high and usually means productive, dark soil.',
    benefit: 'Excellent water and nutrient holding, steady nitrogen release and good structure.',
    limit: 'It warms slowly in spring and is often found where drainage is poorer, so check wetness and compaction before working it.',
    manage: 'Wait for fields to dry before heavy equipment or hooves.',
    wrongBenefits: ['It dries and warms faster than low-organic-matter soils.', 'It never needs soil testing.', 'It is immune to erosion.'],
    wrongLimits: ['It has too little water-holding capacity.', 'It is always very acidic.', 'It cannot support pasture.'],
  },
};

const TEXTURE_FAMILIES = {
  coarse: {
    label: 'coarse (sandy)',
    summary: () => 'Sandy soils have large pores and little clay.',
    benefit: 'It drains quickly, warms early in spring and is easy to work.',
    limit: 'It holds little water and few nutrients, so it is drought-prone and fertilizer can leach below the roots.',
    manage: 'Split fertilizer into smaller doses, keep residue on top, and plan for dry spells.',
    wrongBenefits: ['It holds more water than any other texture.', 'It rarely needs drought planning.', 'It resists wind erosion best of all textures.'],
    wrongLimits: ['It stays wet and cold into late spring.', 'It compacts into a hard layer when wet.', 'Water cannot soak in at all.'],
  },
  medium: {
    label: 'medium (loamy or silty)',
    summary: () => 'Loams and silt loams balance sand, silt and clay.',
    benefit: 'It is balanced: it holds plenty of water and nutrients but still drains and is workable.',
    limit: 'Silty soils can crust or erode when bare and compact if worked wet.',
    manage: 'Keep residue cover and stay off it when it is wet.',
    wrongBenefits: ['It never compacts or erodes.', 'It holds water as tightly as clay, so it never drains.', 'It needs no residue cover.'],
    wrongLimits: ['It is too sandy to hold nutrients.', 'It is too sticky to ever work.', 'It drains so fast that crops always wilt.'],
  },
  fine: {
    label: 'fine (clayey)',
    summary: () => 'Clay soils have tiny pores and hold a lot of water.',
    benefit: 'It holds lots of water and nutrients.',
    limit: 'It drains slowly, turns sticky and compacts if worked wet, and warms slowly in spring.',
    manage: 'Work it only when it crumbles, avoid heavy traffic when wet, and watch for ponding.',
    wrongBenefits: ['It drains faster than sand.', 'It warms earlier in spring than other soils.', 'It never gets waterlogged.'],
    wrongLimits: ['Nutrients leach away quickly.', 'Drought hits first because it holds so little water.', 'It blows away easily in wind.'],
  },
};

const DRAINAGE_FAMILIES = {
  dry: {
    label: 'fast draining and often droughty',
    summary: () => 'Water moves through quickly.',
    benefit: 'It dries and warms early, so fieldwork starts early and animals face little mud.',
    limit: 'It is droughty: water and nutrients move below the roots quickly.',
    manage: 'Plan for drought, favor drought-tolerant crops and keep a hay reserve.',
    wrongBenefits: ['It holds water for weeks after a storm.', 'It prevents any drought stress.', 'It is the best soil for rice.'],
    wrongLimits: ['It stays waterlogged in spring.', 'Mud and foot rot are the main livestock problems.', 'Roots run out of oxygen after rain.'],
  },
  good: {
    label: 'draining at a good pace',
    summary: () => 'Water drains at a good pace.',
    benefit: 'Roots get air and water in balance, fieldwork starts early, and animals face less mud and fewer hoof problems.',
    limit: 'Dry spells still matter, so plan for a dry July even on well-drained ground.',
    manage: 'Keep residue cover to hold moisture.',
    wrongBenefits: ['It stays wet enough to need no rain at all.', 'It guarantees high yields every year.', 'It removes the need for soil testing.'],
    wrongLimits: ['Fields are too wet to plant most springs.', 'Constant mud causes foot rot.', 'Roots drown after normal rains.'],
  },
  mid: {
    label: 'a little slow in wet seasons',
    summary: () => 'Water drains a little slowly, mainly in wet seasons.',
    benefit: 'It holds a bit more water through dry spells while still draining in most years.',
    limit: 'It can stay wet after heavy spring rain, delaying planting and making mud.',
    manage: 'Plant the wettest spots last, and keep animals off wet pasture.',
    wrongBenefits: ['It never gets wet.', 'It is better than well-drained soil in every way.', 'It needs no rain.'],
    wrongLimits: ['It is always droughty.', 'Nutrients leach out in minutes.', 'It can never be planted.'],
  },
  wet: {
    label: 'slow draining and often wet',
    summary: () => 'Water stays in or on the soil for long periods.',
    benefit: 'It is often rich in organic matter and can suit moisture-loving pasture grass.',
    limit: 'It is waterlogged much of the year: crops are planted late or drown, nitrogen is lost, and animals get mud and foot problems.',
    manage: 'Favor pasture or hay, improve drainage where allowed, and keep animals off when it is soft.',
    wrongBenefits: ['It is the best for early planting.', 'It never needs drainage.', 'It is immune to compaction.'],
    wrongLimits: ['It is always droughty.', 'It drains so fast that fertilizer leaches.', 'It warms earlier than any other soil.'],
  },
};
const drainageFamily = (d) => (d === 'excessive' ? 'dry' : d === 'well' ? 'good' : d === 'moderate' ? 'mid' : d ? 'wet' : null);

function slopeBand(percent) {
  if (!Number.isFinite(percent)) return null;
  return percent <= 2 ? 'flat' : percent <= 6 ? 'gentle' : percent <= 10 ? 'moderate' : 'steep';
}
const SLOPE_BANDS = {
  flat: {
    label: 'nearly level',
    summary: () => 'Up to about 2 percent is nearly level.',
    benefit: 'It is easy to farm and fence, erosion is low and water soaks in.',
    limit: 'Water can pond in low spots, especially on slowly draining soil.',
    manage: 'Look for low spots that stay wet.',
    wrongBenefits: ['It has the highest erosion risk of any slope.', 'Rain always runs off before soaking in.', 'It is unsafe for equipment.'],
    wrongLimits: ['Steep slopes make equipment unsafe.', 'Water runs off and carries the soil away.', 'Gravity pulls manure downhill into the road.'],
  },
  gentle: {
    label: 'gently sloping',
    summary: () => 'About 2 to 6 percent is gently sloping.',
    benefit: 'It drains well and can still be farmed with ordinary practices.',
    limit: 'Erosion starts to matter, so residue cover, no-till or contour practices are worth using.',
    manage: 'Keep residue on the surface and avoid up-and-down-hill rows.',
    wrongBenefits: ['It has no erosion risk at all.', 'Row crops are impossible here.', 'Water never moves.'],
    wrongLimits: ['It is too steep for any crop.', 'Water always ponds.', 'It cannot be fenced.'],
  },
  moderate: {
    label: 'moderately sloping',
    summary: () => 'About 6 to 10 percent is moderately sloping.',
    benefit: 'It drains well, and pasture or hay protects it with fewer problems than row crops.',
    limit: 'Row crops risk serious erosion, and this app lowers crop soil-fit scores as slope rises.',
    manage: 'Favor grass or hay, or use terraces, contours and no-till if you crop it.',
    wrongBenefits: ['It has less erosion risk than flat ground.', 'Tillage up and down the hill is the best practice.', 'Row crops are ideal here.'],
    wrongLimits: ['Water ponds in the middle of the field.', 'It is too flat to drain.', 'Grass cannot grow here.'],
  },
  steep: {
    label: 'steep',
    summary: () => 'Above about 10 percent is steep for Kansas farmland.',
    benefit: 'It suits permanent grass, trees or wildlife cover, which protect the soil.',
    limit: 'Erosion and runoff are high, equipment is less safe, and fences and water lines are harder to build.',
    manage: 'Keep permanent cover and avoid row crops.',
    wrongBenefits: ['It is the best slope for tilled row crops.', 'It has the lowest runoff of any slope.', 'It makes fencing easier.'],
    wrongLimits: ['It is too flat to drain.', 'Water ponds on the surface.', 'It always has too little erosion for grass.'],
  },
};

const nounFor = { ph: 'soil pH', organic_matter: 'organic matter', texture: 'soil texture', drainage: 'drainage', slope: 'slope' };

export function factorCards(land) {
  const soil = land?.soil || {};
  const region = land?.region === 'west' ? 'west' : 'east';
  const cards = [];
  const band = phBand(soil.ph, region);
  if (band) cards.push({ topic: 'ph', noun: nounFor.ph, value: `${soil.ph}`, band, bandLabel: PH_BANDS[band].label, ...PH_BANDS[band], summary: PH_BANDS[band].summary(region) });
  const organicBand = omBand(soil.om);
  if (organicBand) cards.push({ topic: 'organic_matter', noun: nounFor.organic_matter, value: `${soil.om}%`, band: organicBand, bandLabel: OM_BANDS[organicBand].label, ...OM_BANDS[organicBand], summary: OM_BANDS[organicBand].summary() });
  const group = textureGroup(soil.texture);
  if (group) cards.push({ topic: 'texture', noun: nounFor.texture, value: TEXTURE_LABEL[soil.texture].toLowerCase(), band: group, bandLabel: TEXTURE_FAMILIES[group].label, ...TEXTURE_FAMILIES[group], summary: TEXTURE_FAMILIES[group].summary() });
  const drainageGroup = drainageFamily(soil.drainage);
  if (drainageGroup) cards.push({ topic: 'drainage', noun: nounFor.drainage, value: DRAINAGE_LABEL[soil.drainage].replace(/\s*\(.*\)/, '').toLowerCase(), band: drainageGroup, bandLabel: DRAINAGE_FAMILIES[drainageGroup].label, ...DRAINAGE_FAMILIES[drainageGroup], summary: DRAINAGE_FAMILIES[drainageGroup].summary() });
  const slopeRange = slopeBand(soil.slopePct);
  if (slopeRange) cards.push({ topic: 'slope', noun: nounFor.slope, value: `${soil.slopePct}%`, band: slopeRange, bandLabel: SLOPE_BANDS[slopeRange].label, ...SLOPE_BANDS[slopeRange], summary: SLOPE_BANDS[slopeRange].summary() });
  return cards;
}

const GENERAL = {
  ph: 'pH measures how acidic or alkaline soil is on a scale where 7 is neutral. Each whole number is a ten-fold change, so pH 5 is ten times more acidic than pH 6. Most crops do best near neutral (K-State: closer to 6.5 to 7.5), because pH controls which nutrients plants can actually take up.',
  organic_matter: 'Organic matter is decayed plant and animal material in the soil. It holds water and nutrients, feeds soil life and glues soil particles into crumbs. It builds slowly and is lost quickly by tillage and bare ground.',
  texture: 'Texture is the mix of sand, silt and clay. Sand drains fast and holds little; clay holds a lot and drains slowly; loams sit in between. You cannot change texture, so you plan around it.',
  drainage: 'Drainage class comes from the soil survey and describes how quickly water leaves the soil. It decides how soon fields can be worked, whether roots get air after rain, and how muddy a pasture gets.',
  slope: 'Slope is the rise per 100 feet of run, in percent. A 3 percent slope rises 3 feet over 100 feet. Slope controls how fast water runs off and how much soil it carries.',
};

const fmtTol = () => Object.values(CROPS).filter((c) => c.soil.phHighTolerant).map((c) => c.label);

function appUseText(topic, land) {
  const soil = land?.soil || {};
  const region = land?.region === 'west' ? 'west' : 'east';
  const lines = [];
  if (topic === 'ph') {
    if (!Number.isFinite(soil.ph)) return 'Add your pH to see how it changes each crop\'s score.';
    for (const c of Object.values(CROPS)) {
      const f = phFactor(soil.ph, { legume: c.legume, region, highTolerant: c.soil.phHighTolerant });
      lines.push(`${c.label} ${formatNumber(f.f * 100)}`);
    }
    return `pH score out of 100 for each crop at pH ${soil.ph}: ${lines.join(', ')}. Crops this app treats as more tolerant of high pH: ${fmtTol().join(', ')}.`;
  }
  if (topic === 'texture') {
    const group = textureGroup(soil.texture);
    if (!group) return 'Add your texture to see how it changes each crop\'s score.';
    return `Texture score out of 100 for a ${group} soil: ${Object.values(CROPS).map((c) => `${c.label} ${formatNumber(c.soil.texture[group] * 100)}`).join(', ')}.`;
  }
  if (topic === 'drainage') {
    if (!soil.drainage) return 'Add your drainage class to see how it changes each crop\'s score.';
    return `Drainage score out of 100 for ${DRAINAGE_LABEL[soil.drainage].toLowerCase()}: ${Object.values(CROPS).map((c) => `${c.label} ${formatNumber((c.soil.drainage[soil.drainage] ?? 0.85) * 100)}`).join(', ')}.`;
  }
  if (topic === 'slope') {
    if (!Number.isFinite(soil.slopePct)) return 'Add your slope to see how it changes each crop\'s score.';
    const f = (c) => { for (const [max, v] of c.soil.slopeBreaks) if (soil.slopePct <= max) return v; return c.soil.slopeBreaks.at(-1)[1]; };
    return `Slope score out of 100 at ${soil.slopePct}%: ${Object.values(CROPS).map((c) => `${c.label} ${formatNumber(f(c) * 100)}`).join(', ')}.`;
  }
  return 'Organic matter is shown as a number on the Land tab and darkens the soil in the 3D view; it does not change a crop score in this version.';
}

function pastureAcres(context) {
  const evaluation = context.evaluation;
  const l = evaluation?.livestock?.find((x) => getLivestock(x.item).method === 'forage' && x.acres > 0);
  if (l) return { acres: l.acres, from: 'your plan' };
  const usable = usableAcres(context.land, context.assumptions || DEFAULT_ASSUMPTIONS);
  return { acres: usable >= 5 ? usable : 40, from: usable >= 5 ? 'your usable land' : 'an example' };
}

export function lessonFor(topic, context) {
  const land = context.land || {};
  const soil = land.soil || {};
  const region = land.region === 'west' ? 'west' : 'east';
  const cards = factorCards(land);
  const card = cards.find((c) => c.topic === topic);
  const facts = [];
  const sections = [];
  const takeaways = [];
  const missing = [];

  if (['ph', 'organic_matter', 'texture', 'drainage', 'slope'].includes(topic)) {
    const known = { ph: soil.ph != null, organic_matter: soil.om != null, texture: !!soil.texture, drainage: !!soil.drainage, slope: soil.slopePct != null }[topic];
    facts.push({ label: TOPIC_LABEL[topic], value: card ? `${card.value} (${card.bandLabel})` : 'not entered yet', known: !!card });
    if (!known) missing.push(topic);
    sections.push({ heading: 'What it is', body: GENERAL[topic] });
    if (card) {
      sections.push({ heading: 'What your number means', body: `Your ${card.noun} is ${card.value}, which is ${card.bandLabel}. ${card.summary}` });
      sections.push({ heading: 'Benefits for your field', body: card.benefit });
      sections.push({ heading: 'Limits and what to do', body: `${card.limit} ${card.manage}` });
      takeaways.push(`Benefit: ${card.benefit}`, `Limit: ${card.limit}`);
    } else {
      sections.push({ heading: 'Your number', body: 'You have not entered this yet. Use "Get soil data for my land" on the Land tab, or type it in from a soil test. The lesson and the quiz will then use your own value.' });
    }
    if (topic === 'ph' && card) {
      const advice = limeAdvice(soil.ph, { legume: false, region });
      const legumeAdvice = limeAdvice(soil.ph, { legume: true, region });
      sections.push({ heading: 'Lime check', body: `Non-legumes (wheat, corn, sorghum, grass): ${advice.text} Legumes (alfalfa, soybeans): ${legumeAdvice.text}` });
    }
    sections.push({ heading: 'How this app uses it', body: appUseText(topic, land) });
    return { topic, title: TOPIC_LABEL[topic], facts, sections, takeaways, missing };
  }

  if (topic === 'stocking') {
    const { acres, from } = pastureAcres(context);
    const forage = pastureForageLbPerAc(soil, region);
    const rotational = stockingCapacity('beef', acres, { soil, region, grazing: 'rotational', forageLbPerAcOverride: forage });
    const continuous = stockingCapacity('beef', acres, { soil, region, grazing: 'continuous', forageLbPerAcOverride: forage });
    facts.push({ label: 'Pasture forage on your soil', value: `${formatNumber(forage)} lb per acre per year`, known: Number.isFinite(soil.ph) || !!soil.drainage });
    facts.push({ label: 'Acres used in this lesson', value: `${formatNumber(acres, 1)} (${from})`, known: true });
    sections.push(
      { heading: 'The idea', body: 'Carrying capacity is the number of animals a pasture can feed for a year without being overgrazed. Forage animals (cattle, sheep, goats, horses) are limited by how much grass grows. Hogs and poultry are limited mostly by space and manure, so the app uses published animals-per-acre figures for them.' },
      { heading: 'The math with your numbers', body: `${formatNumber(acres, 1)} acres x ${formatNumber(forage)} lb forage per acre = ${formatNumber(acres * forage)} lb grown. Rotational grazing lets animals eat about 40 percent of it (the rest is trampled or left to regrow): ${formatNumber(rotational.supplyLbPerYr)} lb. A cow with calf eats about ${formatNumber(getLivestock('beef').forageLbPerYr)} lb a year, so the pasture carries ${rotational.maxHeads} pairs. Season-long grazing uses only 25 percent, which carries ${continuous.maxHeads}.` },
      { heading: 'Why start below the maximum', body: `The app suggests starting at ${Math.round(DEFAULT_ASSUMPTIONS.startFraction * 100)} percent of the maximum. That is a planning assumption, not a law: it leaves room for a dry year, lets you learn the land, and avoids overgrazing. You can change it in Settings.` },
      { heading: 'Limits of the estimate', body: 'Pasture growth here is a range scaled by soil fit, not a measurement of your pasture. A real stocking plan should also use your forage species, rainfall, and an extension agent\'s advice.' },
    );
    takeaways.push('Capacity = acres x forage x share eaten / forage one animal needs.', 'Rotating paddocks lets more of the grass be used.', 'Start below the maximum and learn the land.');
    return { topic, title: TOPIC_LABEL[topic], facts, sections, takeaways, missing };
  }

  if (topic === 'crops') {
    const rank = rankOptions(land, context.overrides || {}, context.assumptions || {});
    const best = [...rank.crops].filter((c) => c.id !== 'hay').sort((a, b) => b.fit - a.fit)[0];
    const worst = [...rank.crops].sort((a, b) => a.fit - b.fit)[0];
    facts.push({ label: 'Best-fitting crop', value: best ? `${best.label} (${best.fit}/100)` : '-', known: true });
    facts.push({ label: 'Weakest fit', value: worst ? `${worst.label} (${worst.fit}/100)` : '-', known: true });
    sections.push(
      { heading: 'How fit is scored', body: 'Each crop gets a 0 to 100 score from five soil facts: pH (30 percent), drainage (28), slope (16), texture (14) and depth (12). The score blends a weighted average with the single worst factor, so one serious problem pulls the score down instead of being averaged away. Unknown facts are treated as slightly below average and lower the confidence.' },
      { heading: 'Your land', body: best ? `On your numbers ${best.label} fits best${best.limiting ? `; its biggest limit is ${best.limiting.toLowerCase()}` : ''}. ${worst.label} fits worst${worst.limiting ? `, held back by ${worst.limiting.toLowerCase()}` : ''}.` : 'Add soil facts on the Land tab to rank the crops.' },
      { heading: 'From fit to yield', body: 'Expected yield starts from the Kansas state average (the last two years, from USDA NASS) and is multiplied by a factor between 0.4 and 1.1 that rises with fit. A poor match can cut expected yield by more than half.' },
    );
    takeaways.push('The weakest soil factor matters most.', 'Expected yield = state average x soil-fit factor.');
    return { topic, title: TOPIC_LABEL[topic], facts, sections, takeaways, missing };
  }

  if (topic === 'water') {
    const heads = context.evaluation?.livestock?.length ? context.evaluation.livestock : null;
    const rows = Object.values(LIVESTOCK).map((s) => `${s.label} ${s.waterGal.typical} gal normally and ${s.waterGal.hot} gal on a hot day`);
    facts.push({ label: 'Water source', value: land.waterSource || 'not entered', known: !!land.waterSource });
    if (!land.waterSource) missing.push('water');
    sections.push(
      { heading: 'Why it matters', body: 'Animals drink far more in heat. Cattle in this app use about 1.63 times as much at 90 degrees F as at 70 (NDSU). A pasture with grass but no dependable water cannot be stocked.' },
      { heading: 'Per animal, per day', body: `${rows.join('; ')}.` },
      { heading: 'Your plan', body: heads ? `Your selected plan needs about ${formatNumber(context.evaluation.water.typical)} gallons a day normally and ${formatNumber(context.evaluation.water.hot)} gallons on a hot day.` : 'Add animals to a plan to see the daily water you must supply.' },
      { heading: 'Cautions', body: 'Ponds can dry up or turn toxic in a hot, dry summer, so plan a backup tank. Tanks and pipes also need winter protection.' },
    );
    takeaways.push('Plan water for the hottest day, not the average one.', 'Every pasture needs a dependable source.');
    return { topic, title: TOPIC_LABEL[topic], facts, sections, takeaways, missing };
  }

  if (topic === 'fencing') {
    const perim = land.boundary?.length >= 3 ? toFeet(polygonPerimeter(land.boundary)) : null;
    facts.push({ label: 'Boundary length', value: perim ? `${formatNumber(perim)} ft` : 'draw your land first', known: !!perim });
    if (!perim) missing.push('boundary');
    const lines = Object.values(FENCES).map((f) => `${f.label}: $${fenceCostPerFt(f.id, context.overrides || {}).toFixed(2)} per foot`);
    sections.push(
      { heading: 'Matching the fence to the animal', body: 'Cattle and horses turn back from barbed or high-tensile wire; sheep, goats and hogs need woven wire or netting because they push through or under loose strands; poultry need netting or a tight woven wire. The app warns you when a fence is a poor match for an animal in the plan.' },
      { heading: 'Installed cost per foot', body: `${lines.join('; ')}. Wire and posts are from Missouri Extension (January 2024) and cross-checked against a K-State 2023 survey, which came in lower; netting and gates are starter estimates.` },
      { heading: 'Your boundary', body: perim ? `Your boundary is about ${formatNumber(perim)} feet. Fenced with 5-strand barbed wire at $${fenceCostPerFt('barbed5', context.overrides || {}).toFixed(2)} per foot that is about ${dollars(perim * fenceCostPerFt('barbed5', context.overrides || {}))} before gates. Dividing a pasture into paddocks with cheap electric fence adds fence but lets the grass rest.` : 'Draw your boundary to see the cost.' },
    );
    takeaways.push('Pick the fence for the animal, not just the price.', 'Perimeter length drives cost; squarer shapes need less fence.');
    return { topic, title: TOPIC_LABEL[topic], facts, sections, takeaways, missing };
  }

  const evaluation = context.evaluation;
  facts.push({ label: 'Net per year (typical)', value: evaluation ? dollars(evaluation.money.net.base) : 'no plan selected', known: !!evaluation });
  facts.push({ label: 'Share of dollars on starter prices', value: evaluation ? `${Math.round(evaluation.basis.starterShare * 100)}%` : '-', known: !!evaluation });
  sections.push(
    { heading: 'Where the dollars come from', body: 'Revenue is animals sold or products made plus crop yield times price. Costs are feed, seed, fertilizer, vet, and per-head or per-acre expenses. Start-up cost is animals, shelters and fence, paid once.' },
    { heading: 'Starter prices', body: 'Most prices and costs in this app are starter estimates, not published figures. They make the math run and help you COMPARE plans, but a profit number is only as good as the prices behind it. Replace them in Settings with current quotes or a K-State farm management budget.' },
    { heading: 'Risk', body: 'The risk score (0 is calm) combines how much crop yields swing between the last two Kansas years, how well the soil fits, how much of the soil data is guessed, overstocking and missing water. A plan that earns slightly less but swings far less may be the better choice for a first year.' },
    { heading: 'What if prices fall?', body: 'The Compare tab lets you drop product prices or raise costs by up to 40 percent to see which plan survives a bad year.' },
  );
  takeaways.push('Compare plans on the same prices.', 'Always ask how a plan does in a bad year.');
  return { topic, title: TOPIC_LABEL[topic], facts, sections, takeaways, missing };
}

function shuffle(list, random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function finalize(q, random) {
  const wrong = [...new Set(q.wrong.filter((w) => w !== q.correct))];
  if (wrong.length < 2) return null;
  const options = shuffle([q.correct, ...shuffle(wrong, random).slice(0, 3)], random);
  return { prompt: q.prompt, options, correctIndex: options.indexOf(q.correct), explanation: q.explanation, topic: q.topic, kind: q.kind, difficulty: q.difficulty || 'advanced', personal: !!q.personal };
}

function wrongNumbers(correct, candidates, show) {
  const out = [];
  const seen = new Set([show(correct)]);
  for (const c of candidates) {
    const s = show(c);
    if (Number.isFinite(c) && c >= 0 && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  let bump = 1;
  while (out.length < 3 && bump < 30) {
    const c = correct + bump * Math.max(1, Math.round(correct * 0.12));
    const s = show(c);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
    bump++;
  }
  return out;
}

function benefitQ(card) {
  return {
    topic: card.topic, kind: 'benefit', personal: true,
    prompt: `Your ${card.noun} is ${card.value}, which is ${card.bandLabel}. Which statement is a real BENEFIT of that for your field?`,
    correct: card.benefit,
    wrong: card.wrongBenefits,
    explanation: `${card.summary} The flip side: ${card.limit}`,
  };
}
function limitQ(card) {
  return {
    topic: card.topic, kind: 'limitation', personal: true,
    prompt: `Your ${card.noun} is ${card.value}, which is ${card.bandLabel}. Which problem is MOST likely because of that?`,
    correct: card.limit,
    wrong: card.wrongLimits,
    explanation: `${card.summary} What to do: ${card.manage}`,
  };
}

function limeQ(context, random) {
  const soil = context.land?.soil || {};
  if (!Number.isFinite(soil.ph)) return null;
  const region = context.land.region === 'west' ? 'west' : 'east';
  const legume = random() < 0.5;
  const advice = limeAdvice(soil.ph, { legume, region });
  const word = legume ? 'a legume such as alfalfa or soybeans' : 'a grain or grass crop such as wheat, corn or sorghum';
  const needs = 'Get a buffer-pH test and plan lime, because pH is below the K-State trigger.';
  const skips = 'Skip lime: the pH is at or above the K-State trigger.';
  return {
    topic: 'ph', kind: 'calculation', personal: true,
    prompt: `K-State's lime trigger for ${word} in ${region === 'west' ? 'western' : 'eastern'} Kansas is pH ${advice.trigger}. Your soil pH is ${soil.ph}. What should you do about lime?`,
    correct: advice.needed ? needs : skips,
    wrong: [advice.needed ? skips : needs, 'Apply lime every year no matter what the pH is.', 'Add sulfur to push the pH as high as possible.'],
    explanation: advice.text,
  };
}

function stockingQ(context) {
  const soil = context.land?.soil || {};
  const region = context.land?.region === 'west' ? 'west' : 'east';
  const usable = usableAcres(context.land, context.assumptions || DEFAULT_ASSUMPTIONS);
  const acres = usable >= 10 && usable <= 200 ? Math.round(usable) : 40;
  const forage = pastureForageLbPerAc(soil, region);
  const right = stockingCapacity('beef', acres, { forageLbPerAcOverride: forage, grazing: 'rotational' }).maxHeads;
  const supply = acres * forage;
  const show = (n) => `${formatNumber(n)} pairs`;
  return {
    topic: 'stocking', kind: 'calculation', personal: Number.isFinite(soil.ph) || !!soil.drainage,
    prompt: `Imagine ${acres} acres of pasture on soil like yours, growing about ${formatNumber(forage)} lb of forage per acre per year. With rotational grazing the animals eat 40 percent of it, and one cow-calf pair needs ${formatNumber(getLivestock('beef').forageLbPerYr)} lb a year. What is the most pairs it can carry?`,
    correct: show(right),
    wrong: wrongNumbers(right, [Math.floor(supply / 9490), Math.floor((supply * 0.25) / 9490), Math.floor((supply * 0.4) / 1898), Math.floor((supply * 0.4) / 949)], show),
    explanation: `${acres} x ${formatNumber(forage)} = ${formatNumber(supply)} lb grown. x 0.40 = ${formatNumber(supply * 0.4)} lb eaten. / ${formatNumber(getLivestock('beef').forageLbPerYr)} = ${right} pairs (rounded down). Forgetting the 40 percent, or using season-long's 25 percent, gives the wrong answer.`,
  };
}

function waterQ(context) {
  const l = context.evaluation?.livestock?.find((x) => x.item === 'beef');
  const heads = l && l.heads >= 5 ? l.heads : 20;
  const hot = waterNeed('beef', heads, true);
  const normal = waterNeed('beef', heads, false);
  const show = (n) => `${formatNumber(n)} gallons a day`;
  return {
    topic: 'water', kind: 'calculation', personal: !!l,
    prompt: `${heads} cow-calf pairs are on pasture on a 90 degree day. The app uses 23.6 gallons per pair on a hot day (14.5 on a normal day). About how much water must you supply?`,
    correct: show(hot),
    wrong: wrongNumbers(hot, [normal, hot / 10, hot * 2, heads * 8.2], show),
    explanation: `${heads} x 23.6 = ${formatNumber(hot)} gallons. Using the normal-day figure (${formatNumber(normal)}) would leave the herd short on the hottest day.`,
  };
}

function fenceQ(context) {
  const b = context.land?.boundary;
  if (!(b?.length >= 3)) return null;
  const feet = toFeet(polygonPerimeter(b));
  const round10 = (n) => Math.round(n / 10) * 10;
  const price = fenceCostPerFt('barbed5', context.overrides || {});
  const right = round10(feet * price);
  const show = (n) => dollars(n);
  return {
    topic: 'fencing', kind: 'calculation', personal: true,
    prompt: `Your boundary is about ${formatNumber(feet)} feet around. 5-strand barbed wire installs at about $${price.toFixed(2)} per foot (Missouri Extension, January 2024, before gates). About what would fencing the whole boundary cost?`,
    correct: show(right),
    wrong: wrongNumbers(right, [round10(feet * fenceCostPerFt('woven47', context.overrides || {})), round10(feet * fenceCostPerFt('electric2', context.overrides || {})), round10((feet / 3.28) * price), round10(feet * price * 2)], show),
    explanation: `${formatNumber(feet)} ft x $${price.toFixed(2)} = ${dollars(feet * price)}, about ${dollars(right)}. Using meters instead of feet, or the wrong fence type, changes the answer a lot.`,
  };
}

function yieldQ(context) {
  const soil = context.land?.soil || {};
  const region = context.land?.region === 'west' ? 'west' : 'east';
  if (!Number.isFinite(soil.ph) && !soil.drainage && !soil.texture) return null;
  const pickId = ['corn', 'soybeans', 'wheat', 'sorghum']
    .map((id) => ({ id, fit: cropSoilFit(id, soil, region).fit }))
    .sort((a, b) => b.fit - a.fit)[0].id;
  const c = CROPS[pickId];
  const estimate = cropEstimate(pickId, 1, soil, { region, overrides: context.overrides || {} });
  const right = Math.round(estimate.yield.base.perAcre * 10) / 10;
  const show = (n) => `${formatNumber(n, 1)} ${c.unit} per acre`;
  return {
    topic: 'crops', kind: 'calculation', personal: true,
    prompt: `The Kansas state average ${c.label.toLowerCase()} yield over the last two years is about ${formatNumber(c.yieldBase, 1)} ${c.unit} per acre. This app multiplies it by a soil-fit factor from 0.4 to 1.1. For your soil the factor for ${c.label.toLowerCase()} is ${estimate.multiplier.toFixed(2)}. What yield per acre does it expect on your land in a typical year?`,
    correct: show(right),
    wrong: wrongNumbers(right, [Math.round((c.yieldBase / estimate.multiplier) * 10) / 10, Math.round(c.yieldLow * estimate.multiplier * 10) / 10, Math.round(c.yieldHigh * estimate.multiplier * 10) / 10, c.yieldBase * (1 - estimate.multiplier)], show),
    explanation: `${formatNumber(c.yieldBase, 1)} x ${estimate.multiplier.toFixed(2)} = ${formatNumber(right, 1)} ${c.unit}. Dividing by the factor, or using only the low or high year, answers a different question.`,
  };
}

const POOR_FOR_SHEEP = Object.entries(getLivestock('sheep').fenceFit).filter(([, v]) => v === 'poor').map(([k]) => k);
const NOT_POOR_FOR_SHEEP = Object.entries(getLivestock('sheep').fenceFit).filter(([, v]) => v !== 'poor').map(([k]) => FENCES[k].label);
const TOLERANT = Object.values(CROPS).filter((c) => c.soil.phHighTolerant).map((c) => c.label);
const INTOLERANT = Object.values(CROPS).filter((c) => !c.soil.phHighTolerant).map((c) => c.label);
const listText = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);

const CONCEPTS = [
  { topic: 'ph', difficulty: 'basic', prompt: 'Compared with a soil at pH 6, a soil at pH 5 is...', correct: 'ten times more acidic', wrong: ['twice as acidic', 'ten times more alkaline', 'the same, because the scale is not exact'], explanation: 'The pH scale is logarithmic: every whole number is a ten-fold change.' },
  { topic: 'ph', difficulty: 'advanced', prompt: 'What does a buffer-pH test tell you that an ordinary soil pH test does not?', correct: 'How much lime to apply', wrong: ['How much nitrogen is in the soil', 'Which weeds are present', 'How much organic matter the soil has'], explanation: 'pH says whether lime is needed; the buffer-pH test measures how hard the soil resists change, which sets the lime rate (K-State).' },
  { topic: 'ph', difficulty: 'advanced', prompt: 'Which crops does this app treat as MORE tolerant of high-pH soil?', correct: listText(TOLERANT), wrong: [listText(INTOLERANT), `${INTOLERANT[0]} only`, 'None: all crops are equally tolerant'], explanation: 'Rule-of-thumb tolerance flags in the crop table: alfalfa, grain sorghum and grass hay lose less than corn, wheat or soybeans on alkaline soil.' },
  { topic: 'ph', difficulty: 'advanced', prompt: 'In eastern Kansas K-State\'s lime trigger is 6.4 for legumes and 6.0 for other crops. Which crop is in the higher-trigger group?', correct: 'Alfalfa', wrong: ['Winter wheat', 'Corn', 'Grain sorghum'], explanation: 'Legumes (alfalfa, soybeans) are more sensitive to acid soil, so they have the higher trigger.' },
  { topic: 'organic_matter', difficulty: 'basic', prompt: 'What is the main job of organic matter in a soil?', correct: 'It holds water and nutrients and glues soil into crumbs.', wrong: ['It makes soil more acidic.', 'It replaces the need for any water.', 'It makes soil coarser.'], explanation: 'Organic matter improves water holding, nutrient supply and structure.' },
  { topic: 'texture', difficulty: 'basic', prompt: 'Which texture holds the most water but drains slowest?', correct: 'Clay', wrong: ['Sand', 'Loamy sand', 'Sandy loam'], explanation: 'Clay has tiny pores that hold water tightly, so it drains slowly and can stay wet.' },
  { topic: 'drainage', difficulty: 'advanced', prompt: 'Besides slow crop growth, why is a poorly drained pasture a problem for cattle and sheep?', correct: 'Mud and constantly wet hooves make foot problems more likely.', wrong: ['Wet soil makes grass poisonous.', 'Animals cannot drink from wet ground.', 'Poorly drained soil has no nutrients.'], explanation: 'Constant wetness softens hooves and spreads foot problems; keep animals off soft pasture.' },
  { topic: 'slope', difficulty: 'advanced', prompt: 'On a 10 percent slope, which land use usually protects the soil best?', correct: 'Permanent grass or hay', wrong: ['Tilled row crops planted up and down the hill', 'Bare fallow ground', 'Corn with no residue left'], explanation: 'Permanent cover slows runoff and holds soil; row crops on steep slopes lose soil quickly.' },
  { topic: 'stocking', difficulty: 'basic', prompt: 'Why can rotational grazing carry more animals than season-long grazing in this app?', correct: 'Pasture gets rest to regrow and less forage is trampled, so 40 percent is used instead of 25 percent.', wrong: ['Animals eat less grass when they move.', 'Rotation makes grass grow twice as fast.', 'The law allows more animals under rotation.'], explanation: 'The app uses a 40 percent utilization for rotational and 25 percent for season-long grazing (planning assumptions).' },
  { topic: 'stocking', difficulty: 'advanced', prompt: 'What is an animal unit (AU) in the stocking math?', correct: 'A cow with calf, which eats about 26 lb of forage a day (1.00 AU)', wrong: ['One acre of pasture', 'The number of animals one fence can hold', 'A measure of how long a fence is'], explanation: 'Animal units let you compare species: the app uses 0.20 AU for a ewe, 0.15 for a doe and 1.25 for a horse.' },
  { topic: 'stocking', difficulty: 'advanced', prompt: 'Why does the app suggest starting with 75 percent of the calculated maximum herd?', correct: 'It leaves room for a dry year and lets you learn the land (a planning assumption).', wrong: ['Animals eat 25 percent less in their first year.', 'The law requires it.', 'The maximum is always 25 percent too high.'], explanation: 'It is a planning assumption you can change in Settings, not a fixed rule.' },
  { topic: 'fencing', difficulty: 'advanced', prompt: 'Which fence does this app rate a POOR choice for sheep?', correct: FENCES[POOR_FOR_SHEEP[0] || 'barbed5'].label, wrong: NOT_POOR_FOR_SHEEP, explanation: 'Sheep and goats push through or under loose strands; woven wire and netting hold them.' },
  { topic: 'water', difficulty: 'advanced', prompt: 'Why do you size a stock-water system for the hottest day?', correct: 'Animals drink much more in heat; cattle drink about 1.6 times as much at 90 F as at 70 F.', wrong: ['Water freezes faster in summer.', 'Animals drink the same all year.', 'Hot days only matter for horses.'], explanation: 'A system sized for the average day runs dry exactly when animals need it most.' },
  { topic: 'economics', difficulty: 'basic', prompt: 'What does a "Starter estimate" badge on a price mean?', correct: 'It is a placeholder, not a published figure; replace it with a real quote.', wrong: ['It is the official K-State price.', 'It is guaranteed to be the market price.', 'It means the number is too high.'], explanation: 'Starter prices keep the math running; Settings lets you replace them.' },
  { topic: 'economics', difficulty: 'advanced', prompt: 'Why does the app show a low, typical and high net per year for crops?', correct: 'Kansas yields differ between a weaker and a stronger year, which changes profit.', wrong: ['The app cannot decide on one price.', 'Taxes change each month.', 'Low and high are random numbers.'], explanation: 'Low and high use the weaker and stronger of the last two Kansas state yields, scaled by your soil fit.' },
  { topic: 'crops', difficulty: 'advanced', prompt: 'Why can the expected yield on your land be lower than the Kansas average?', correct: 'The app scales the state average by a soil-fit factor, so a poor match lowers it.', wrong: ['Kansas averages never apply to small farms.', 'Yield depends only on price.', 'The app subtracts a fixed amount every time.'], explanation: 'Yield = state average x a factor from 0.4 to 1.1 based on how well your soil fits the crop.' },
];

export function buildQuiz(context, { count = 8, level = 'advanced', topics = null, weakTopics = {}, seed = Date.now() } = {}) {
  const random = seededRng(Number(seed) % 2147483647 || 1);
  const want = (t) => !topics || topics.includes(t);
  const cards = factorCards(context.land).filter((c) => want(c.topic));
  const pool = [];
  if (level !== 'basic') {
    for (const c of cards) pool.push(benefitQ(c), limitQ(c));
    for (const f of [limeQ, stockingQ, waterQ, fenceQ, yieldQ]) {
      const q = f(context, random);
      if (q && want(q.topic)) pool.push(q);
    }
  }
  const concept = (c) => ({ ...c, kind: 'concept' });
  const chosen = new Set();
  for (const c of CONCEPTS) {
    if (!want(c.topic)) continue;
    if (level === 'basic' ? c.difficulty === 'basic' || random() < 0.5 : c.difficulty === 'advanced' || random() < 0.25) {
      pool.push(concept(c));
      chosen.add(c);
    }
  }
  if (pool.length < Math.min(count, 3)) {
    for (const c of CONCEPTS) if (want(c.topic) && !chosen.has(c)) pool.push(concept(c));
  }
  const weak = (t) => weakTopics?.[t] || 0;
  const ordered = shuffle(pool, random).sort((a, b) => weak(b.topic) - weak(a.topic) || Number(!!b.personal) - Number(!!a.personal));
  const picked = [];
  const perTopic = {};
  const limit = Math.max(2, Math.ceil(count / Math.max(1, new Set(ordered.map((q) => q.topic)).size)) + 1);
  for (const q of ordered) {
    if ((perTopic[q.topic] || 0) >= limit) continue;
    picked.push(q);
    perTopic[q.topic] = (perTopic[q.topic] || 0) + 1;
    if (picked.length >= count) break;
  }
  for (const q of ordered) {
    if (picked.length >= count) break;
    if (!picked.includes(q)) picked.push(q);
  }
  const questions = shuffle(picked, random).map((q) => finalize(q, random)).filter(Boolean);
  const soil = context.land?.soil || {};
  const missing = [];
  if (!Number.isFinite(soil.ph)) missing.push('pH');
  if (!Number.isFinite(soil.om)) missing.push('organic matter');
  if (!soil.texture) missing.push('texture');
  if (!soil.drainage) missing.push('drainage');
  if (!Number.isFinite(soil.slopePct)) missing.push('slope');
  return { questions, missing, personalCount: questions.filter((q) => q.personal).length };
}
