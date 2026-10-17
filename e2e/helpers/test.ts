// ── The one `test` every spec imports (every-browser round, Oct 16 2026) ────
// `@playwright/test` plus the browser PROFILE of the project running: under
// `brave-android` every context — the default one and each a spec opens with
// browser.newContext() — gets Brave's Shields (helpers/brave.ts). Every other
// project gets plain Playwright. Specs import from here, never from
// '@playwright/test' directly (pinned by src/lib/__tests__/e2e-imports.test.ts),
// so a new browser profile reaches the whole suite at once.

import { test as base } from '@playwright/test';
import { applyBrave } from './brave';

export * from '@playwright/test';

export const test = base.extend<object, { _browserProfile: void }>({
  _browserProfile: [
    async ({ browser }, use, workerInfo) => {
      if (workerInfo.project.name === 'brave-android') {
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (...args) => {
          const context = await newContext(...args);
          await applyBrave(context);
          return context;
        };
      }
      await use();
    },
    { scope: 'worker', auto: true },
  ],
});
