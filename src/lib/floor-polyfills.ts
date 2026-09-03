/**
 * The browser-floor polyfills: a self-contained ES5 IIFE string injected as a
 * BLOCKING inline <script> at the top of the (app) root layout's <head>, ahead
 * of the theme script and every chunk.
 *
 * WHY IT EXISTS (Sep 3 2026, round 6 of the iPhone capture incident): the
 * project's floor is iOS 15 / Safari 15 (package.json browserslist), and the
 * SWC lowering + Next's polyfill-module cover our own code — but Next.js 16's
 * OWN client router chunk calls `structuredClone` bare, and that global is
 * iOS 15.4+. Nothing we write can guard a call inside the framework, so the
 * global is installed before the framework runs. Anything listed in
 * scripts/browser-floor-rules.mjs HEAD_POLYFILLED_GLOBALS must be installed
 * here; src/lib/__tests__/floor-polyfills.test.ts pins that, and pins the
 * script to ES5 (a syntax error in a head script would be the very failure
 * this whole arc exists to prevent).
 *
 * The structuredClone stand-in is the JSON round trip: it loses Map/Set/Date/
 * undefined-valued keys and cannot clone functions or cycles. Acceptable
 * because the only caller below the floor is Next's route-tree/param
 * interpolation (plain objects, strings, arrays); our own code never calls
 * structuredClone (look.ts spells out why). Never rely on this shim for
 * anything richer — feature-detect and fall back in your own code instead.
 *
 * Every step is try/caught: a failure here must fall through to "nothing
 * installed", never to a broken page.
 */
export const FLOOR_POLYFILLS_SCRIPT = `(function(){try{
if(typeof structuredClone!=='function'){
window.structuredClone=function(v){return v===undefined?v:JSON.parse(JSON.stringify(v))};
}
}catch(e){}})()`;
