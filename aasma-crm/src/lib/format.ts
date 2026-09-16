import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

let currencySymbol = '₹';

export function setCurrencySymbol(symbol: string): void {
  currencySymbol = symbol || '₹';
}

/**
 * Indian digit grouping (1,23,45,678) is what the office expects on every
 * printed and on-screen figure.
 */
export function money(value: number | null | undefined, options?: { compact?: boolean; decimals?: number }): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return `${currencySymbol}0`;

  if (options?.compact) {
    // A non-breaking space keeps "1.16 Cr" together when it lands on a chart
    // axis, where a normal space would wrap the unit onto its own line.
    const abs = Math.abs(amount);
    if (abs >= 10_000_000) return `${currencySymbol}${(amount / 10_000_000).toFixed(2)}\u00A0Cr`;
    if (abs >= 100_000) return `${currencySymbol}${(amount / 100_000).toFixed(2)}\u00A0L`;
    if (abs >= 1_000) return `${currencySymbol}${(amount / 1_000).toFixed(1)}\u00A0K`;
  }

  return `${currencySymbol}${amount.toLocaleString('en-IN', {
    minimumFractionDigits: options?.decimals ?? 0,
    maximumFractionDigits: options?.decimals ?? 0,
  })}`;
}

export function number(value: number | null | undefined, decimals = 0): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '0';
  return amount.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function percent(value: number | null | undefined, decimals = 1): string {
  return `${Number(value ?? 0).toFixed(decimals)}%`;
}

export function formatDate(value: string | Date | null | undefined, pattern = 'DD MMM YYYY'): string {
  if (!value) return '—';
  const date = dayjs(value);
  return date.isValid() ? date.format(pattern) : '—';
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return formatDate(value, 'DD MMM YYYY, h:mm A');
}

export function fromNow(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = dayjs(value);
  return date.isValid() ? date.fromNow() : '—';
}

/** Value for an <input type="date">. */
export function dateInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = dayjs(value);
  return date.isValid() ? date.format('YYYY-MM-DD') : '';
}

export function today(): string {
  return dayjs().format('YYYY-MM-DD');
}

export function monthInput(value?: string | Date): string {
  return dayjs(value ?? new Date()).format('YYYY-MM');
}

export function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
