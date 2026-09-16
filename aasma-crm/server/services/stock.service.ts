import { prisma } from '../lib/prisma';
import { round } from '../lib/query';
import type { StockRow } from '../../shared/types';

/**
 * Live stock is never stored as a column — it is derived from opening stock plus
 * purchases, minus issues, plus adjustments. Deriving it keeps the ledger and
 * the balance from ever drifting apart.
 */
export async function getStockRows(filter?: { category?: string; q?: string }): Promise<StockRow[]> {
  const materials = await prisma.material.findMany({
    where: {
      ...(filter?.category ? { category: filter.category } : {}),
      ...(filter?.q ? { name: { contains: filter.q } } : {}),
    },
    orderBy: { name: 'asc' },
  });

  const [purchases, usages, adjustments] = await Promise.all([
    prisma.purchase.groupBy({ by: ['materialId'], _sum: { quantity: true } }),
    prisma.materialUsage.groupBy({ by: ['materialId'], _sum: { quantity: true } }),
    prisma.stockAdjustment.groupBy({ by: ['materialId'], _sum: { quantity: true } }),
  ]);

  const sumBy = (rows: { materialId: number; _sum: { quantity: number | null } }[]) =>
    new Map(rows.map((row) => [row.materialId, row._sum.quantity ?? 0]));

  const purchasedMap = sumBy(purchases);
  const usedMap = sumBy(usages);
  const adjustedMap = sumBy(adjustments);

  return materials.map((material) => {
    const purchased = purchasedMap.get(material.id) ?? 0;
    const used = usedMap.get(material.id) ?? 0;
    const adjusted = adjustedMap.get(material.id) ?? 0;
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

export async function getStockForMaterial(materialId: number): Promise<StockRow | null> {
  const rows = await getStockRows();
  return rows.find((row) => row.id === materialId) ?? null;
}

export async function getLowStockRows(): Promise<StockRow[]> {
  const rows = await getStockRows();
  return rows.filter((row) => row.low);
}
