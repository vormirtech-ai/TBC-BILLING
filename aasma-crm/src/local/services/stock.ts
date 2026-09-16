import { db } from '../db';
import { round } from '../query';
import type { StockRow } from '@shared/types';

/**
 * Live stock, derived the same way the server derives it: opening balance plus
 * purchases, minus issues, plus adjustments.
 */
export function stockRows(filter?: { q?: string; category?: string }): StockRow[] {
  const data = db();
  const term = filter?.q?.trim().toLowerCase();

  return data.materials
    .filter((material) => {
      if (filter?.category && material.category !== filter.category) return false;
      if (term && !material.name.toLowerCase().includes(term)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((material) => {
      const purchased = data.purchases
        .filter((row) => row.materialId === material.id)
        .reduce((acc, row) => acc + row.quantity, 0);
      const used = data.materialUsages
        .filter((row) => row.materialId === material.id)
        .reduce((acc, row) => acc + row.quantity, 0);
      const adjusted = data.stockAdjustments
        .filter((row) => row.materialId === material.id)
        .reduce((acc, row) => acc + row.quantity, 0);
      const inStock = round(material.openingStock + purchased - used + adjusted, 3);

      return {
        id: material.id,
        name: material.name,
        category: material.category,
        unit: material.unit,
        rate: material.rate,
        openingStock: material.openingStock,
        purchased: round(purchased, 3),
        used: round(used, 3),
        adjusted: round(adjusted, 3),
        inStock,
        reorderLevel: material.reorderLevel,
        stockValue: round(inStock * material.rate, 2),
        low: inStock <= material.reorderLevel,
      } satisfies StockRow;
    });
}

export function lowStockRows(): StockRow[] {
  return stockRows().filter((row) => row.low);
}
