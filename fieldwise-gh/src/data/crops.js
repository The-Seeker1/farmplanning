const mean = (a, b) => Math.round(((a + b) / 2) * 1000) / 1000;

function yields(y2023, y2024) {
  return {
    yieldLow: Math.min(y2023, y2024),
    yieldHigh: Math.max(y2023, y2024),
    yieldBase: mean(y2023, y2024),
  };
}

const DRAINAGE_STD = { excessive: 0.75, well: 1, moderate: 1, somewhat_poor: 0.7, poor: 0.35, very_poor: 0.1 };

export const CROPS = {
  wheat: {
    id: 'wheat',
    label: 'Winter wheat',
    unit: 'bu',
    ...yields(35, 43),
    srcYield: 'nass_wheat',
    legume: false,
    price: 5.5,
    costPerAcre: 180,
    srcEcon: 'starter',
    planting: {
      z3: 'Sep 25 - Oct 20',
      z4: 'Oct 5 - Oct 25',
      seeding: '60-75 lb seed/acre in eastern Kansas (over 30 in. of rain)',
    },
    srcPlanting: 'kstate_planting',
    soil: {
      drainage: { ...DRAINAGE_STD, somewhat_poor: 0.8, poor: 0.45 },
      texture: { coarse: 0.65, medium: 1, fine: 0.9 },
      slopeBreaks: [[3, 1], [6, 0.85], [10, 0.6], [15, 0.35], [100, 0.15]],
      minDepthIn: 20,
      phHighTolerant: false,
    },
    srcSoil: 'rule',
  },
  corn: {
    id: 'corn',
    label: 'Corn',
    unit: 'bu',
    ...yields(119, 129),
    srcYield: 'nass_2024',
    legume: false,
    price: 4.2,
    costPerAcre: 430,
    srcEcon: 'starter',
    planting: {
      z3: 'Apr 1 - May 10',
      z4: 'Mar 25 - Apr 25',
      seeding: 'final stand 18,000-24,000 plants/acre (northeast); 16,000-20,000 (east central and southeast)',
    },
    srcPlanting: 'kstate_planting',
    soil: {
      drainage: DRAINAGE_STD,
      texture: { coarse: 0.55, medium: 1, fine: 0.85 },
      slopeBreaks: [[3, 1], [6, 0.85], [10, 0.55], [15, 0.3], [100, 0.1]],
      minDepthIn: 30,
      phHighTolerant: false,
    },
    srcSoil: 'rule',
  },
  soybeans: {
    id: 'soybeans',
    label: 'Soybeans',
    unit: 'bu',
    ...yields(26, 35),
    srcYield: 'nass_2024',
    legume: true,
    price: 10.0,
    costPerAcre: 200,
    srcEcon: 'starter',
    planting: {
      z3: 'May 5 - Jun 10',
      z4: 'May 10 - Jun 30 (the 1996 guide lists Jun 1-30 for the eastern half of Zone 4)',
      seeding: 'about 8 plants/ft in 30-inch rows (10 seeds/ft); cut 25% on droughty soils',
    },
    srcPlanting: 'kstate_planting',
    soil: {
      drainage: { ...DRAINAGE_STD, somewhat_poor: 0.75, poor: 0.4 },
      texture: { coarse: 0.6, medium: 1, fine: 0.9 },
      slopeBreaks: [[3, 1], [6, 0.85], [10, 0.6], [15, 0.35], [100, 0.12]],
      minDepthIn: 24,
      phHighTolerant: false,
    },
    srcSoil: 'rule',
  },
  sorghum: {
    id: 'sorghum',
    label: 'Grain sorghum',
    unit: 'bu',
    ...yields(52, 65),
    srcYield: 'nass_2024',
    legume: false,
    price: 4.0,
    costPerAcre: 240,
    srcEcon: 'starter',
    planting: {
      z3: 'May 15 - Jun 20',
      z4: 'May 1 - May 15 or Jun 5 - Jun 25',
      seeding: '70,000 plants/acre where rainfall is over 32 in.; 45,000 where it is 26-32 in.',
    },
    srcPlanting: 'kstate_planting',
    soil: {
      drainage: { ...DRAINAGE_STD, somewhat_poor: 0.75, poor: 0.4 },
      texture: { coarse: 0.8, medium: 1, fine: 0.95 },
      slopeBreaks: [[3, 1], [6, 0.9], [10, 0.65], [15, 0.4], [100, 0.15]],
      minDepthIn: 20,
      phHighTolerant: true,
    },
    srcSoil: 'rule',
  },
  alfalfa: {
    id: 'alfalfa',
    label: 'Alfalfa hay',
    unit: 'ton',
    ...yields(3.05, 2.65),
    srcYield: 'nass_2024',
    legume: true,
    price: 200,
    costPerAcre: 160,
    srcEcon: 'starter',
    planting: {
      z3: 'Fall: Aug 15 - Sep 10. Spring: Apr 10 - May 10',
      z4: 'Fall: Aug 15 - Sep 15. Spring: Apr 10 - May 10',
      seeding: '10-15 lb seed/acre in eastern Kansas',
    },
    srcPlanting: 'kstate_planting',
    soil: {
      drainage: { excessive: 0.7, well: 1, moderate: 0.9, somewhat_poor: 0.45, poor: 0.1, very_poor: 0 },
      texture: { coarse: 0.6, medium: 1, fine: 0.7 },
      slopeBreaks: [[3, 1], [6, 0.9], [10, 0.7], [15, 0.45], [100, 0.2]],
      minDepthIn: 36,
      phHighTolerant: true,
    },
    srcSoil: 'rule',
  },
  hay: {
    id: 'hay',
    label: 'Grass hay',
    unit: 'ton',
    ...yields(1.35, 1.5),
    srcYield: 'nass_2024',
    legume: false,
    price: 120,
    costPerAcre: 90,
    srcEcon: 'starter',
    planting: {
      z3: 'Cool-season grasses: fall; warm-season natives: Mar 15 - Apr 30',
      z4: 'Cool-season grasses: fall; warm-season natives: Mar 15 - Apr 30',
      seeding: 'smooth brome 10-15 lb/acre; tall fescue 15-20 lb/acre (eastern Kansas)',
    },
    srcPlanting: 'kstate_planting',
    soil: {
      drainage: { ...DRAINAGE_STD, somewhat_poor: 0.85, poor: 0.55, very_poor: 0.25 },
      texture: { coarse: 0.65, medium: 1, fine: 0.95 },
      slopeBreaks: [[3, 1], [6, 0.95], [10, 0.8], [15, 0.55], [100, 0.3]],
      minDepthIn: 12,
      phHighTolerant: true,
    },
    srcSoil: 'rule',
  },
};

