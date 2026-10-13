import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Video posters PR 3 (Oct 13 2026): the activity page and the recorder ride
// the one upload queue; a clip's poster is grabbed by the one shared grab.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

describe('source pins — activities on the queue', () => {
  it('the activity page attaches and re-edits through the queue and sends the clip\'s poster on the row', () => {
    const screen = read('src/components/activities/ActivityScreen.tsx');
    expect(screen).toMatch(/useMediaUploadQueue\(\{ sessionId: `activity:\$\{a\.id\}`, targetProfileId: \(\) => a\.profileId \}\)/);
    expect(screen).toMatch(/grabPosterInto\(uploads\.queue, item\.localId, accepted\[i\]\)/);
    expect(screen).toMatch(/thumbnail_url: landed\.posterUrl \?\? null, targetProfileId: a\.profileId \}\)/);
    expect(screen).not.toMatch(/thumbnail_url: null/); // the re-edit used to throw the poster away
    expect(screen).not.toMatch(/uploadPostMedia/);
  });
  it('the recorder keeps one queue per recording (its stash keyed by the id), tells the reducer what landed and what failed, grabs the clip\'s poster, and resumes from the stash', () => {
    const engine = read('src/components/activities/record/RecordingEngineHost.tsx');
    expect(engine).toMatch(/sessionId: `recording:\$\{recordingId\}`/);
    expect(engine).toMatch(/dispatch\(\{ type: 'photoUploaded', localId: item\.localId, url: item\.storedUrl, thumbnailUrl: item\.posterUrl \?\? null \}\)/);
    expect(engine).toMatch(/dispatch\(\{ type: 'photoFailed', localId: item\.localId \}\)/);
    expect(engine).toMatch(/dispatch\(\{ type: 'photoRetried', localId \}\)/);
    expect(engine).toMatch(/grabPosterInto\(q, item\.localId, plan\.attach\[i\]\)/);
    expect(engine).toMatch(/await q\.resumeFromStash\(\)/);
    expect(engine).not.toMatch(/store\?\.savePhoto/); // the Blob store is read for older recordings only, never written
    expect(engine).toMatch(/store\.loadPhoto\(s\.id, p\.localId\)/);
    expect(engine).not.toMatch(/uploadQueue\.current/);
  });
  it('the one grab: on the device chain, at posterTimeFor, with a deadline, photos ignored', () => {
    const grab = read('src/components/media/grab-poster.ts');
    expect(grab).toMatch(/if \(!file\.type\.startsWith\('video\/'\)\) return;/);
    expect(grab).toMatch(/queue\.device\(async \(\) =>/);
    expect(grab).toMatch(/capturePoster\(file, posterTimeFor\(null\)\)/);
    expect(grab).toMatch(/POSTER_GRAB_DEADLINE_MS/);
    for (const f of ['src/components/workouts/useSetMediaUploads.ts', 'src/components/activities/ActivityScreen.tsx', 'src/components/activities/record/RecordingEngineHost.tsx']) {
      expect(read(f), f).toMatch(/grabPosterInto\(/);
      expect(read(f), f).not.toMatch(/capturePoster\(/);
    }
  });
});
