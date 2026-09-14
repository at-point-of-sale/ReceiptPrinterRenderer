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
| `noto-sans-hebrew-medium-subset.ttf` | Noto Sans Hebrew Medium, subset to the Hebrew no source before it has |
| `noto-sans-thai-medium-subset.ttf` | Noto Sans Thai Medium, subset to the Thai no source before it has |
| `LICENSE-Noto.md` | The SIL Open Font License 1.1 of both, with the copyright line of each |

## The rule of the face

**The first source is the face and every source behind it is fitted to it.**
The face is measured, on its advance width and on the ascender and the
descender of thirteen Latin characters; a source behind it is never measured,
it takes the scale of the face corrected for the size of its em alone. See the
rule of the face in `tools/rasterize.js`.

That rule exists because of the two Noto fonts. Google publishes Noto Sans
Hebrew and Noto Sans Thai as the script alone, 151 and 140 glyphs with no `M`
anywhere to measure, so the old rule, which measured every source for itself,
refused them at the door. The builds that do carry a Latin carry Noto's
proportional one, whose `M` is 902 units at 1000 per em in the Hebrew and 918
in the Thai where Iosevka's is 500: measured on that, the two would be drawn at
a cap height of 9.5 and 9.3 dots beside a Latin of 17.6, correct by the letter
of the rule and wrong on the paper.

Fitted to the face instead, א is 14.3 dots tall and ก is 13.4, between the x
height of Iosevka Medium, 12.5, and its cap height, 17.6, which is where a
receipt wants them. Nothing was scaled to make that happen: it is the face's
own scale, and all four fonts are drawn on the same em. Sarasa, whose em and
whose reference advance are Iosevka's, therefore inherits exactly the numbers
it used to measure for itself, and every glyph it draws is unchanged to the
last bit.

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
  cap height 17.64 dots, descender 5.35, vertical cap 1, so it inherits the fit
  of the face without changing a number.

The one `SarasaMonoJ-SemiBold.ttf` is fourteen megabytes and the release
package holds the whole family, 51 megabytes. The subset holds the 76 code
points of the set that Iosevka has not, the 63 half width katakana of JIS X
0201 and the twelve kanji and the postal mark of Epson's katakana table, plus
the thirteen characters the fitting rule measures a face on, which it has as
well: 90 glyphs, 24 kB.

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
  License 1.1. Noto declares no Reserved Font Name, so the subset keeps the
  name of the source with the word `subset` added, **Noto Sans Hebrew Medium
  subset**.
- **Medium** is the weight, because Iosevka **Medium** is the face. The
  unhinted build is the one taken, the way the Sarasa is: the rasterizer draws
  the outlines itself and never reads a hint.
- It holds every one of the 51 Hebrew code points of the set, the 22 letters
  and the five final forms from U+05D0 to U+05EA, the sixteen niqqud, the three
  Yiddish digraphs, the geresh and the gershayim, the maqaf, the paseq and the
  sof pasuq.
- It keeps none of the thirteen characters the fitting rule measures a face on,
  because it has none of them: a source behind the face is not measured.
- **`U+05C1` and `U+05C2`, the shin dot and the sin dot, come out as the same
  single dot.** They are one dot each, drawn to the right and to the left of
  the letter they sit over, and the centring puts ink in the middle of the cell
  by the ink alone, which is the one thing that tells the two apart. A printer
  that gives every code point a cell of its own has nowhere else to put them;
  telling them apart is hand work in the editor, and so is the weight of the
  rest of the niqqud.

## Noto Sans Thai

The fourth source, for the Thai of cp874, of Star's own cp874 and of the three
Thai pages of Epson's table, thai42, thai11 and thai13, of the six the ESC/POS
mappings carry between them.

