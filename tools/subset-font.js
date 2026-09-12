import fs from 'node:fs';
import opentype from 'opentype.js';

import {usedCodepoints, REPLACEMENT_CHARACTER} from './codepoints.js';

/*
    Subset the Iosevka Medium outline font down to the glyphs the renderer can
    ever print, so that the font source in the repository is a hundred kilobytes
    instead of the eleven megabytes of the full family.

    The source is the release package of the Iosevka project:

        Iosevka 34.8.1
        https://github.com/be5invis/Iosevka/releases/tag/v34.8.1
        https://github.com/be5invis/Iosevka/releases/download/v34.8.1/PkgTTF-Iosevka-34.8.1.zip

    Unpack it and give this tool the path to Iosevka-Medium.ttf:

        node tools/subset-font.js path/to/Iosevka-Medium.ttf

    It writes data/fonts/iosevka-medium-subset.ttf, which tools/generate.js
    rasterizes into the packed bitmap fonts. The licence of Iosevka is in
    data/fonts/LICENSE-Iosevka.md and the version in data/fonts/README.md.

    The kept code points are the ones tools/codepoints.js lists, the union of
    the codepage tables of the codepage encoder and printable ASCII, plus
    U+FFFD when the font has it, which becomes the fallback glyph. Everything
    else is dropped: no kerning, no layout tables, no variations, nothing but
    the outlines, the advance widths and a cmap.

    The output is not byte for byte reproducible, because opentype.js stamps
    the head table with the time of the run. The subset is committed, so it is
    only rebuilt when the code point set or the font release changes; the
    generate step that reads it is deterministic.
*/

const OUTPUT = 'data/fonts/iosevka-medium-subset.ttf';

/**
 * Build a subset font that holds the glyphs of a set of code points
 *
 * @param  {object}     font         The full font, parsed by opentype.js
 * @param  {number[]}   codepoints   The code points to keep
 * @return {object}                  The subset font and what went into it
 */
function subset(font, codepoints) {
  /* Glyph 0 of any font is .notdef, which a font is not valid without */

  const glyphs = [font.glyphs.get(0)];
  const missing = [];

  for (const codepoint of codepoints) {
    const index = font.charToGlyphIndex(String.fromCodePoint(codepoint));

    if (!index) {
      missing.push(codepoint);
      continue;
    }

    const glyph = font.glyphs.get(index);

    /* A copy, because the glyph of the source font carries the index and the
       components it had there. The path of a composite glyph, an accented
       capital for example, is resolved by opentype.js when it is read, so the
       subset holds simple outlines only */

    glyphs.push(new opentype.Glyph({
      name: glyph.name,
      unicode: codepoint,
      advanceWidth: glyph.advanceWidth,
      path: glyph.path,
    }));
  }

  const subsetFont = new opentype.Font({
    familyName: font.getEnglishName('fontFamily') || 'Iosevka',
    styleName: font.getEnglishName('fontSubfamily') || 'Medium',
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    createdTimestamp: 0,
    glyphs,
  });

  return {font: subsetFont, glyphs: glyphs.length, missing};
}

const input = process.argv[2];

if (!input) {
  process.stderr.write('Usage: node tools/subset-font.js path/to/Iosevka-Medium.ttf\n');
  process.exit(1);
}

const source = opentype.parse(fs.readFileSync(input).buffer);
const codepoints = usedCodepoints();

if (source.charToGlyphIndex(String.fromCodePoint(REPLACEMENT_CHARACTER))) {
  codepoints.push(REPLACEMENT_CHARACTER);
}

const result = subset(source, [...new Set(codepoints)].sort((a, b) => a - b));

fs.mkdirSync('data/fonts', {recursive: true});
fs.writeFileSync(OUTPUT, Buffer.from(result.font.toArrayBuffer()));

const size = fs.statSync(OUTPUT).size;
const original = fs.statSync(input).size;

process.stdout.write(`${OUTPUT}: ${result.glyphs} glyphs, ${size} bytes, ` +
  `from ${original} bytes of ${input}\n`);

if (result.missing.length) {
  const list = result.missing.map((codepoint) => 'U+' + codepoint.toString(16).toUpperCase().padStart(4, '0'));
  process.stdout.write(`${result.missing.length} code points without a glyph: ${list.join(' ')}\n`);
}
