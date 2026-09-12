# Fonts

The bitmap fonts of the renderer are rasterized from an outline font at build
time by `tools/generate.js`, which writes `generated/fonts.js`.

| File | What it is |
|---|---|
| `iosevka-medium-subset.ttf` | Iosevka Medium, subset to the code points the renderer can print |
| `LICENSE-Iosevka.md` | The SIL Open Font License 1.1 of Iosevka |

## Iosevka

- Version **34.8.1**, the `Iosevka-Medium.ttf` of the release package
  [`PkgTTF-Iosevka-34.8.1.zip`](https://github.com/be5invis/Iosevka/releases/download/v34.8.1/PkgTTF-Iosevka-34.8.1.zip),
  from [be5invis/Iosevka](https://github.com/be5invis/Iosevka/releases/tag/v34.8.1).
- Copyright (c) 2015-2026, Renzhi Li (aka. Belleve Invis), licensed under the
  SIL Open Font License 1.1. Iosevka declares no Reserved Font Name.

The full family is eleven megabytes, so only the glyphs that can ever be
printed are kept, the union of the codepage tables of the codepage encoder and
printable ASCII plus U+FFFD, 779 of them. To rebuild the subset, download the
release package and run:

    node tools/subset-font.js path/to/Iosevka-Medium.ttf

It is committed, so that `npm run generate` needs nothing but this repository.
