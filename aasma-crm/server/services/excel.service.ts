import ExcelJS from 'exceljs';
import { BRAND } from '../../shared/constants';
import type { ReportResult } from './report.service';
import type { AppSettings } from '../lib/settings';

const CRIMSON = BRAND.crimson.replace('#', '');
const INK = BRAND.ink.replace('#', '');
const MIST = BRAND.mist.replace('#', '');

/**
 * Renders a report as a formatted workbook: branded header block, frozen and
 * filtered column headings, typed cells (so Excel can sum and sort them) and a
 * bold totals row.
 */
export async function reportToWorkbook(report: ReportResult, settings: AppSettings): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.companyName;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(report.title.slice(0, 30), {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const columnCount = Math.max(report.columns.length, 4);
  sheet.columns = report.columns.map((column) => ({ key: column.key, width: column.width ?? 18 }));

  // --- header block ---------------------------------------------------
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

  // --- column headings -------------------------------------------------
  const headerRow = sheet.addRow(report.columns.map((column) => column.header));
  headerRow.height = 20;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${CRIMSON}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: `FF${MIST}` } } };
  });

  // --- data ------------------------------------------------------------
  for (const row of report.rows) {
    const values = report.columns.map((column) => {
      const value = row[column.key];
      if (value == null) return '';
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

  // --- totals ----------------------------------------------------------
  const totalKeys = Object.keys(report.totals);
  if (totalKeys.length > 0 && report.rows.length > 0) {
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
    sheet.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: 5, column: report.columns.length },
    };
  }

  return workbook;
}

export async function workbookBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}

export function reportFileName(report: ReportResult): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = report.title.replace(/[^A-Za-z0-9]+/g, '_');
  return `${safe}_${stamp}.xlsx`;
}
