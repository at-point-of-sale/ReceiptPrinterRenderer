import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';

import {usedCodepoints, REPLACEMENT_CHARACTER} from './codepoints.js';
import {METRIC_CHARACTERS} from './rasterize.js';

/*
    Subset the outline fonts the renderer draws its glyphs from down to the
    glyphs it can ever print, so that the font sources in the repository are a
    few hundred kilobytes instead of the twenty five megabytes of the two
    source files, which are two files of two families that are larger again.

    There is a list of sources, in the order tools/generate.js reads them, and
    a glyph comes from the first source that has it. So the first source is
    subset to every code point of the set it has, and each later source to the
    code points of the set that no earlier source has. Every subset also keeps
    the handful of characters the fitting rule measures a face on, see
    METRIC_CHARACTERS of tools/rasterize.js: a source is fitted by its own
    advance width, and a subset without an `M` has none.

    The sources are the release packages of the two projects:

        Iosevka 34.8.1
        https://github.com/be5invis/Iosevka/releases/tag/v34.8.1
        https://github.com/be5invis/Iosevka/releases/download/v34.8.1/PkgTTF-Iosevka-34.8.1.zip

        Sarasa Gothic 1.0.41
        https://github.com/be5invis/Sarasa-Gothic/releases/tag/v1.0.41
        https://github.com/be5invis/Sarasa-Gothic/releases/download/v1.0.41/SarasaMonoJ-TTF-Unhinted-1.0.41.7z

    Unpack them and give this tool one path per source, in the order of the
    SUBSETS list below:

        node tools/subset-font.js path/to/Iosevka-Medium.ttf path/to/SarasaMonoJ-SemiBold.ttf

    A source whose path is its own output is read for its coverage and left
    alone. That is how a later subset is rebuilt without touching an earlier
    one, which matters because the output is not byte for byte reproducible,
    see below:

        node tools/subset-font.js data/fonts/iosevka-medium-subset.ttf path/to/SarasaMonoJ-SemiBold.ttf

    The tool reports what each source contributed and lists the code points no
    source has, which are the ones a printer draws the fallback glyph for.

    The kept code points are the ones tools/codepoints.js lists, the union of
    the codepage tables of the codepage encoder and printable ASCII, plus
    U+FFFD, which becomes the fallback glyph. Everything else is dropped: no
    kerning, no layout tables, no variations, nothing but the outlines, the
    advance widths and a cmap.

    The output is not byte for byte reproducible, because opentype.js stamps
    both the `created` and the `modified` field of the head table with the time
    of the run, and it takes an option for the first and none for the second,
    so there is nothing to pin. The subsets are committed, so they are only
    rebuilt when the code point set or a font release changes; the generate
    step that reads them is deterministic.
*/

/*
    The subsets, in the order a glyph is looked for. Each one says where it is
    written and what the family and the style of the subset are called.

    Iosevka declares no Reserved Font Name, so its subset keeps the names of
    the source. Sarasa Gothic is Iosevka's Latin joined with Source Han Sans,
    and the Adobe portions of that carry the Reserved Font Name "Source", so a
    subset may not be called after it; it is not called after Sarasa either,
    because a subset of a face is not that face, and the name says so.
*/

const SUBSETS = [
  {
    output: 'data/fonts/iosevka-medium-subset.ttf',
    names: (font) => ({
      family: font.getEnglishName('fontFamily') || 'Iosevka',
      style: font.getEnglishName('fontSubfamily') || 'Medium',
    }),
  },
  {
    output: 'data/fonts/sarasa-mono-j-semibold-subset.ttf',
    names: () => ({family: 'Sarasa Mono J subset', style: 'SemiBold'}),
  },
];

/**
 * A code point as U+XXXX
 *
 * @param  {number}   codepoint   Unicode code point
 * @return {string}               The code point in the usual notation
 */
