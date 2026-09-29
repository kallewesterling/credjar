import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, toCsv, csvCell } from '../scripts/csv.mjs';

test('parseCsv keys rows by a trimmed, lowercased header', () => {
  const rows = parseCsv('Email, First_Name ,last_name\na@b.c,Ada,Lovelace\n');
  assert.deepEqual(rows, [{ email: 'a@b.c', first_name: 'Ada', last_name: 'Lovelace' }]);
});

test('parseCsv handles what spreadsheets write: BOM, CRLF, quotes, commas', () => {
  const text = '\uFEFFemail,first_name,last_name\r\n"a@b.c","Ada, Countess","Love""lace"\r\n';
  assert.deepEqual(parseCsv(text), [{ email: 'a@b.c', first_name: 'Ada, Countess', last_name: 'Love"lace' }]);
});

test('parseCsv drops blank lines and records each row\'s line number', () => {
  const rows = parseCsv('email\n\na@b.c\n,\nc@d.e');
  assert.deepEqual(rows.map((r) => r.email), ['a@b.c', 'c@d.e']);
  assert.deepEqual(rows.map((r) => r._line), [3, 5]);
  // Not enumerable, so it never ends up in a payload.
  assert.deepEqual(Object.keys(rows[0]), ['email']);
});

test('parseCsv counts lines inside quoted newlines', () => {
  const rows = parseCsv('email,note\na@b.c,"two\nlines"\nc@d.e,x');
  assert.equal(rows[0].note, 'two\nlines');
  assert.equal(rows[1]._line, 4);
});

test('parseCsv rejects an unclosed quote rather than swallowing the file', () => {
  assert.throws(() => parseCsv('email\n"a@b.c\nc@d.e'), /Unclosed quote/);
});

test('parseCsv of an empty file is no rows', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('email\n'), []);
});

// Earner names are typed by the earners. Opened in a spreadsheet, a cell
// starting with = runs as a formula.
test('csvCell defuses spreadsheet formulas', () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('Ada'), 'Ada');
});

test('toCsv round-trips through parseCsv', () => {
  const rows = [{ email: 'a@b.c', name: 'Ada, "Countess"' }, { email: 'c@d.e', name: '' }];
  const back = parseCsv(toCsv(rows, ['email', 'name']));
  assert.deepEqual(back, rows);
});
