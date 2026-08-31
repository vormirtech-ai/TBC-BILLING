/**
 * The room. Tables carry an x/y on a 100×100 grid per section, so the floor
 * plan is an actual plan of the restaurant rather than a list of buttons — a
 * captain finds table 7 by looking where table 7 is.
 */

export const SECTIONS = [
  { id: 'hall', label: 'Main Hall', short: 'Hall', note: 'Ground floor, 44 covers' },
  { id: 'terrace', label: 'Garden Terrace', short: 'Terrace', note: 'Open air, 24 covers' },
  { id: 'rose', label: 'The Rose Room', short: 'Rose', note: 'Private dining' },
  { id: 'bar', label: 'Bar Counter', short: 'Bar', note: 'Walk-in seating' },
];

const table = (id, label, sectionId, seats, x, y, shape = 'round') =>
  ({ id, label, sectionId, seats, x, y, shape });

export const TABLES = [
  // Main hall — two rows of fours with a banquette run down the right wall.
  table('t1', '1', 'hall', 2, 14, 16),
  table('t2', '2', 'hall', 4, 38, 16),
  table('t3', '3', 'hall', 4, 62, 16),
  table('t4', '4', 'hall', 2, 86, 16),
  table('t5', '5', 'hall', 4, 14, 44),
  table('t6', '6', 'hall', 6, 40, 44, 'oval'),
  table('t7', '7', 'hall', 4, 68, 44),
  table('t8', '8', 'hall', 2, 88, 44),
  table('t9', '9', 'hall', 8, 26, 76, 'long'),
  table('t10', '10', 'hall', 8, 70, 76, 'long'),

  // Terrace — smaller tables around the water feature in the middle.
  table('g1', 'G1', 'terrace', 2, 18, 20),
  table('g2', 'G2', 'terrace', 2, 50, 14),
  table('g3', 'G3', 'terrace', 4, 82, 22),
  table('g4', 'G4', 'terrace', 4, 18, 64),
  table('g5', 'G5', 'terrace', 6, 52, 72, 'oval'),
  table('g6', 'G6', 'terrace', 2, 84, 64),

  // Private dining.
  table('r1', 'Rose 1', 'rose', 12, 30, 40, 'long'),
  table('r2', 'Rose 2', 'rose', 10, 74, 40, 'long'),

  // Bar stools.
  table('b1', 'B1', 'bar', 2, 14, 34),
  table('b2', 'B2', 'bar', 2, 30, 34),
  table('b3', 'B3', 'bar', 2, 46, 34),
  table('b4', 'B4', 'bar', 2, 62, 34),
  table('b5', 'B5', 'bar', 2, 78, 34),
  table('b6', 'B6', 'bar', 2, 92, 34),
];

export const tableById = (id) => TABLES.find((t) => t.id === id);
export const sectionById = (id) => SECTIONS.find((s) => s.id === id);
export const tablesInSection = (id) => TABLES.filter((t) => t.sectionId === id);

export const TOTAL_COVERS = TABLES.reduce((n, t) => n + t.seats, 0);
