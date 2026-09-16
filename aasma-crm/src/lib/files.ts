/**
 * Where a stored file lives depends on the build: the desktop app serves photos
 * from its uploads folder, while the hosted build keeps them inside the browser
 * database as data URLs.
 */
export function fileUrl(path: string): string {
  if (!path) return '';
  if (/^(data:|blob:|https?:)/.test(path)) return path;
  return `/files/${path}`;
}