function name(codepoint) {
  return 'U+' + codepoint.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Build a subset font that holds the glyphs of a set of code points
 *
 * @param  {object}     font         The full font, parsed by opentype.js
 * @param  {object}     names        The family and the style of the subset
 * @param  {number[]}   codepoints   The code points to keep
 * @return {object}                  The subset font and what went into it
 */
function subset(font, names, codepoints) {
  /* Glyph 0 of any font is .notdef, which a font is not valid without */

  const glyphs = [font.glyphs.get(0)];

  for (const codepoint of codepoints) {
    const index = font.charToGlyphIndex(String.fromCodePoint(codepoint));

    /* The caller only ever asks for code points the source has, see the loop
       at the bottom of this file */

    if (!index) {
      continue;
    }

    const glyph = font.glyphs.get(index);

    /* A copy, because the glyph of the source font carries the index and the
       components it had there. The path of a composite glyph, an accented
       capital for example, is resolved by opentype.js when it is read, so the
       subset holds simple outlines only */

    /* A face whose post table carries no names, which a CJK face of sixty
       thousand glyphs usually does not, gets the usual uniXXXX name here, so
       that the subset has a name table opentype.js can write */

    glyphs.push(new opentype.Glyph({
      name: glyph.name || name(codepoint).replace('U+', 'uni'),
      unicode: codepoint,
      advanceWidth: glyph.advanceWidth,
      path: glyph.path,
    }));
  }

  /* No createdTimestamp: opentype.js writes the time of the run into the
     `modified` field of the head table whatever is passed for `created`, so
     pinning one of the two would only pretend the output is reproducible */

  const subsetFont = new opentype.Font({
    familyName: names.family,
    styleName: names.style,
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    glyphs,
  });

  return {font: subsetFont, glyphs: glyphs.length};
}

const inputs = process.argv.slice(2);

if (inputs.length === 0 || inputs.length > SUBSETS.length) {
  process.stderr.write(
      'Usage: node tools/subset-font.js path/to/Iosevka-Medium.ttf path/to/SarasaMonoJ-SemiBold.ttf\n' +
      'One path per source, in that order. A source that is its own output is read and not rewritten.\n',
  );
  process.exit(1);
}

/* The whole set, the fallback glyph included. A source that has none of it
   still contributes the characters the fitting rule is measured on */

const wanted = [...new Set([...usedCodepoints(), REPLACEMENT_CHARACTER])].sort((a, b) => a - b);
const metrics = [...METRIC_CHARACTERS].map((character) => character.codePointAt(0));

const taken = new Set();

for (const [index, input] of inputs.entries()) {
  const target = SUBSETS[index];
  const source = opentype.parse(fs.readFileSync(input).buffer);

  /* What this source is the first to have, plus the characters it is measured
     on, which every subset keeps whether or not it contributes them */

  const contributed = wanted.filter((codepoint) => !taken.has(codepoint) &&
    source.charToGlyphIndex(String.fromCodePoint(codepoint)));

  const keep = [...new Set([...contributed, ...metrics])].sort((a, b) => a - b);

  /*
     A face is fitted by its own advance width and its own ascender, so a
     subset without the characters those are measured on would be fitted by
     .notdef, silently and wrongly. A source that has none of them is the wrong
     source, so this is an error and not a warning.
  */

  const unmeasurable = metrics.filter((codepoint) =>
    !source.charToGlyphIndex(String.fromCodePoint(codepoint)));

  if (unmeasurable.length) {
    process.stderr.write(
        `${input} has no glyph for ${unmeasurable.map(name).join(' ')}, ` +
        `which the fitting rule measures a face on: ${target.output} not written\n`,
    );

    process.exit(1);
  }

  for (const codepoint of contributed) {
    taken.add(codepoint);
  }

  const own = path.resolve(input) === path.resolve(target.output);

  if (own) {
    process.stdout.write(
        `${target.output}: ${contributed.length} code points, read for its coverage and left alone\n`,
    );

    continue;
  }

  const result = subset(source, target.names(source), keep);

  /* What was asked for is what came out, .notdef ahead of it */

  if (result.glyphs !== keep.length + 1) {
    process.stderr.write(
        `${target.output} holds ${result.glyphs - 1} glyphs of the ${keep.length} that were asked for\n`,
    );

    process.exit(1);
  }

  fs.mkdirSync(path.dirname(target.output), {recursive: true});
  fs.writeFileSync(target.output, Buffer.from(result.font.toArrayBuffer()));

  const size = fs.statSync(target.output).size;
  const original = fs.statSync(input).size;

  process.stdout.write(
      `${target.output}: ${result.glyphs} glyphs, ${size} bytes, from ${original} bytes of ${input}\n` +
      `  ${contributed.length} code points of the set, ` +
      `${keep.length - contributed.length} more for the metrics of the face\n`,
  );
}

const left = wanted.filter((codepoint) => !taken.has(codepoint));

if (left.length) {
  process.stdout.write(
      `${left.length} code points no source has: ${left.map(name).join(' ')}\n`,
  );
}
