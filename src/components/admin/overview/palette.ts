/**
 * The Overview's categorical palette (the dataviz skill's reference
 * instance, slots 1–4), VALIDATED on Oct 19 2026 against the app's surfaces
 * with scripts/validate_palette.js: light on #ffffff and dark on #1f1a16 pass
 * every gate; light flags aqua and yellow under 3:1, which the relief rule
 * answers with direct labels and the table view. Hues are assigned in this
 * fixed order, never cycled; a 5th series folds into "Other".
 */
export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const;
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500'] as const;
export const SERIES_VARS = ['--ov-s1', '--ov-s2', '--ov-s3', '--ov-s4'] as const;
/** A lone series wears the brand (the app's violet; the dark step is the brand-fg the theme already defines). */
export const SINGLE_VAR = '--ov-s0';

export const PALETTE_STYLE = `
.ov-root { --ov-s0: #7c3aed; --ov-s1: ${SERIES_LIGHT[0]}; --ov-s2: ${SERIES_LIGHT[1]}; --ov-s3: ${SERIES_LIGHT[2]}; --ov-s4: ${SERIES_LIGHT[3]}; }
:root[data-theme="dark"] .ov-root { --ov-s0: #a78bfa; --ov-s1: ${SERIES_DARK[0]}; --ov-s2: ${SERIES_DARK[1]}; --ov-s3: ${SERIES_DARK[2]}; --ov-s4: ${SERIES_DARK[3]}; }
`;
