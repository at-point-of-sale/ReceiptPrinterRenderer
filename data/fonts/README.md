# Fonts

The bitmap fonts of the renderer are rasterized from outline fonts at build
time by `tools/generate.js`, which writes `generated/fonts.js`. There is a list
of sources, and a glyph comes from the first source that has the code point.

| File | What it is |
|---|---|
| `iosevka-medium-subset.ttf` | Iosevka Medium, subset to the code points the renderer can print |
| `LICENSE-Iosevka.md` | The SIL Open Font License 1.1 of Iosevka |
| `sarasa-mono-j-semibold-subset.ttf` | Sarasa Mono J SemiBold, subset to the code points Iosevka has not |
| `LICENSE-Sarasa.md` | The SIL Open Font License 1.1 of Sarasa Gothic |

## Iosevka

The first source, and the face of the renderer.

- Version **34.8.1**, the `Iosevka-Medium.ttf` of the release package
  [`PkgTTF-Iosevka-34.8.1.zip`](https://github.com/be5invis/Iosevka/releases/download/v34.8.1/PkgTTF-Iosevka-34.8.1.zip),
  from [be5invis/Iosevka](https://github.com/be5invis/Iosevka/releases/tag/v34.8.1).
- Copyright (c) 2015-2026, Renzhi Li (aka. Belleve Invis), licensed under the
  SIL Open Font License 1.1. Iosevka declares no Reserved Font Name, so the
  subset keeps the family and style names of the source.

The full family is eleven megabytes, so only the glyphs that can ever be
printed are kept, the union of the codepage tables of the codepage encoder and
printable ASCII plus U+FFFD, 779 of them.

## Sarasa Mono J

The second source, for the half width katakana. Iosevka has no kana, so every
character of the katakana codepage of either printer family printed as the
fallback box until this was added; Sarasa Gothic is Iosevka's Latin joined with
Source Han Sans, so its kana sit on the same metrics as the face.

- Version **1.0.41**, the `SarasaMonoJ-SemiBold.ttf` of the release package
  [`SarasaMonoJ-TTF-Unhinted-1.0.41.7z`](https://github.com/be5invis/Sarasa-Gothic/releases/download/v1.0.41/SarasaMonoJ-TTF-Unhinted-1.0.41.7z),
  from [be5invis/Sarasa-Gothic](https://github.com/be5invis/Sarasa-Gothic/releases/tag/v1.0.41).
- Copyright (c) 2015-2025, Renzhi Li (aka. Belleve Invis). Portions Copyright
  (c) 2016 The Inter Project Authors. Portions Copyright (c) 2014-2021 Adobe
  Systems Incorporated, **with Reserved Font Name 'Source'**. Portions
  Copyright (c) 2012 Google Inc. Licensed under the SIL Open Font License 1.1.
- The reserved name is Adobe's `Source`, which neither Sarasa nor this subset
  carries. The subset is called after Sarasa, **Sarasa Mono J subset**, style
  SemiBold: it is called after the face it is cut from, and the word `subset`
  is there because a subset of a face is not that face and the name says so.
- **SemiBold** is the weight, of the ExtraLight, Light, Regular, SemiBold and
  Bold the family has; there is no Medium. Measured with the editor's
  rasterizer at 12 by 24, SemiBold matches Iosevka Medium's stems dot for dot
  on `H`, `l`, `n` and `e`, and Regular is a dot thinner.
- Its metrics are Iosevka's to the second decimal: em 1000, advance of `M` 500,
  cap height 17.64 dots, descender 5.35, vertical cap 1, so the fitting rule
  applies to it unchanged.

The one `SarasaMonoJ-SemiBold.ttf` is fourteen megabytes and the release
package holds the whole family, 51 megabytes. The subset holds the 76 code
points of the set that Iosevka has not, the 63 half width katakana of JIS X 0201 and the
twelve kanji and the postal mark of Epson's katakana table, plus the thirteen
characters the fitting rule measures a face on, which every subset keeps
whether or not it contributes them: 90 glyphs, 24 kB.

## Rebuilding

Download the release packages and run the tool with one path per source, in
the order above:

    node tools/subset-font.js path/to/Iosevka-Medium.ttf path/to/SarasaMonoJ-SemiBold.ttf

A source whose path is its own output is read for its coverage and left alone,
so a later subset is rebuilt without touching an earlier one:

    node tools/subset-font.js data/fonts/iosevka-medium-subset.ttf path/to/SarasaMonoJ-SemiBold.ttf

The output is not byte for byte reproducible, opentype.js stamps the head table
with the time of the run, which is why the subsets are committed and not built:
`npm run generate` needs nothing but this repository.
