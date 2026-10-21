export const FENCE_CROSSCHECK = {
  src: 'ksu_fence_2023',
  quarterSectionFeet: 10560,
  neMaterialsTotal: 13409.13,
  laborPerRod: 25.58,
  feetPerRod: 16.5,
  get materialsPerFt() {
    return this.neMaterialsTotal / this.quarterSectionFeet;
  },
  get laborPerFt() {
    return this.laborPerRod / this.feetPerRod;
  },
  get totalPerFt() {
    return this.materialsPerFt + this.laborPerFt;
  },
};

export const FENCES = {
  barbed5: {
    id: 'barbed5',
    label: '5-strand barbed wire',
    costPerFt: 3.55,
    postSpacingFt: 12,
    heightFt: 4.5,
    strands: 5,
    perimeter: true,
    srcCost: 'mu_fence',
    srcPost: 'ksu_fence_2023',
  },
  woven47: {
    id: 'woven47',
    label: '47-inch woven wire + top barbed wire',
    costPerFt: 4.09,
    postSpacingFt: 10,
    heightFt: 4.0,
    strands: 0,
    perimeter: true,
    srcCost: 'mu_fence',
    srcPost: 'mu_fence',
  },
  hightensile6: {
    id: 'hightensile6',
    label: '6-wire high tensile (12.5 gauge)',
    costPerFt: 2.86,
    postSpacingFt: 14.8,
    heightFt: 4.5,
    strands: 6,
    perimeter: true,
    srcCost: 'mu_fence',
    srcPost: 'mu_fence',
  },
  electric2: {
    id: 'electric2',
    label: '2-strand electric polywire (step-in posts)',
    costPerFt: 0.81,
    postSpacingFt: 33,
    heightFt: 3.0,
    strands: 2,
    perimeter: false,
    srcCost: 'mu_fence',
    srcPost: 'mu_fence',
  },
  netting: {
    id: 'netting',
    label: 'Electrified poultry netting',
    costPerFt: 2.0,
    postSpacingFt: 15,
    heightFt: 3.5,
    strands: 0,
    perimeter: false,
    srcCost: 'starter',
    srcPost: 'assume',
  },
};

export const GATE = { cost: 300, srcCost: 'starter' };

export const FENCE_IDS = Object.keys(FENCES);

export function getFence(id) {
  const f = FENCES[id];
  if (!f) throw new Error(`Unknown fence id: ${id}`);
  return f;
}
