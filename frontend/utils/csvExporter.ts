import { SearchResult } from "../lib/types";

const escapeCsvField = (field: string | undefined): string => {
  const s = field == null ? '' : String(field);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const exportToCsv = (rows: SearchResult[], filename = 'results') => {
  const headers = ['title', 'url', 'snippet'];
  const csv = [
    headers.join(','),
    ...rows.map(r => [escapeCsvField(r.title), escapeCsvField(r.url), escapeCsvField(r.snippet || '')].join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
