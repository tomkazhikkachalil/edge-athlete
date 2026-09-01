import { describe, expect, it } from 'vitest';
import { parseCsv, checkHeaders, CSV_MAX_ROWS } from '../csv';

describe('parseCsv', () => {
  it('parses plain rows with a lowercased header map', () => {
    const { headers, rows, errors } = parseCsv('Division,Team_Name\nU13 A,Blazers\nU15 B,Comets\n');
    expect(errors).toEqual([]);
    expect(headers).toEqual(['division', 'team_name']);
    expect(rows).toEqual([
      { division: 'U13 A', team_name: 'Blazers' },
      { division: 'U15 B', team_name: 'Comets' },
    ]);
  });

  it('honors quotes, escaped quotes and embedded commas/newlines', () => {
    const { rows, errors } = parseCsv('a,b\n"x, y","say ""hi""\nthere"\n');
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ a: 'x, y', b: 'say "hi"\nthere' }]);
  });

  it('handles CRLF and a missing trailing newline', () => {
    const { rows, errors } = parseCsv('a,b\r\n1,2\r\n3,4');
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ a: '3', b: '4' });
  });

  it('refuses ragged rows, unclosed quotes, blank headers, empties', () => {
    expect(parseCsv('a,b\n1\n').errors[0]).toContain('Row 2 has 1 fields');
    expect(parseCsv('a,b\n"open\n').errors[0]).toContain('Unclosed quote');
    expect(parseCsv('a,,c\n1,2,3\n').errors[0]).toContain('Blank header');
    expect(parseCsv('').errors[0]).toContain('Empty input');
    expect(parseCsv('a,b\n').errors[0]).toContain('No data rows');
  });

  it('caps rows and field lengths', () => {
    const big = 'a\n' + Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => `${i}`).join('\n');
    expect(parseCsv(big).errors[0]).toContain('Too many rows');
    expect(parseCsv(`a\n${'x'.repeat(201)}`).errors[0]).toContain('exceeds 200');
  });
});

describe('checkHeaders', () => {
  it('accepts exact sets in any order, optionals absent or present', () => {
    expect(checkHeaders(['team_name', 'division'], ['division', 'team_name'], ['tier'])).toBeNull();
    expect(checkHeaders(['division', 'team_name', 'tier'], ['division', 'team_name'], ['tier'])).toBeNull();
  });
  it('names the missing and unknown columns with the expected list', () => {
    const msg = checkHeaders(['division', 'teamname'], ['division', 'team_name'], ['tier']);
    expect(msg).toContain('missing: team_name');
    expect(msg).toContain('unknown: teamname');
    expect(msg).toContain('Expected columns: division, team_name');
  });
});
