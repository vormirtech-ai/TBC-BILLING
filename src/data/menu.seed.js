/**
 * ---------------------------------------------------------------------------
 * THE BARUCH CAFE — MENU
 * ---------------------------------------------------------------------------
 * Transcribed from the cafe's own printed cards: the drinks from "Baruch Cafe
 * Menu Final Rates", the food from the TBC Food Menu. Names, spellings and
 * prices are exactly as printed — including the cafe's own spellings, which are
 * what customers see on the table and what staff say out loud. Prices are in
 * whole rupees here and are converted to paise (integers) when seeded.
 *
 * Veg and non-veg are kept in separate categories rather than mixed together.
 * That is how the printed menu reads, it is the first thing most customers here
 * filter on, and it keeps names like "Pizza Sandwich" — which exists in both —
 * from colliding.
 *
 * To change the menu after launch, use Admin → Menu inside the app — editing
 * this file only affects a device that has never been opened before.
 * To pick up items added to this file later without losing your own price
 * edits: Admin → Menu → Add new items from the menu file.
 */

export const MENU_CATEGORIES = [
  /* drinks */
  'Hot',
  'Iced',
  "Frappe's",
  'Non-Coffee Based',
  'Cold Brews',
  'TBC Specials',
  /* food */
  'Pizza (Veg)',
  'Pizza (Non-Veg)',
  'Pasta (Veg)',
  'Pasta (Non-Veg)',
  'Sandwich (Veg)',
  'Sandwich (Non-Veg)',
  'Burger (Veg)',
  'Burger (Non-Veg)',
  'Chinese (Veg)',
  'Chinese (Non-Veg)',
  'Rice Bowl (Veg)',
  'Rice Bowl (Non-Veg)',
  'Fries',
  'Salad',
  'Dessert',
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

  /* =======================================================================
     FOOD
     From the TBC Food Menu card. Descriptions are only those printed on it;
     nothing here is invented, because a description a customer reads should
     be the kitchen's promise rather than a guess.
     ======================================================================= */

  // --------------------------------------------------------- Pizza (Veg)
  { name: 'Margerita Classic', category: 'Pizza (Veg)', price: 119, description: 'Tomato, basil, black olive.' },
  { name: 'Pesto Basil', category: 'Pizza (Veg)', price: 289, description: 'Feta cheez and exotic vegies.' },
  { name: 'Verdure', category: 'Pizza (Veg)', price: 289, description: 'Italian vegitable pizza.' },
  { name: 'Chezwan Paneer', category: 'Pizza (Veg)', price: 299, description: 'Paneer, bell paper, vegies.' },
  { name: 'BBQ Pizza', category: 'Pizza (Veg)', price: 319, description: 'BBQ sauces, vegies, cheez.' },
  { name: 'Pesto Paneer Pizza', category: 'Pizza (Veg)', price: 389, description: '' },
  { name: 'Corn Cheese Pizza', category: 'Pizza (Veg)', price: 199, description: '' },

  // ----------------------------------------------------- Pizza (Non-Veg)
  { name: 'Chezwan Chicken', category: 'Pizza (Non-Veg)', price: 350, description: '' },
  { name: 'BBQ Chicken', category: 'Pizza (Non-Veg)', price: 350, description: '' },
  { name: 'Meat Feast', category: 'Pizza (Non-Veg)', price: 369, description: '' },
  { name: 'Simply Chicken', category: 'Pizza (Non-Veg)', price: 349, description: '' },
  { name: 'Pesto Chicken', category: 'Pizza (Non-Veg)', price: 389, description: '' },
  { name: 'Peri-Peri Chicken', category: 'Pizza (Non-Veg)', price: 379, description: '' },
  { name: 'Calzone', category: 'Pizza (Non-Veg)', price: 389, description: 'TBC Special.' },

  // --------------------------------------------------------- Pasta (Veg)
  { name: 'Alfredo Pasta', category: 'Pasta (Veg)', price: 249, description: 'Penne or spaghetti.' },
  { name: 'Arabita Pasta', category: 'Pasta (Veg)', price: 249, description: '' },
  { name: 'Penne Pada Pesto', category: 'Pasta (Veg)', price: 249, description: '' },
  { name: 'Pink Sauce', category: 'Pasta (Veg)', price: 249, description: '' },
  { name: 'Som Pesto Rigatoni', category: 'Pasta (Veg)', price: 249, description: '' },
  { name: 'Agleo Olio Pasta', category: 'Pasta (Veg)', price: 249, description: '' },
  { name: 'Mac & Cheese Pasta', category: 'Pasta (Veg)', price: 249, description: '' },

  // ----------------------------------------------------- Pasta (Non-Veg)
  { name: 'Alfredo Pasta', category: 'Pasta (Non-Veg)', price: 349, description: 'Penne or spaghetti, with chicken.' },
  { name: 'Arabita Pasta', category: 'Pasta (Non-Veg)', price: 349, description: 'With chicken.' },
  { name: 'Penne Pada Pesto', category: 'Pasta (Non-Veg)', price: 349, description: 'With chicken.' },
  { name: 'Pink Sauce', category: 'Pasta (Non-Veg)', price: 349, description: 'With chicken.' },
  { name: 'Som Pesto Rigatoni', category: 'Pasta (Non-Veg)', price: 349, description: 'With chicken.' },
  { name: 'Agleo Olio Pasta', category: 'Pasta (Non-Veg)', price: 349, description: 'With chicken.' },
  { name: 'Mac & Cheese Pasta', category: 'Pasta (Non-Veg)', price: 349, description: 'With chicken.' },

  // ------------------------------------------------------ Sandwich (Veg)
  { name: 'Tandoori Paneer', category: 'Sandwich (Veg)', price: 199, description: '' },
  { name: 'Corn Cheese', category: 'Sandwich (Veg)', price: 189, description: '' },
  { name: 'Double Cheese', category: 'Sandwich (Veg)', price: 220, description: '' },
  { name: 'Pesto Paneer', category: 'Sandwich (Veg)', price: 230, description: '' },
  { name: 'BBQ Paneer', category: 'Sandwich (Veg)', price: 240, description: '' },
  { name: 'Bombay Grilled', category: 'Sandwich (Veg)', price: 249, description: '' },
  { name: 'Melting Paneer', category: 'Sandwich (Veg)', price: 249, description: '' },
  { name: 'Pizza Sandwich', category: 'Sandwich (Veg)', price: 249, description: '' },

  // -------------------------------------------------- Sandwich (Non-Veg)
  { name: 'Tandoori Chicken', category: 'Sandwich (Non-Veg)', price: 289, description: '' },
  { name: 'Double Cheese Chicken', category: 'Sandwich (Non-Veg)', price: 269, description: '' },
  { name: 'Pesto Chicken', category: 'Sandwich (Non-Veg)', price: 249, description: '' },
  { name: 'BBQ Chicken', category: 'Sandwich (Non-Veg)', price: 299, description: '' },
  { name: 'Panini Chicken', category: 'Sandwich (Non-Veg)', price: 349, description: '' },
  { name: 'Melting Chicken', category: 'Sandwich (Non-Veg)', price: 299, description: '' },
  { name: 'Pizza Sandwich', category: 'Sandwich (Non-Veg)', price: 349, description: '' },

  // -------------------------------------------------------- Burger (Veg)
  { name: 'Veg Cheese Melt', category: 'Burger (Veg)', price: 149, description: '' },
  { name: 'Aalo Tikki Burger', category: 'Burger (Veg)', price: 149, description: '' },
  { name: 'Veg Paprika', category: 'Burger (Veg)', price: 149, description: '' },
  { name: 'Shezwan Maharaja', category: 'Burger (Veg)', price: 179, description: '' },
  { name: 'Paneer Tikka Burger', category: 'Burger (Veg)', price: 199, description: '' },
  { name: 'OG Veg Burger', category: 'Burger (Veg)', price: 199, description: '' },

  // ---------------------------------------------------- Burger (Non-Veg)
  { name: 'Crunchy Chicken', category: 'Burger (Non-Veg)', price: 199, description: '' },
  { name: 'OG Chicken', category: 'Burger (Non-Veg)', price: 219, description: '' },
  { name: 'Chicken Gun Powder', category: 'Burger (Non-Veg)', price: 229, description: '' },
  { name: 'Chicken Tikka', category: 'Burger (Non-Veg)', price: 299, description: '' },
  { name: 'Korean Chicken', category: 'Burger (Non-Veg)', price: 299, description: '' },

  // ------------------------------------------------------- Chinese (Veg)
  { name: 'Black Pepper Paneer', category: 'Chinese (Veg)', price: 249, description: '' },
  { name: 'Honey Chilly Paneer', category: 'Chinese (Veg)', price: 249, description: '' },
  { name: 'Paneer Curry', category: 'Chinese (Veg)', price: 249, description: '' },
  { name: 'Paneer 65', category: 'Chinese (Veg)', price: 249, description: '' },
  { name: 'Paneer Hot Balls', category: 'Chinese (Veg)', price: 249, description: '' },
  { name: 'Chilly Paneer', category: 'Chinese (Veg)', price: 249, description: '' },

  // --------------------------------------------------- Chinese (Non-Veg)
  { name: 'Black Pepper Chicken', category: 'Chinese (Non-Veg)', price: 249, description: '' },
  { name: 'Honey Chilly Chicken', category: 'Chinese (Non-Veg)', price: 249, description: '' },
  { name: 'Chicken Curry', category: 'Chinese (Non-Veg)', price: 249, description: '' },
  { name: 'Chicken 65', category: 'Chinese (Non-Veg)', price: 249, description: '' },
  { name: 'Chicken Hot Balls', category: 'Chinese (Non-Veg)', price: 249, description: '' },
  { name: 'Chilly Chicken', category: 'Chinese (Non-Veg)', price: 249, description: '' },

  // ----------------------------------------------------- Rice Bowl (Veg)
  { name: 'Thai Curry', category: 'Rice Bowl (Veg)', price: 349, description: '' },
  { name: 'Cilantro Lime Paneer', category: 'Rice Bowl (Veg)', price: 349, description: '' },
  { name: 'Paneer Stroganoff', category: 'Rice Bowl (Veg)', price: 299, description: '' },
  { name: 'Pesto Paneer', category: 'Rice Bowl (Veg)', price: 299, description: '' },
  { name: 'Paprika Paneer', category: 'Rice Bowl (Veg)', price: 319, description: '' },
  { name: 'Tuscan Paneer', category: 'Rice Bowl (Veg)', price: 349, description: '' },
  { name: 'Crypto Veggie Meal', category: 'Rice Bowl (Veg)', price: 349, description: '' },
  { name: 'China Bowl', category: 'Rice Bowl (Veg)', price: 349, description: '' },

  // ------------------------------------------------- Rice Bowl (Non-Veg)
  { name: 'Thai Curry', category: 'Rice Bowl (Non-Veg)', price: 349, description: '' },
  { name: 'Cilantro Lime Chicken', category: 'Rice Bowl (Non-Veg)', price: 349, description: '' },
  { name: 'Chicken Stroganoff', category: 'Rice Bowl (Non-Veg)', price: 299, description: '' },
  { name: 'Pesto Chicken', category: 'Rice Bowl (Non-Veg)', price: 299, description: '' },
  { name: 'Paprika Chicken', category: 'Rice Bowl (Non-Veg)', price: 319, description: '' },
  { name: 'Tuscan Chicken', category: 'Rice Bowl (Non-Veg)', price: 349, description: '' },
  { name: 'Crypto Egg Meal', category: 'Rice Bowl (Non-Veg)', price: 349, description: '' },
  { name: 'China Bowl', category: 'Rice Bowl (Non-Veg)', price: 349, description: '' },

  // --------------------------------------------------------------- Fries
  { name: 'Salted Fries', category: 'Fries', price: 149, description: '' },
  { name: 'Peri Peri Fries', category: 'Fries', price: 199, description: '' },
  { name: 'Loaded Cheez Fries', category: 'Fries', price: 289, description: '' },
  { name: 'Mexican Loaded Fries', category: 'Fries', price: 249, description: '' },

  // --------------------------------------------------------------- Salad
  { name: 'Greek Salad', category: 'Salad', price: 250, description: 'Veg or non-veg.' },
  { name: 'Italian Salad', category: 'Salad', price: 250, description: 'Veg or non-veg.' },
  { name: 'Sizer Salad', category: 'Salad', price: 250, description: 'Veg or non-veg.' },

  // ------------------------------------------------------------- Dessert
  { name: 'Sizzling Brownie', category: 'Dessert', price: 220, description: '' },
  { name: 'Walnut Brownie', category: 'Dessert', price: 150, description: '' },
  { name: 'Pan Cakes', category: 'Dessert', price: 199, description: '' },
  { name: 'Waffle', category: 'Dessert', price: 199, description: '' },
  { name: 'French Toast', category: 'Dessert', price: 199, description: '' },
];
