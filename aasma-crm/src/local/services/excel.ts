import { BRAND } from '@shared/constants';
import type { ReportResult } from './reports';

/**
 * Excel export, built in the browser.
 *
 * ExcelJS is pulled in only when someone actually exports, so the ~900 KB
 * workbook writer never lands in the first page load.
 */

const CRIMSON = BRAND.crimson.replace('#', '');
const INK = BRAND.ink.replace('#', '');
const MIST = BRAND.mist.replace('#', '');

export interface CompanyDetails {
  companyName: string;
  companyAddress?: string | null;
  companyPhone?: string | null;
  gstNo?: string | null;
  currency: string;
}

export async function reportToBlob(report: ReportResult, settings: CompanyDetails): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.companyName;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(report.title.slice(0, 30), {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const columnCount = Math.max(report.columns.length, 4);
  sheet.columns = report.columns.map((column) => ({ key: column.key, width: column.width ?? 18 }));

  const titleRow = sheet.addRow([settings.companyName]);
  sheet.mergeCells(1, 1, 1, columnCount);
  titleRow.height = 26;
  titleRow.getCell(1).font = { name: 'Calibri', size: 16, bold: true, color: { argb: `FF${CRIMSON}` } };
  titleRow.getCell(1).alignment = { vertical: 'middle' };

  const subtitleParts = [settings.companyAddress, settings.companyPhone, settings.gstNo ? `GST ${settings.gstNo}` : '']
    .filter(Boolean)
    .join('  •  ');
  const addressRow = sheet.addRow([subtitleParts]);
  sheet.mergeCells(2, 1, 2, columnCount);
  addressRow.getCell(1).font = { size: 9, color: { argb: 'FF818286' } };

  const reportRow = sheet.addRow([report.title]);
  sheet.mergeCells(3, 1, 3, columnCount);
  reportRow.height = 20;
  reportRow.getCell(1).font = { size: 12, bold: true, color: { argb: `FF${INK}` } };

  const metaRow = sheet.addRow([
    `${report.subtitle}    |    Generated ${new Date().toLocaleString('en-IN')}    |    ${report.rows.length} record(s)`,
  ]);
  sheet.mergeCells(4, 1, 4, columnCount);
  metaRow.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF818286' } };

  const headerRow = sheet.addRow(report.columns.map((column) => column.header));
  headerRow.height = 20;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${CRIMSON}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: `FF${MIST}` } } };
  });

  for (const row of report.rows) {
    const values = report.columns.map((column) => {
      const value = row[column.key];
      if (value == null || value === '') return '';
      if (column.type === 'date') return value instanceof Date ? value : new Date(String(value));
      return value as string | number;
    });
    const excelRow = sheet.addRow(values);
    excelRow.eachCell((cell, index) => {
      const column = report.columns[index - 1];
      if (!column) return;
      cell.font = { size: 10 };
      if (column.type === 'money') {
        cell.numFmt = `"${settings.currency}"#,##0.00`;
        cell.alignment = { horizontal: 'right' };
      } else if (column.type === 'number') {
        cell.numFmt = '#,##0.##';
        cell.alignment = { horizontal: 'right' };
      } else if (column.type === 'percent') {
        cell.numFmt = '0.0"%"';
        cell.alignment = { horizontal: 'right' };
      } else if (column.type === 'date') {
        cell.numFmt = 'dd-mmm-yyyy';
        cell.alignment = { horizontal: 'center' };
      } else {
        cell.alignment = { vertical: 'top', wrapText: column.width != null && column.width > 30 };
      }
    });
  }

  if (Object.keys(report.totals).length > 0 && report.rows.length > 0) {
    const values = report.columns.map((column, index) => {
      if (index === 0) return 'TOTAL';
      return column.key in report.totals ? report.totals[column.key] : '';
    });
    const totalsRow = sheet.addRow(values);
    totalsRow.eachCell((cell, index) => {
      const column = report.columns[index - 1];
      cell.font = { bold: true, size: 10, color: { argb: `FF${INK}` } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F3' } };
      cell.border = { top: { style: 'medium', color: { argb: `FF${CRIMSON}` } } };
      if (column?.type === 'money') cell.numFmt = `"${settings.currency}"#,##0.00`;
      if (column?.type === 'number') cell.numFmt = '#,##0.##';
    });
  }

  if (report.rows.length > 0) {
    sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: report.columns.length } };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function reportFileName(report: ReportResult): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${report.title.replace(/[^A-Za-z0-9]+/g, '_')}_${stamp}.xlsx`;
}
