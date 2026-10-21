export const SOURCES = {
  osu_au: {
    title: 'Estimating and measuring pasture productivity (EM 9552), Oregon State University Extension (Table 1 from the NRCS National Range and Pasture Handbook)',
    url: 'https://extension.oregonstate.edu/catalog/em-9552-estimating-measuring-pasture-productivity',
    confidence: 'sourced',
  },
  ndsu_water: {
    title: 'Livestock Water Requirements (AS1763, rev. 2021), NDSU Extension',
    url: 'https://www.ndsu.edu/agriculture/sites/default/files/2024-04/as1763.pdf',
    confidence: 'sourced',
  },
  ontario_water: {
    title: 'Water requirements of livestock, Ontario Ministry of Agriculture (OMAFRA)',
    url: 'https://www.ontario.ca/page/water-requirements-livestock',
    confidence: 'sourced',
  },
  eextension_goat_water: {
    title: 'Goat Nutrition: Water, eXtension Goats',
    url: 'https://goats.extension.org/goat-nutrition-water',
    confidence: 'sourced',
  },
  ncsu_hogs: {
    title: 'Designing pasture subdivisions for practical management of hogs (2015), NC State Center for Environmental Farming Systems',
    url: 'https://cefs.ncsu.edu/wp-content/uploads/designing-pasture-subdivisions-for-practical-management-of-hogs-2015.pdf',
    confidence: 'sourced',
  },
  ucanr_hogs: {
    title: 'Pasture-based swine management (341935), UC Agriculture and Natural Resources',
    url: 'https://ccfruitandnuts.ucanr.edu/sites/default/files/2020-12/341935.pdf',
    confidence: 'sourced',
  },
  hfac_poultry: {
    title: 'Free range, pasture raised officially defined (Certified Humane / HFAC definitions, 2014), The Poultry Site',
    url: 'https://www.thepoultrysite.com/news/2014/01/free-range-pasture-raised-officially-defined',
    confidence: 'sourced',
  },
  perennia_poultry: {
    title: 'Rotational grazing for poultry, Perennia (2025)',
    url: 'https://www.perennia.ca/wp-content/uploads/2025/06/Rotational-Grazing-PoultryV2.pdf',
    confidence: 'sourced',
  },
  kstate_horses: {
    title: 'Pasture Management for Horses (MF3634), K-State Research and Extension',
    url: 'https://bookstore.ksre.ksu.edu/download/pasture-management-for-horses_MF3634',
    confidence: 'sourced',
  },
  kstate_lime: {
    title: 'Liming Acid Soils (MF-1065), Whitney & Lamond, K-State Research and Extension (1993)',
    url: 'https://bookstore.ksre.ksu.edu/pubs/MF1065.pdf',
    confidence: 'sourced',
  },
  kstate_planting: {
    title: 'Kansas Crop Planting Guide (L-818), Shroyer et al., K-State Research and Extension (1996 - old, check current guidance)',
    url: 'https://bookstore.ksre.ksu.edu/download/kansas-crop-planting-guide_L818',
    confidence: 'sourced',
  },
  kstate_garden: {
    title: 'Vegetable Garden Planting Guide (MF315), K-State Research and Extension',
    url: 'https://bookstore.ksre.ksu.edu/download/vegetable-garden-planting-guide-revised_MF315',
    confidence: 'sourced',
  },
  nass_2024: {
    title: 'Kansas Crop Production Annual Summary, USDA NASS (released Jan 2025: 2024 yields; 2023 values derived from the reported year-over-year change)',
    url: 'https://data.nass.usda.gov/Statistics_by_State/Kansas/Publications/Crops_Releases/Annual_Summary/2025/KS-cropsum2501.pdf',
    confidence: 'derived',
  },
  nass_wheat: {
    title: 'Kansas Small Grains Summary, USDA NASS (Sept 30, 2024: winter wheat 43.0 bu/ac; 2023 value derived from the reported change)',
    url: 'https://nass.usda.gov/Statistics_by_State/Kansas/Publications/Crops_Releases/Small_Grain_Acreage_Production/KS-smgrn2409.pdf',
    confidence: 'derived',
  },
  ksu_fence_2023: {
    title: '2023 Fence Material and Construction Cost in Kansas, K-State Land Use Survey',
    url: 'https://www.agmanager.info/sites/default/files/pdf/2023_FenceSurvey.pdf',
    confidence: 'sourced',
  },
  mu_fence: {
    title: 'University of Missouri Extension G1193 - fence cost budgets (prices as of January 2024; post spacing derived from posts budgeted per 1,320 ft)',
    url: 'https://extension.missouri.edu/publications/g1193',
    confidence: 'derived',
  },
  sekarc_2008: {
    title: 'Report of Progress 996 (2008), K-State Southeast Agricultural Research Center (available forage in tall fescue and smooth bromegrass pastures)',
    url: 'https://extension.k-state.edu/historicpublications/pubs/SRP996.pdf',
    confidence: 'sourced',
  },
  hayforage_fescue: {
    title: "Double stocking fescue is 'low hanging fruit', Hay & Forage Grower (tall fescue yields 2-5 tons/acre; Flint Hills stocker rate 4 ac/steer for 180 days)",
    url: "https://hayandforage.com/article-3717-Double-stocking-fescue-is-'low-hanging-fruit'.html",
    confidence: 'sourced',
  },
  rule: {
    title: 'Agronomic rule of thumb compiled for this app (see docs/METHODS.md). Not a published index.',
    url: null,
    confidence: 'rule',
  },
  assume: {
    title: 'Planning assumption. Settings > Assumptions lists them all and lets you change the start-up share, projection years and roads/buildings share.',
    url: null,
    confidence: 'assume',
  },
  starter: {
    title: 'Starter estimate - NOT from a published source. Replace with your own quotes or a current K-State farm budget.',
    url: null,
    confidence: 'starter',
  },
};

export const CONFIDENCE_LABEL = {
  sourced: 'Published source',
  derived: 'Derived from a published source',
  rule: 'Rule of thumb',
  assume: 'Planning assumption',
  starter: 'Starter estimate (verify)',
};

export function sourceOf(id) {
  return SOURCES[id] || SOURCES.assume;
}
