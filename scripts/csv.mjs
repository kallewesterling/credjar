/**
 * csv.mjs — reading recipient lists and writing exports and audit files.
 *
 * Small on purpose, and dependency-free. Input CSVs are hand-made lists of
 * people, usually exported from a spreadsheet, so this handles quoted
 * fields, embedded commas and newlines, a UTF-8 BOM and CRLF line endings,
 * which is what spreadsheets produce. It does not guess at delimiters.
 */

/**
 * Parses CSV text into an array of objects keyed by the header row. Header
 * names are trimmed and lowercased, so `Email` and ` email ` both become
 * `email`. Rows that are entirely empty are dropped.
 *
 * Each object also carries a non-enumerable `_line`, the 1-based line the
 * row starts on, so validation errors can point at the spreadsheet row.
 */
export function parseCsv(text) {
  const records = [];
  let field = '';
  let record = [];
  let recordLine = 1;
  let line = 1;
  let inQuotes = false;

  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      records.push({ cells: record, line: recordLine });
      record = [];
      field = '';
      line++;
      recordLine = line;
    } else field += ch;
  }
  if (inQuotes) throw new Error(`Unclosed quote in CSV starting on line ${recordLine}.`);
  if (field !== '' || record.length) {
    record.push(field);
    records.push({ cells: record, line: recordLine });
  }

  const nonEmpty = records.filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return [];

  const header = nonEmpty[0].cells.map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map(({ cells, line: rowLine }) => {
    const row = {};
    header.forEach((key, idx) => {
      if (key) row[key] = (cells[idx] ?? '').trim();
    });
    Object.defineProperty(row, '_line', { value: rowLine, enumerable: false });
    return row;
  });
}

/**
 * Quotes a value for CSV, and defuses spreadsheet formulas.
 *
 * Exports carry earner names, which the earners typed themselves. A cell
 * starting with `=`, `+`, `-` or `@` is run as a formula when the file is
 * opened in Excel or Sheets, so those get a leading apostrophe, which
 * spreadsheets display as plain text.
 */
export function csvCell(value) {
  if (value === undefined || value === null) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialises rows to CSV using `columns` as the header, in that order. */
export function toCsv(rows, columns) {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  return lines.join('\n') + '\n';
}
