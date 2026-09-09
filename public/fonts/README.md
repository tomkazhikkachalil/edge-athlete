# Self-hosted fonts

Every file here is a **latin-subset woff2** of a typeface published under the
SIL Open Font License 1.1 (OFL), which permits bundling and redistribution.
Nothing loads them by default: the media editor's overlay faces are declared
in `globals.css` (`EAInter`, `EALora`, `EACaveat`), and a public org site
loads exactly one heading face — the one its theme picked — through the
`@font-face` + preload `SiteShell` emits (`src/lib/org-sites/theme.ts`).

| File | Family | Weight | Used by |
| --- | --- | --- | --- |
| `inter-600.woff2` | Inter | 600 | media editor overlay text |
| `lora-500.woff2` | Lora | 500 | media editor overlay text |
| `caveat-700.woff2` | Caveat | 700 | media editor overlay text |
| `oswald-600.woff2` | Oswald | 600 | site heading face "Sporty" |
| `lora-700.woff2` | Lora | 700 | site heading face "Editorial" |
| `playfair-700.woff2` | Playfair Display | 700 | site heading face "Classic" |
| `nunito-800.woff2` | Nunito | 800 | site heading face "Friendly" |
| `space-grotesk-700.woff2` | Space Grotesk | 700 | site heading face "Modern" |

Adding a heading face: drop the latin woff2 here, add its entry to
`HEADING_FONTS` in `theme.ts` and the key to `THEME_TYPEFACES` in
`validate.ts`; `theme.test.ts` asserts every entry's file exists.
