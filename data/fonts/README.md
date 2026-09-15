# Fonts

The bitmap fonts of the renderer, `generated/fonts.js` and `generated/outlines.js`,
are made in
[ReceiptPrinterFontEditor](https://github.com/NielsLeenheer/ReceiptPrinterFontEditor)
and exported from it. Nothing in this repository makes or remakes them, and no
outline font is needed to build it.

The editor works from a project file, `<project>.json` beside this README, which
holds the font as the editor keeps it: the faces it is rasterized from, the rules
of the fit and the glyphs that were drawn by hand. That file is the owner's,
`iosevka-medium.json`, the project the two generated files are exported from,
and the owner commits it with the fonts.

| File | What it is |
|---|---|
| `iosevka-medium.json` | The font editor's project file, the source of the two generated fonts |
| `LICENSE-Iosevka.md` | The SIL Open Font License 1.1 of Iosevka |
| `LICENSE-Sarasa.md` | The SIL Open Font License 1.1 of Sarasa Gothic |
| `LICENSE-Noto.md` | The SIL Open Font License 1.1 of both Noto faces, with the copyright line of each |

**The licence files stay here even though the outline fonts do not.** The packed
glyphs and the glyph outlines of `generated/` are a derivative of these four
faces, and the SIL Open Font License asks the copyright notices and the licence
to travel with a derivative. The sections below are the provenance of the four:
which release was rasterized, and under which copyright line.

The rule of the face, the subsetting of the sources, the fit of a glyph in its
cell and the rebuilding of the fonts are the editor's now, and are documented
there, in its own `data/fonts/README.md` and `src/lib/rasterize.js`. What this
repository asks of a font is the two formats in the Bitmap font section of
`documentation/design.md`.

## Iosevka

The first source, and the face of the renderer.

- Version **34.8.1**, the `Iosevka-Medium.ttf` of the release package
  [`PkgTTF-Iosevka-34.8.1.zip`](https://github.com/be5invis/Iosevka/releases/download/v34.8.1/PkgTTF-Iosevka-34.8.1.zip),
  from [be5invis/Iosevka](https://github.com/be5invis/Iosevka/releases/tag/v34.8.1).
- Copyright (c) 2015-2026, Renzhi Li (aka. Belleve Invis), licensed under the
  SIL Open Font License 1.1. Iosevka declares no Reserved Font Name.
- **Medium** is the weight.

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
  The reserved name is Adobe's `Source`, which neither Sarasa nor anything
  derived from it here carries.
- **SemiBold** is the weight, of the ExtraLight, Light, Regular, SemiBold and
  Bold the family has; there is no Medium. At 12 by 24 SemiBold matches Iosevka
  Medium's stems dot for dot on `H`, `l`, `n` and `e`, and Regular is a dot
  thinner.

## Noto Sans Hebrew

The third source, for the Hebrew of cp862, of Windows-1255 and of the Hebrew
pages of Bixolon, Xprinter and the POS-8360. Iosevka has none of it, so every
one of those pages printed nothing but the fallback box.

- Version **3.001**, the `unhinted/ttf/NotoSansHebrew-Medium.ttf` of the
  release package
  [`NotoSansHebrew-v3.001.zip`](https://github.com/notofonts/hebrew/releases/download/NotoSansHebrew-v3.001/NotoSansHebrew-v3.001.zip),
  from [notofonts/hebrew](https://github.com/notofonts/hebrew/releases/tag/NotoSansHebrew-v3.001).
- Copyright 2024 The Noto Project Authors
  (https://github.com/notofonts/hebrew), which is the line the font's own name
  table carries and the line `LICENSE-Noto.md` beside it repeats; the `OFL.txt`
  of the release package says 2022, which is the year that package was cut, and
  the font in it is the newer of the two. Licensed under the SIL Open Font
  License 1.1. Noto declares no Reserved Font Name.
- **Medium** is the weight, because Iosevka **Medium** is the face, and the
  unhinted build is the one taken: the rasterizer draws the outlines itself and
  never reads a hint.

## Noto Sans Thai

The fourth source, for the Thai of cp874, of Star's own cp874 and of the three
Thai pages of Epson's table, thai42, thai11 and thai13, of the six the ESC/POS
mappings carry between them.

- Version **2.002**, the `unhinted/ttf/NotoSansThai-Medium.ttf` of the release
  package
  [`NotoSansThai-v2.002.zip`](https://github.com/notofonts/thai/releases/download/NotoSansThai-v2.002/NotoSansThai-v2.002.zip),
  from [notofonts/thai](https://github.com/notofonts/thai/releases/tag/NotoSansThai-v2.002).
- Copyright 2022 The Noto Project Authors (https://github.com/notofonts/thai),
  licensed under the SIL Open Font License 1.1.
- **Medium** and unhinted, for the reasons above.
