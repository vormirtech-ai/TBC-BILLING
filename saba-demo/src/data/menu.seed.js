/**
 * The carte. Prices are in paise, which is why they all end in 00.
 *
 * Every item carries the two fields the kitchen cares about — `station`, which
 * decides whose printer the docket lands on, and `course`, which decides when
 * it is allowed to be cooked. Those are menu-engineering decisions, not
 * something a captain should have to remember at the table.
 */

export const CATEGORIES = [
  { id: 'mezze', label: 'Mezze', note: 'To begin, shared' },
  { id: 'tandoor', label: 'From the Coals', note: 'Charcoal & clay oven' },
  { id: 'mains', label: 'Main Course', note: 'Slow-cooked & stewed' },
  { id: 'rice', label: 'Rice & Breads', note: 'Alongside' },
  { id: 'dessert', label: 'Dessert', note: 'To finish' },
  { id: 'bar', label: 'Bar', note: 'Cocktails & wine' },
  { id: 'soft', label: 'Non-Alcoholic', note: 'Teas, sherbets, coffee' },
];

/** Reusable modifier groups. A group is offered on the items that reference it. */
export const MODIFIER_GROUPS = {
  doneness: {
    id: 'doneness', label: 'Doneness', required: true, max: 1,
    options: [
      { id: 'rare', label: 'Rare', deltaPaise: 0 },
      { id: 'mrare', label: 'Medium rare', deltaPaise: 0 },
      { id: 'medium', label: 'Medium', deltaPaise: 0 },
      { id: 'mwell', label: 'Medium well', deltaPaise: 0 },
      { id: 'well', label: 'Well done', deltaPaise: 0 },
    ],
  },
  spice: {
    id: 'spice', label: 'Heat', required: false, max: 1,
    options: [
      { id: 'mild', label: 'Mild', deltaPaise: 0 },
      { id: 'medium-heat', label: 'Medium', deltaPaise: 0 },
      { id: 'hot', label: 'Chef’s heat', deltaPaise: 0 },
    ],
  },
  portion: {
    id: 'portion', label: 'Portion', required: false, max: 1,
    options: [
      { id: 'half', label: 'Half portion', deltaPaise: -18000 },
      { id: 'sharing', label: 'Sharing platter', deltaPaise: 45000 },
    ],
  },
  extras: {
    id: 'extras', label: 'Add', required: false, max: 3,
    options: [
      { id: 'truffle', label: 'Shaved truffle', deltaPaise: 65000 },
      { id: 'labneh', label: 'Extra labneh', deltaPaise: 12000 },
      { id: 'sumac', label: 'Sumac onions', deltaPaise: 9000 },
      { id: 'bread', label: 'Extra khubz', deltaPaise: 8000 },
    ],
  },
  ice: {
    id: 'ice', label: 'Serve', required: false, max: 1,
    options: [
      { id: 'rocks', label: 'On the rocks', deltaPaise: 0 },
      { id: 'up', label: 'Straight up', deltaPaise: 0 },
      { id: 'noice', label: 'No ice', deltaPaise: 0 },
    ],
  },
};

/**
 * Food cost as a share of menu price, by section of the carte.
 *
 * These are the ratios a head chef actually works to, and they are not the same
 * across a menu: bread and rice carry almost no cost and subsidise the room,
 * a lamb rack carries a great deal, and wine sits somewhere between the two.
 * Giving every dish the same notional margin would make the menu performance
 * report look tidy and say nothing.
 */
const COST_RATIO = {
  mezze: 0.28,
  tandoor: 0.36,
  mains: 0.33,
  rice: 0.17,
  dessert: 0.23,
  bar: 0.26,
  soft: 0.14,
};

/**
 * A small, stable wobble around the category ratio so no two dishes in a
 * section report an identical margin. Derived from the id, so it is the same
 * on every machine and on every reload.
 */
