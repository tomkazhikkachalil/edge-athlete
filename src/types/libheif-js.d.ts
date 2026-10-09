// libheif-js ships no types for its deep entry points. The one we import is
// the self-contained WebAssembly bundle (every-phone round PR 6, Oct 9 2026):
// a CommonJS module whose export is the initialised libheif module object.
// The shape we rely on is typed where it is used (`src/lib/media/heic-decode.ts`).
declare module 'libheif-js/wasm-bundle' {
  const libheif: unknown;
  export default libheif;
}
