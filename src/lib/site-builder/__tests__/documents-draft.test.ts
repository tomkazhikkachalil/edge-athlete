import { describe, expect, it } from 'vitest';
import { documentsPayload, readDocumentDrafts } from '../documents-draft';

describe('documents drafts (H1)', () => {
  it('reads the stored list; a file clears the link', () => {
    expect(
      readDocumentDrafts({
        documents: [
          { title: 'Bylaws', path: 'org-media/s/bylaws.pdf' },
          { title: 'Code of conduct', url: 'https://example.com/coc' },
          'junk',
        ],
      })
    ).toEqual([
      { title: 'Bylaws', path: 'org-media/s/bylaws.pdf', url: '' },
      { title: 'Code of conduct', path: '', url: 'https://example.com/coc' },
    ]);
    expect(readDocumentDrafts({})).toEqual([]);
  });

  it('the payload drops untitled or empty rows and trims; a file wins over a link', () => {
    expect(
      documentsPayload([
        { title: ' Bylaws ', path: 'org-media/s/b.pdf', url: 'https://x.example' },
        { title: 'Waiver', path: '', url: ' https://example.com/w ' },
        { title: '', path: '', url: 'https://example.com/nameless' },
        { title: 'Nothing attached', path: '', url: '' },
      ])
    ).toEqual([
      { title: 'Bylaws', path: 'org-media/s/b.pdf' },
      { title: 'Waiver', url: 'https://example.com/w' },
    ]);
  });
});