export const CROP_IDS = Object.keys(CROPS);

export const PASTURE_PROFILE = {
  legume: false,
  soil: {
    drainage: { ...DRAINAGE_STD, excessive: 0.7, somewhat_poor: 0.85, poor: 0.55, very_poor: 0.25 },
    texture: { coarse: 0.65, medium: 1, fine: 0.95 },
    slopeBreaks: [[5, 1], [10, 0.95], [15, 0.85], [25, 0.65], [100, 0.4]],
    minDepthIn: 12,
    phHighTolerant: true,
  },
  src: 'rule',
};

export const PASTURE_FORAGE = {
  minTonsPerAc: 2,
  maxTonsPerAc: 5,
  src: 'hayforage_fescue',
  crosscheck: {
    src: 'sekarc_2008',
  },
};

export const VEGETABLES = {
  tomatoes: { id: 'tomatoes', label: 'Tomatoes', row: [36, 48], plant: [24, 36], per100: 100, unit: 'lb', price: 2.5 },
  sweetcorn: { id: 'sweetcorn', label: 'Sweet corn', row: [36, 36], plant: [8, 12], per100: 10, unit: 'dozen ears', price: 5 },
  bushbeans: { id: 'bushbeans', label: 'Bush beans', row: [36, 36], plant: [3, 5], per100: 120, unit: 'lb', price: 2.5 },
  polebeans: { id: 'polebeans', label: 'Pole beans', row: [48, 60], plant: [6, 12], per100: 150, unit: 'lb', price: 2.5 },
  peppers: { id: 'peppers', label: 'Peppers', row: [36, 36], plant: [12, 24], per100: 60, unit: 'lb', price: 3 },
  cucumbers: { id: 'cucumbers', label: 'Cucumbers', row: [48, 72], plant: [24, 24], per100: 120, unit: 'lb', price: 1.5 },
  summersquash: { id: 'summersquash', label: 'Summer squash', row: [48, 72], plant: [24, 24], per100: 150, unit: 'lb', price: 1.5 },
  wintersquash: { id: 'wintersquash', label: 'Winter squash', row: [96, 96], plant: [48, 60], per100: 100, unit: 'lb', price: 1 },
  potatoes: { id: 'potatoes', label: 'Potatoes', row: [36, 36], plant: [12, 12], per100: 100, unit: 'lb', price: 1 },
  onions: { id: 'onions', label: 'Onions', row: [12, 24], plant: [3, 4], per100: 100, unit: 'lb', price: 1.2 },
  lettuce: { id: 'lettuce', label: 'Lettuce (head)', row: [18, 24], plant: [4, 12], per100: 100, unit: 'heads', price: 2 },
  carrots: { id: 'carrots', label: 'Carrots', row: [18, 18], plant: [1, 2], per100: 100, unit: 'lb', price: 1.5 },
  pumpkins: { id: 'pumpkins', label: 'Pumpkins', row: [72, 90], plant: [48, 60], per100: 100, unit: 'lb', price: 0.5 },
  watermelon: { id: 'watermelon', label: 'Watermelon', row: [72, 90], plant: [48, 60], per100: 40, unit: 'fruit', price: 4 },
};
export const VEGETABLE_IDS = Object.keys(VEGETABLES);
export const SRC_VEGETABLE_SPACING = 'kstate_garden';
export const SRC_VEGETABLE_PRICE = 'starter';
export const GARDEN_COST_PER_SQFT = 0.15;

export function getCrop(id) {
  const c = CROPS[id];
  if (!c) throw new Error(`Unknown crop id: ${id}`);
  return c;
}

export const LIME_TRIGGER = {
  legume: { east: 6.4, west: 6.0 },
  nonlegume: { east: 6.0, west: 5.5 },
  srcLime: 'kstate_lime',
};

export const PH_THRESHOLDS = {
  aluminum: 5.2,
  carbonateLow: 7.8,
  carbonateHigh: 8.2,
  sodic: 8.5,
  neutralLow: 6.5,
  neutralHigh: 7.5,
  src: 'kstate_lime',
};
