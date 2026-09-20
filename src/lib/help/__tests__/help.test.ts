import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HELP_TOPICS, slugify } from '../types';
import { excerptOf, linkify, parseHelpBody } from '../body';

describe('the help vocabulary ↔ migration 224', () => {
  it('the topics equal the CHECK', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'database/migrations/224_help_articles.sql'), 'utf8');
    const m = /help_articles_topic_check\s+CHECK \(topic IN \(([^)]*)\)\)/.exec(sql);
    expect(m).toBeTruthy();
    expect([...m![1].matchAll(/'([^']+)'/g)].map(x => x[1])).toEqual([...HELP_TOPICS]);
  });
});

describe('slugify', () => {
  it('matches the CHECK shape', () => {
    expect(slugify('Posting a round')).toBe('posting-a-round');
    expect(slugify('  Événements & tournois!! ')).toBe('evenements-tournois');
    expect(slugify('---')).toBe('');
    expect(slugify('A'.repeat(200))).toHaveLength(80);
    for (const s of ['posting-a-round', 'evenements-tournois']) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('parseHelpBody', () => {
  it('paragraphs, bullets, headings — never HTML', () => {
    const blocks = parseHelpBody('## Start here\n\nFirst para\nsame para.\n\n- one\n- two\n\n<b>not html</b>');
    expect(blocks).toEqual([
      { kind: 'heading', text: 'Start here' },
      { kind: 'paragraph', text: 'First para same para.' },
      { kind: 'bullets', items: ['one', 'two'] },
      { kind: 'paragraph', text: '<b>not html</b>' },
    ]);
    expect(parseHelpBody('')).toEqual([]);
    expect(parseHelpBody('\r\n\r\n  \r\n')).toEqual([]);
  });

  it('the excerpt is the first paragraph, trimmed', () => {
    expect(excerptOf('## H\n\nHello there.\n\nMore.')).toBe('Hello there.');
    expect(excerptOf('x'.repeat(300), 20)).toHaveLength(20);
    expect(excerptOf('- only bullets')).toBe('');
  });

  it('linkify keeps trailing punctuation out of the href', () => {
    expect(linkify('See https://example.com/a. Then go.')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', href: 'https://example.com/a' },
      { kind: 'text', text: '. Then go.' },
    ]);
    expect(linkify('no links')).toEqual([{ kind: 'text', text: 'no links' }]);
  });
});
