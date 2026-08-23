/**
 * ---------------------------------------------------------------------------
 * THE BARUCH CAFE — MENU
 * ---------------------------------------------------------------------------
 * Transcribed exactly from "Baruch Cafe Menu Final Rates". Names, spellings and
 * prices are as printed on the menu card. Prices are in whole rupees here and
 * are converted to paise (integers) when the database is seeded.
 *
 * To change the menu after launch, use Admin → Menu inside the app — editing
 * this file only affects a device that has never been opened before.
 * To re-seed a device from this file: Admin → Settings → Reset menu to file.
 */

export const MENU_CATEGORIES = [
  'Hot',
  'Iced',
  "Frappe's",
  'Non-Coffee Based',
  'Cold Brews',
  'TBC Specials',
];

export const MENU_SEED = [
  // ---------------------------------------------------------------- Hot
  { name: 'Espresso', category: 'Hot', price: 140, description: 'Rich and concentrated espresso with a balanced crema.' },
  { name: 'Americano', category: 'Hot', price: 170, description: 'Espresso gently diluted with hot water for a clean, bold cup.' },
  { name: 'Cappuccino', category: 'Hot', price: 180, description: 'Espresso, silky steamed milk and a generous layer of foam.' },
  { name: 'Latte', category: 'Hot', price: 180, description: 'Smooth espresso blended with creamy steamed milk and light foam.' },
  { name: 'Mocha', category: 'Hot', price: 220, description: 'Espresso, chocolate and steamed milk for a rich, indulgent cup.' },
  { name: 'Spanish Latte', category: 'Hot', price: 230, description: 'Bold espresso balanced with sweetened condensed milk and silky milk.' },
  { name: 'Cortado', category: 'Hot', price: 170, description: 'Equal parts espresso and warm textured milk for a balanced, intense drink.' },
  { name: 'Flat White', category: 'Hot', price: 210, description: 'Double espresso with velvety microfoam for a rich, smooth finish.' },

  // ---------------------------------------------------------------- Iced
  { name: 'Affogato', category: 'Iced', price: 180, description: 'A scoop of creamy ice cream finished with a shot of hot espresso.' },
  { name: 'Iced Americano', category: 'Iced', price: 180, description: 'Espresso and chilled water served over ice for a crisp finish.' },
  { name: 'Iced Latte', category: 'Iced', price: 210, description: 'Espresso and chilled milk poured over ice for a smooth, refreshing cup.' },
  { name: 'Iced Mocha', category: 'Iced', price: 220, description: 'Espresso, chocolate and chilled milk over ice.' },
  { name: 'Spanish Iced Latte', category: 'Iced', price: 230, description: 'Espresso, sweetened condensed milk and chilled milk over ice.' },
  { name: 'Cranberry Espresso', category: 'Iced', price: 210, description: 'Bright cranberry and espresso combined for a fruity, refreshing profile.' },
  { name: 'Red Bull Espresso', category: 'Iced', price: 220, description: 'A bold espresso twist with chilled Red Bull for an energetic finish.' },
  { name: 'Espresso Tonic', category: 'Iced', price: 200, description: 'Espresso over tonic water and ice for a bright, sparkling drink.' },
  { name: 'Espresso Ginger Ale', category: 'Iced', price: 200, description: 'Espresso paired with sparkling ginger ale for a spicy, refreshing lift.' },

  // ------------------------------------------------------------ Frappe's
  { name: 'Classic Frappe', category: "Frappe's", price: 210, description: 'Creamy blended coffee frappe with a smooth, refreshing finish.' },
  { name: 'Mocha Frappe', category: "Frappe's", price: 250, description: 'Blended coffee and chocolate for a rich, indulgent frappe.' },
  { name: 'Roasted Hazelnut Frappe', category: "Frappe's", price: 240, description: 'Creamy coffee frappe with warm roasted hazelnut notes.' },
  { name: 'Irish Frappe', category: "Frappe's", price: 240, description: 'Smooth coffee frappe with a rich Irish-style flavor profile.' },
  { name: 'Peanut Frappe', category: "Frappe's", price: 250, description: 'Creamy coffee frappe with roasted peanut richness.' },
  { name: 'Nutella Frappe', category: "Frappe's", price: 270, description: 'Decadent coffee frappe blended with chocolate-hazelnut spread.' },
  { name: 'Lotus Biscoff Frappe', category: "Frappe's", price: 270, description: 'Creamy coffee frappe with caramelized biscuit flavor.' },

  // ------------------------------------------------------ Non-Coffee Based
  { name: 'Green Tea', category: 'Non-Coffee Based', price: 120, description: 'Light and refreshing brewed green tea with delicate vegetal notes.' },
  { name: 'Hibiscus Tea', category: 'Non-Coffee Based', price: 140, description: 'Vibrant herbal infusion with a naturally tart, floral character.' },
  { name: 'Lemon Iced Tea', category: 'Non-Coffee Based', price: 200, description: 'Refreshing chilled tea brightened with zesty lemon.' },
  { name: 'Peach Iced Tea', category: 'Non-Coffee Based', price: 210, description: 'Chilled tea with sweet, juicy peach notes.' },
  { name: 'Lemon Mint Mojito', category: 'Non-Coffee Based', price: 180, description: 'Refreshing lemon, mint and sparkling soda over ice.' },
  { name: 'Blueberry Shake', category: 'Non-Coffee Based', price: 220, description: 'Creamy milkshake with sweet blueberry flavor.' },
  { name: 'Nutella Shake', category: 'Non-Coffee Based', price: 240, description: 'Rich and creamy chocolate-hazelnut milkshake.' },
  { name: 'Biscoff Shake', category: 'Non-Coffee Based', price: 240, description: 'Smooth milkshake with caramelized Biscoff biscuit flavor.' },
  { name: 'Classic Hot Chocolate', category: 'Non-Coffee Based', price: 200, description: 'Velvety hot chocolate with a rich cocoa finish.' },

  // ---------------------------------------------------------- Cold Brews
  { name: 'Straight Up', category: 'Cold Brews', price: 180, description: 'Slow-steeped cold brew served chilled for a smooth, clean finish.' },
  { name: 'Tonic Cold Brew', category: 'Cold Brews', price: 200, description: 'Smooth cold brew topped with crisp, sparkling tonic.' },
  { name: 'Ginger Ale Cold Brew', category: 'Cold Brews', price: 200, description: 'Cold brew lifted with sparkling ginger ale and gentle spice.' },
  { name: 'Sparkling Cold Brew', category: 'Cold Brews', price: 210, description: 'Cold brew combined with sparkling water for a bright, refreshing cup.' },
  { name: 'Basil Cold Brew', category: 'Cold Brews', price: 210, description: 'Cold brew infused with aromatic basil for a fresh, herbal finish.' },
  { name: 'Purple Bloom Cold Brew', category: 'Cold Brews', price: 190, description: 'Cold brew with a vibrant floral-fruity character and refreshing finish.' },

  // -------------------------------------------------------- TBC Specials
  { name: 'Maltina Coldbrew', category: 'TBC Specials', price: 240, description: 'Non-alcoholic based cold brew.' },
  { name: 'Purple Cloud', category: 'TBC Specials', price: 260, description: 'Ube and banoffee based specialty drink.' },
  { name: 'Jamun Fizz', category: 'TBC Specials', price: 220, description: 'Fresh jamun mocktail.' },
  { name: 'TBC Sparkitup', category: 'TBC Specials', price: 240, description: 'Sparkling water infused with tangy vanilla.' },
  { name: 'Banoffee Cheesecake Latte', category: 'TBC Specials', price: 250, description: 'A rich banoffee cheesecake-inspired latte.' },
  { name: 'Dark Forestfoam', category: 'TBC Specials', price: 250, description: 'Special dark chocolate based signature drink.' },
  { name: 'Lotus Cloud', category: 'TBC Specials', price: 260, description: 'Biscoff iced latte.' },
  { name: 'Coco Cream Ube', category: 'TBC Specials', price: 260, description: 'Coconut water topped with ube.' },
  { name: 'Aqua Fizz', category: 'TBC Specials', price: 230, description: 'Red Bull with yuzu and an ocean-inspired profile.' },
];
