import { describe, expect, it } from 'vitest';
import { parseCsv, parseRoster } from './csv-import';

describe('parseCsv', () => {
  it('handles quotes, embedded commas and newlines, CRLF, BOM and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n\r\n"multi\nline",z')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['multi\nline', 'z'],
    ]);
  });
  it('detects a tab-separated spreadsheet paste', () => {
    expect(parseCsv('Name\tEmail\nAna\tana@x.test')).toEqual([
      ['Name', 'Email'],
      ['Ana', 'ana@x.test'],
    ]);
  });
});

describe('parseRoster', () => {
  it('maps common header spellings and keeps optional fields', () => {
    const r = parseRoster(
      'Full Name,E-mail Address,Goal,Time Zone,Weight Unit,Phone\nAna Silva,ana@x.test,Run 10k,Europe/Lisbon,lb,123\nBen,ben@x.test,,,,',
    );
    expect(r.error).toBeNull();
    expect(r.columns).toEqual({
      name: 'Full Name',
      email: 'E-mail Address',
      goals: 'Goal',
      timezone: 'Time Zone',
      units: 'Weight Unit',
    });
    expect(r.rows).toEqual([
      {
        name: 'Ana Silva',
        email: 'ana@x.test',
        goals: 'Run 10k',
        timezone: 'Europe/Lisbon',
        units: 'lb',
      },
      { name: 'Ben', email: 'ben@x.test' },
    ]);
  });
  it('joins first and last name columns', () => {
    const r = parseRoster('First Name,Last Name,Email\nAna,Silva,ana@x.test\nBen,,ben@x.test');
    expect(r.columns.name).toBe('First Name + Last Name');
    expect(r.rows.map((x) => x.name)).toEqual(['Ana Silva', 'Ben']);
  });
  it('reports a missing email or name column, an empty file, and a header-only file', () => {
    expect(parseRoster('Name,Phone\nAna,1').error).toMatch(/No email column/);
    expect(parseRoster('Email\nana@x.test').error).toMatch(/No name column/);
    expect(parseRoster('  \n').error).toBe('The file is empty.');
    expect(parseRoster('Name,Email\n').error).toMatch(/no clients/);
  });
});