- Version **2.002**, the `unhinted/ttf/NotoSansThai-Medium.ttf` of the release
  package
  [`NotoSansThai-v2.002.zip`](https://github.com/notofonts/thai/releases/download/NotoSansThai-v2.002/NotoSansThai-v2.002.zip),
  from [notofonts/thai](https://github.com/notofonts/thai/releases/tag/NotoSansThai-v2.002).
- Copyright 2022 The Noto Project Authors (https://github.com/notofonts/thai),
  licensed under the SIL Open Font License 1.1, and named **Noto Sans Thai
  Medium subset** for the reason above.
- **Medium** and unhinted, for the reasons above.
- The source has every one of the 87 Thai code points of the set, the
  consonants, the vowels, the four tone marks, the digits and the two paragraph
  marks, the sixteen combining vowel and tone marks among them, `U+0E31`,
  `U+0E34` to `U+0E3A` and `U+0E47` to `U+0E4E`, which have an advance of zero.
- The subset holds **86** of those, because the 87th, the baht sign `U+0E3F`
  ฿, is one Iosevka already has and a glyph comes from the first source that
  has it. No metric characters either, for the reason above.

## The provenance of the build

This is the table `tools/subset-font.js` prints at the end of the run that made
the two Noto subsets, so these numbers are the tool's and not a hand's. The two
fonts of the face were read for their coverage and left alone, which is why
they have no file and no metric characters in the table.

| Source | Subset | Code points of the set | Metric characters | Glyphs | Bytes |
|---|---|---|---|---|---|
| `iosevka-medium-subset.ttf` | read only | 779 |  |  |  |
| `sarasa-mono-j-semibold-subset.ttf` | read only | 76 |  |  |  |
| `NotoSansHebrew-Medium.ttf` | `data/fonts/noto-sans-hebrew-medium-subset.ttf` | 51 | 0 | 52 | 7944 |
| `NotoSansThai-Medium.ttf` | `data/fonts/noto-sans-thai-medium-subset.ttf` | 86 | 0 | 87 | 19556 |

992 of the 1326 code points of the set are covered by a source, and the
generator adds the two bidi marks as empty cells, which makes 994 in
`generated/fonts.js`; 332 are left over: Arabic 163, Khmer 103 and 66 that no
printer prints, 63 control codes and three private use code points.

## What a subset leaves out

The **Unicode format characters**, all of them: `U+200B` to `U+200F`, `U+2028`
to `U+202E`, `U+2060` to `U+2064` and `U+FEFF`. Four of those are in the code
point set, the two joiners that Iosevka has and the two bidi marks that
Windows-1255 carries and that Noto Sans Hebrew has a glyph for. A format
character is an instruction to whatever lays out the text and never a character
on the paper, and the fonts draw whatever they like for one: Noto's bidi marks
are a full height marker and Iosevka's joiners straddle their origin. So no
subset this tool writes carries one, the rasterizer draws an empty cell for one
that reaches it anyway, and `tools/generate.js` gives every format character of
the set a cell of its own whether or not a source has a glyph, so that none of
them is the fallback box either. See `isFormat()` in `tools/rasterize.js`.

The committed Iosevka subset is older than the rule and still holds the two
joiners; they are drawn as an empty cell all the same, which is why they are
counted among the 779 code points it covers here and not among the 701 it
contributes to the packed font. The two bidi marks are in no subset, and the
generator draws their empty cell itself.

## Rebuilding

Download the release packages, unpack them, and run the tool with one argument
per source in the order a glyph is looked for, `input=output` on every source
that is to be written:

    node tools/subset-font.js \
        path/to/Iosevka-Medium.ttf=data/fonts/iosevka-medium-subset.ttf \
        path/to/SarasaMonoJ-SemiBold.ttf=data/fonts/sarasa-mono-j-semibold-subset.ttf \
        NotoSansHebrew/unhinted/ttf/NotoSansHebrew-Medium.ttf=data/fonts/noto-sans-hebrew-medium-subset.ttf \
        NotoSansThai/unhinted/ttf/NotoSansThai-Medium.ttf=data/fonts/noto-sans-thai-medium-subset.ttf

A source given without an output, or one whose output is its own path, is read
for its coverage and left alone, so a later subset is rebuilt without touching
an earlier one:

    node tools/subset-font.js \
        data/fonts/iosevka-medium-subset.ttf \
        data/fonts/sarasa-mono-j-semibold-subset.ttf \
        NotoSansHebrew/unhinted/ttf/NotoSansHebrew-Medium.ttf=data/fonts/noto-sans-hebrew-medium-subset.ttf \
        NotoSansThai/unhinted/ttf/NotoSansThai-Medium.ttf=data/fonts/noto-sans-thai-medium-subset.ttf

It prints what every source contributed and the provenance of the run in the
shape of the table above. The output is not byte for byte reproducible,
opentype.js stamps the head table with the time of the run, which is why the
subsets are committed and not built: `npm run generate` needs nothing but this
repository.
