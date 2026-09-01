// ── Minimal CSV (phase 6 R5) — pure, ZERO deps, node-tested ─────────────────
// The RFC-4180 subset the import surfaces need: quoted fields, escaped
// quotes (""), CRLF/LF rows, a header row mapped to lowercase keys.
// Hand-rolled on the no-new-deps rule; the vitest matrix IS the
// verification (node-only tests, the house standard). NOT a general CSV
// library: no streaming, no custom delimiters, caps enforced here so
// callers can't forget them.

export interface CsvParseResult {
  /** Lowercased, trimmed header names in file order. */
  headers: string[];
  /** One record per data row; keys are the lowercased headers. */
  rows: Record<string, string>[];
  /** Fatal problems (structure-level). Row-level issues are the
   *  importer's job — this layer only refuses malformed CSV. */
  errors: string[];
}

export const CSV_MAX_ROWS = 200;
export const CSV_MAX_FIELD = 200;

export function parseCsv(text: string, opts: { maxRows?: number } = {}): CsvParseResult {
  const maxRows = opts.maxRows ?? CSV_MAX_ROWS;
  const errors: string[] = [];

  // Tokenize into rows of fields, honoring quotes.
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    // Skip fully empty trailing lines.
    if (record.length > 1 || record[0] !== '') records.push(record);
    record = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      if (field.length > 0) {
        errors.push(`Unexpected quote mid-field near character ${i + 1}`);
        return { headers: [], rows: [], errors };
      }
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      pushField();
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRecord();
      i++;
      continue;
    }
    if (ch === '\r') {
      // CRLF or stray CR — both end the record; skip a following \n.
      pushRecord();
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) {
    errors.push('Unclosed quote at end of input');
    return { headers: [], rows: [], errors };
  }
  if (field.length > 0 || record.length > 0) pushRecord();

  if (records.length === 0) {
    errors.push('Empty input');
    return { headers: [], rows: [], errors };
  }
  const headers = records[0].map(h => h.trim().toLowerCase());
  if (headers.some(h => h === '')) {
    errors.push('Blank header column');
    return { headers: [], rows: [], errors };
  }
  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) errors.push('No data rows under the header');
  if (dataRecords.length > maxRows) {
    errors.push(`Too many rows (${dataRecords.length} > ${maxRows})`);
    return { headers, rows: [], errors };
  }

  const rows: Record<string, string>[] = [];
  for (let r = 0; r < dataRecords.length; r++) {
    const rec = dataRecords[r];
    if (rec.length !== headers.length) {
      errors.push(`Row ${r + 2} has ${rec.length} fields, expected ${headers.length}`);
      return { headers, rows: [], errors };
    }
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const value = rec[c].trim();
      if (value.length > CSV_MAX_FIELD) {
        errors.push(`Row ${r + 2}, column "${headers[c]}" exceeds ${CSV_MAX_FIELD} characters`);
        return { headers, rows: [], errors };
      }
      row[headers[c]] = value;
    }
    rows.push(row);
  }
  return { headers, rows, errors };
}

/** Strict header check: exactly the expected set (order-free), so a
 *  typo'd column fails loudly with the full expected list (v1 call —
 *  synonyms can come later). Optional columns may be absent. */
export function checkHeaders(
  headers: string[],
  required: string[],
  optional: string[] = []
): string | null {
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter(r => !headers.includes(r));
  const unknown = headers.filter(h => !allowed.has(h));
  if (missing.length || unknown.length) {
    const parts: string[] = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (unknown.length) parts.push(`unknown: ${unknown.join(', ')}`);
    return `Header problem (${parts.join('; ')}). Expected columns: ${required.join(', ')}${
      optional.length ? ` (optional: ${optional.join(', ')})` : ''
    }`;
  }
  return null;
}