function costWobble(id) {
  // FNV-1a with a finalising mix. A plain `hash * 31 + char` is not enough
  // here: menu ids run t01, t02, t03, so adjacent hashes differ by one and
  // every dish in a section ends up reporting the same margin.
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x5bd1e995);
  hash ^= hash >>> 15;
  return (((hash >>> 0) % 1000) / 1000 - 0.5) * 0.12; // ±6 percentage points
}

const item = (id, name, category, pricePaise, station, course, opts = {}) => ({
  id,
  name,
  category,
  pricePaise,
  station,
  course,
  diet: opts.diet || 'VEG',
  allergens: opts.allergens || [],
  description: opts.description || '',
  modifierGroups: opts.mods || [],
  signature: !!opts.signature,
  available: true,
  /** Nominal food cost, used by the margin column in the menu report. */
  costPaise: opts.costPaise
    ?? Math.round(pricePaise * ((COST_RATIO[category] ?? 0.3) + costWobble(id))),
});

export const MENU_ITEMS = [
  /* -------------------------------------------------------------- mezze -- */
  item('m01', 'Muhammara', 'mezze', 48000, 'COLD', 'STARTER', {
    diet: 'VEGAN', allergens: ['N'], signature: true,
    description: 'Roasted red pepper, Aleppo chilli, walnut, pomegranate molasses',
    mods: ['extras'],
  }),
  item('m02', 'Hummus Beiruti', 'mezze', 42000, 'COLD', 'STARTER', {
    diet: 'VEGAN', allergens: ['SE'],
    description: 'Chickpea, tahini, olive oil, warm khubz',
    mods: ['extras'],
  }),
  item('m03', 'Labneh & Za’atar', 'mezze', 44000, 'COLD', 'STARTER', {
    allergens: ['D', 'SE'], description: 'Strained yoghurt, wild thyme, Nabali oil',
  }),
  item('m04', 'Warak Enab', 'mezze', 46000, 'COLD', 'STARTER', {
    diet: 'VEGAN', description: 'Vine leaves, short-grain rice, mint, lemon',
  }),
  item('m05', 'Fattoush Saba', 'mezze', 52000, 'COLD', 'STARTER', {
    diet: 'VEGAN', allergens: ['G'],
    description: 'Heirloom tomato, purslane, sumac, crisp khubz',
  }),
  item('m06', 'Kibbeh Nayyeh', 'mezze', 78000, 'COLD', 'STARTER', {
    diet: 'NONVEG', allergens: ['G'], signature: true,
    description: 'Hand-pounded lamb, fine burghul, Ceylon cinnamon',
  }),
  item('m07', 'Batata Harra', 'mezze', 42000, 'HOT', 'STARTER', {
    diet: 'VEGAN', description: 'Crushed potato, coriander, chilli, garlic',
    mods: ['spice'],
  }),
  item('m08', 'Sambousek Jibneh', 'mezze', 49000, 'HOT', 'STARTER', {
    allergens: ['D', 'G'], description: 'Akkawi and halloumi pastry, nigella',
  }),
  item('m09', 'Grilled Halloumi', 'mezze', 56000, 'TANDOOR', 'STARTER', {
    allergens: ['D'], description: 'Charred halloumi, date molasses, orange',
  }),
  item('m10', 'Oysters, Rose Mignonette', 'mezze', 96000, 'COLD', 'AMUSE', {
    diet: 'NONVEG', allergens: ['S'], signature: true,
    description: 'Six on ice, Damask rose, shallot, verjuice',
    costPaise: 43000, // flown in, and priced like it
  }),

  /* ------------------------------------------------------------ tandoor -- */
  item('t01', 'Shish Taouk', 'tandoor', 82000, 'TANDOOR', 'MAIN', {
    diet: 'NONVEG', allergens: ['D'],
    description: 'Charcoal chicken, garlic toum, pickled turnip',
    mods: ['spice'],
  }),
  item('t02', 'Lahm Mishwi', 'tandoor', 128000, 'TANDOOR', 'MAIN', {
    diet: 'NONVEG', signature: true,
    description: 'Lamb rack, seven-spice, burnt aubergine',
    mods: ['doneness', 'extras'],
  }),
  item('t03', 'Kofta Khashkhash', 'tandoor', 92000, 'TANDOOR', 'MAIN', {
    diet: 'NONVEG', allergens: ['N'],
    description: 'Minced lamb, tomato, pine nut, Aleppo pepper',
    mods: ['spice'],
  }),
  item('t04', 'Jujeh Kabab', 'tandoor', 88000, 'TANDOOR', 'MAIN', {
    diet: 'NONVEG', allergens: ['D'],
    description: 'Saffron-yoghurt poussin, sour cherry glaze',
  }),
  item('t05', 'Barg Fillet', 'tandoor', 156000, 'TANDOOR', 'MAIN', {
    diet: 'NONVEG', signature: true,
    description: 'Aged tenderloin, saffron butter, grilled tomato',
    mods: ['doneness', 'extras'],
  }),
  item('t06', 'Samke Harra', 'tandoor', 138000, 'TANDOOR', 'MAIN', {
    diet: 'NONVEG', allergens: ['S', 'N'],
    description: 'Whole sea bass, tahini-chilli crust, coriander',
    mods: ['spice'],
  }),
  item('t07', 'Charred Cauliflower', 'tandoor', 68000, 'TANDOOR', 'MAIN', {
    diet: 'VEGAN', allergens: ['SE'],
    description: 'Whole roast, tahini, pomegranate, green chilli',
  }),

  /* -------------------------------------------------------------- mains -- */
  item('n01', 'Ghormeh Sabzi', 'mains', 94000, 'HOT', 'MAIN', {
    diet: 'NONVEG', signature: true,
    description: 'Herb stew, dried lime, red kidney bean, lamb shank',
  }),
  item('n02', 'Fesenjan', 'mains', 98000, 'HOT', 'MAIN', {
    diet: 'NONVEG', allergens: ['N'],
    description: 'Pomegranate and walnut, slow-braised duck',
  }),
  item('n03', 'Maqluba', 'mains', 86000, 'HOT', 'MAIN', {
    allergens: ['N'], description: 'Upturned rice, aubergine, cauliflower, almond',
    mods: ['portion'],
  }),
  item('n04', 'Lamb Ouzi', 'mains', 148000, 'HOT', 'MAIN', {
    diet: 'NONVEG', allergens: ['N'], signature: true,
    description: 'Twelve-hour shoulder, spiced rice, filo, for the table',
    mods: ['portion'],
  }),
  item('n05', 'Molokhia', 'mains', 84000, 'HOT', 'MAIN', {
    diet: 'NONVEG', description: 'Jute leaf, coriander-garlic taqliya, chicken',
  }),
  item('n06', 'Shakshuka Royale', 'mains', 72000, 'HOT', 'MAIN', {
    allergens: ['E', 'D'], description: 'Slow tomato, feta, two eggs, khubz',
  }),

  /* --------------------------------------------------------------- rice -- */
  item('r01', 'Zereshk Polo', 'rice', 42000, 'HOT', 'MAIN', {
    allergens: ['D'], description: 'Barberry, saffron, pistachio',
  }),
  item('r02', 'Baghali Polo', 'rice', 40000, 'HOT', 'MAIN', {
    diet: 'VEGAN', description: 'Broad bean and dill rice',
  }),
  item('r03', 'Vermicelli Rice', 'rice', 32000, 'HOT', 'MAIN', { diet: 'VEGAN' }),
  item('r04', 'Khubz, Wood-Fired', 'rice', 18000, 'TANDOOR', 'MAIN', {
    diet: 'VEGAN', allergens: ['G'], description: 'Baked to order',
    costPaise: 1900, // flour, water and the oven that is already lit
  }),
  item('r05', 'Manakish Za’atar', 'rice', 28000, 'TANDOOR', 'STARTER', {
    diet: 'VEGAN', allergens: ['G', 'SE'],
  }),
  item('r06', 'Tabbouleh', 'rice', 44000, 'COLD', 'STARTER', {
    diet: 'VEGAN', allergens: ['G'], description: 'Parsley, burghul, tomato, lemon',
  }),

  /* ------------------------------------------------------------ dessert -- */
  item('d01', 'Baklava Assortment', 'dessert', 46000, 'PASTRY', 'DESSERT', {
    allergens: ['N', 'D', 'G'], signature: true,
    description: 'Pistachio, walnut, cashew — five pieces',
  }),
  item('d02', 'Rose & Cardamom Muhallabia', 'dessert', 42000, 'PASTRY', 'DESSERT', {
    allergens: ['D', 'N'], description: 'Milk pudding, rose water, slivered almond',
  }),
  item('d03', 'Knafeh Nabulsieh', 'dessert', 52000, 'PASTRY', 'DESSERT', {
    allergens: ['D', 'G', 'N'], signature: true,
    description: 'Warm cheese pastry, orange blossom syrup',
  }),
  item('d04', 'Saffron & Pistachio Bastani', 'dessert', 38000, 'PASTRY', 'DESSERT', {
    allergens: ['D', 'N'], description: 'Persian ice cream, rose, salep',
  }),
  item('d05', 'Date & Tahini Tart', 'dessert', 44000, 'PASTRY', 'DESSERT', {
    diet: 'VEGAN', allergens: ['SE', 'G'],
  }),

  /* ---------------------------------------------------------------- bar -- */
  item('b01', 'Damask Negroni', 'bar', 78000, 'BAR', 'BEVERAGE', {
    signature: true, description: 'Rose vermouth, gin, Campari, orange oil',
    mods: ['ice'],
  }),
  item('b02', 'Arak Spritz', 'bar', 68000, 'BAR', 'BEVERAGE', {
    description: 'Arak, grapefruit, soda, mint',
    mods: ['ice'],
  }),
  item('b03', 'Saffron Sour', 'bar', 74000, 'BAR', 'BEVERAGE', {
    allergens: ['E'], description: 'Whisky, saffron honey, lemon, egg white',
  }),
  item('b04', 'Pomegranate Julep', 'bar', 72000, 'BAR', 'BEVERAGE', {
    description: 'Bourbon, pomegranate, Persian mint',
  }),
  item('b05', 'Château Musar, Glass', 'bar', 115000, 'BAR', 'BEVERAGE', {
    description: 'Bekaa Valley red, 2017',
    // A listed wine carries a real bottle cost; the mark-up is far thinner
    // than a cocktail's, which is exactly what the margin column should show.
    costPaise: 44000,
  }),
  item('b06', 'Sauvignon Blanc, Glass', 'bar', 88000, 'BAR', 'BEVERAGE', {}),
  item('b07', 'Sula Brut, Glass', 'bar', 82000, 'BAR', 'BEVERAGE', {}),
  item('b08', 'Craft Lager', 'bar', 52000, 'BAR', 'BEVERAGE', { allergens: ['G'] }),

  /* --------------------------------------------------------------- soft -- */
  item('s01', 'Jallab', 'soft', 34000, 'BAR', 'BEVERAGE', {
    diet: 'VEGAN', allergens: ['N'], description: 'Date molasses, rose water, pine nut',
  }),
  item('s02', 'Rose & Lime Sherbet', 'soft', 32000, 'BAR', 'BEVERAGE', { diet: 'VEGAN' }),
  item('s03', 'Mint Lemonade', 'soft', 30000, 'BAR', 'BEVERAGE', { diet: 'VEGAN' }),
  item('s04', 'Arabic Coffee', 'soft', 26000, 'BAR', 'BEVERAGE', {
    diet: 'VEGAN', description: 'Cardamom, served with a date',
  }),
  item('s05', 'Persian Chai', 'soft', 24000, 'BAR', 'BEVERAGE', { diet: 'VEGAN' }),
  item('s06', 'Still / Sparkling Water', 'soft', 18000, 'BAR', 'BEVERAGE', { diet: 'VEGAN' }),
];

export const itemById = (id) => MENU_ITEMS.find((i) => i.id === id);
