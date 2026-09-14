import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';

import {usedCodepoints, REPLACEMENT_CHARACTER} from './codepoints.js';
import {METRIC_CHARACTERS} from './rasterize.js';

/*
    Subset the outline fonts the renderer draws its glyphs from down to the
    glyphs it can ever print, so that the font sources in the repository are a
    few hundred kilobytes instead of the tens of megabytes of the release
    packages.

    There is a list of sources, in the order tools/generate.js reads them, and
    a glyph comes from the first source that has it. So the first source is
    subset to every code point of the set it has, and each later source to the
    code points of the set that no earlier source has.

    The characters the fitting rule measures a face on, METRIC_CHARACTERS of
    tools/rasterize.js, are kept when the source has them and asked of the
    first source alone. The first source is the face: the cell is divided by
    its advance width and the squeeze is measured against its ascender and its
    descender, so a subset of it without an `M` would be fitted to .notdef,
    silently and wrongly, and that is an error and not a warning. A source
    behind it is fitted to the face and needs nothing but glyphs, which is what
    lets a subset of Noto Sans Hebrew, a script with no Latin in it anywhere,
    be a source at all. See the rule of the face in tools/rasterize.js.

    The sources are the release packages of four projects:

        Iosevka 34.8.1
        https://github.com/be5invis/Iosevka/releases/tag/v34.8.1
        https://github.com/be5invis/Iosevka/releases/download/v34.8.1/PkgTTF-Iosevka-34.8.1.zip

        Sarasa Gothic 1.0.41
        https://github.com/be5invis/Sarasa-Gothic/releases/tag/v1.0.41
        https://github.com/be5invis/Sarasa-Gothic/releases/download/v1.0.41/SarasaMonoJ-TTF-Unhinted-1.0.41.7z

        Noto Sans Hebrew 3.001
        https://github.com/notofonts/hebrew/releases/tag/NotoSansHebrew-v3.001

        Noto Sans Thai 2.002
        https://github.com/notofonts/thai/releases/tag/NotoSansThai-v2.002

    Unpack them and give this tool one argument per source, in the order a
    glyph is looked for, with an output on every source that is to be written:

        node tools/subset-font.js \
            path/to/Iosevka-Medium.ttf=data/fonts/iosevka-medium-subset.ttf \
            path/to/SarasaMonoJ-SemiBold.ttf=data/fonts/sarasa-mono-j-semibold-subset.ttf \
            path/to/NotoSansHebrew-Medium.ttf=data/fonts/noto-sans-hebrew-medium-subset.ttf \
            path/to/NotoSansThai-Medium.ttf=data/fonts/noto-sans-thai-medium-subset.ttf

    A source given without an output, or one whose output is its own path, is
    read for its coverage and left alone. That is how a later subset is rebuilt
    without touching an earlier one, which matters because the output is not
    byte for byte reproducible, see below, and because the full Iosevka is not
    on every machine:

        node tools/subset-font.js \
            data/fonts/iosevka-medium-subset.ttf \
            data/fonts/sarasa-mono-j-semibold-subset.ttf \
            path/to/NotoSansHebrew-Medium.ttf=data/fonts/noto-sans-hebrew-medium-subset.ttf \
            path/to/NotoSansThai-Medium.ttf=data/fonts/noto-sans-thai-medium-subset.ttf

    The tool reports what each source contributed, lists the code points no
    source has, and prints the provenance of the run in the shape
    data/fonts/README.md quotes, so that the counts in that file are the counts
    of the tool and not of a hand.

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
    Code points no subset this tool writes ever carries, whatever the source
    has a glyph for: the Unicode format characters, which is the isFormat() of
    tools/rasterize.js and the rule there, in the one other place that has to
    know it.

    A format character is an instruction to whatever lays out the text and
    never a character on the paper, and a printer that gives one cell to every
    code point has nothing to print for it. The fonts draw whatever they like:
    Noto Sans Hebrew draws a full height marker for the two bidi marks of
    Windows-1255, and Iosevka draws the two joiners as a shape that straddles
    its origin. A subset that carried any of them would only be asking
    tools/generate.js to throw the outline away again, so they are left out
    here and the rasterizer draws an empty cell for one that reaches it anyway.

    A source that is read for its coverage and left alone is counted for what
    its file actually holds, format characters included: that file is what
    tools/generate.js reads, and the generator gives every code point in it a
    cell, an empty one for these.
*/

const SKIPPED = [[0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0xfeff, 0xfeff]];

/**
 * Whether a code point is one a subset this tool writes leaves out
 *
 * @param  {number}    codepoint   Unicode code point
 * @return {boolean}               True when it is left out
 */
function skipped(codepoint) {
  return SKIPPED.some(([first, last]) => codepoint >= first && codepoint <= last);
}

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
 * An English name of a font, from wherever opentype.js put it. A font carries
 * its names in several tables and hands back whichever it found: Noto Sans
 * Thai has its names under `windows` alone and getEnglishName() answers
 * undefined for it.
 *
 * @param  {object}    font   The font, parsed by opentype.js
 * @param  {string}    key    Which name, `fontFamily` and the rest
 * @return {?string}          The name, or null when the font has none
 */
function englishName(font, key) {
  const names = font.names || {};

  for (const table of [names, names.unicode, names.windows, names.macintosh]) {
    if (table && table[key] && typeof table[key].en === 'string') {
      return table[key].en;
    }
  }

  return null;
}

/*
    What a subset of a font is called: by default the full name of the source
    with the word `subset` after it, because a subset of a face is not that
    face. The full name is preferred over the family name, because a family
    name is capped at a length in the name table and a font of a weight in its
    family name is abbreviated there, `Noto Sans Thai Med` where the full name
    says `Noto Sans Thai Medium`.

    Two sources are named by the table instead, and both were named that way
    before this tool took a list of sources:

    - Iosevka declares no Reserved Font Name and its subset is the face of the
      renderer, so it keeps the family and the style of the source. That is
      what the committed file carries and what the editor's parity tests read.
    - Sarasa Gothic is Iosevka's Latin joined with Source Han Sans, and the
      Adobe portions of that carry the Reserved Font Name "Source", so a subset
      may not be called after that. It is called after Sarasa, which is not a
      reserved name, and after the face it is cut from rather than after the
      one file of the family that was subset.

    Noto declares no reserved name, so its two subsets take the default.
*/

const NAMES = [
  {family: /^Iosevka\b/, subset: (names) => names},
  {family: /^Sarasa\b/, subset: (names) => ({family: 'Sarasa Mono J subset', style: names.style})},
];

/**
 * The family and the style a subset is written with
 *
 * @param  {object}   font   The source font, parsed by opentype.js
 * @param  {string}   file   Path of the source, for a font that carries no name at all
 * @return {object}          The family and the style of the subset
 */
function namesOf(font, file) {
  const family = englishName(font, 'fontFamily') ||
    path.basename(file, path.extname(file));

  const names = {family, style: englishName(font, 'fontSubfamily') || 'Regular'};

  const entry = NAMES.find((candidate) => candidate.family.test(family));

  if (entry) {
    return entry.subset(names);
  }

  return {family: `${englishName(font, 'fullName') || family} subset`, style: names.style};
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

/**
 * One argument of the command line: a source font, and the subset to write for
 * it when there is one
 *
 * @param  {string}   argument   `input` or `input=output`
 * @return {object}              The input path and the output path, which is null for a source
 *                               that is only read
 */
function sourceOf(argument) {
  const at = argument.indexOf('=');

  return at < 0 ?
    {input: argument, output: null} :
    {input: argument.slice(0, at), output: argument.slice(at + 1)};
}

const USAGE =
  'Usage: node tools/subset-font.js <source>[=<output>] ...\n' +
  'One argument per source font, in the order a glyph is looked for. A source with an output is\n' +
  'subset to the code points of the set that no source before it has; a source without one, or one\n' +
  'whose output is its own path, is read for its coverage and left alone. The first source is the\n' +
  'face and has to have the characters the fitting rule measures it on; the sources behind it are\n' +
  'fitted to the face and need only glyphs.\n';

const inputs = process.argv.slice(2).map(sourceOf);

if (inputs.length === 0 || inputs.some((source) => !source.input)) {
  process.stderr.write(USAGE);
  process.exit(1);
}

/* The whole set, the fallback glyph included */

const wanted = [...new Set([...usedCodepoints(), REPLACEMENT_CHARACTER])].sort((a, b) => a - b);

const metrics = [...METRIC_CHARACTERS].map((character) => character.codePointAt(0));

const taken = new Set();

/* What the provenance table at the end is written from */

const report = [];

for (const [index, source] of inputs.entries()) {
  const bytes = fs.readFileSync(source.input);
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

  const has = (codepoint) => Boolean(font.charToGlyphIndex(String.fromCodePoint(codepoint)));

  const written = Boolean(source.output) && path.resolve(source.input) !== path.resolve(source.output);

  /* What this source is the first to have. A source that is written loses the
     format characters, see SKIPPED; one that is read and left alone is counted
     for what its file holds, because that file is what the generator reads */

  const contributed = wanted.filter((codepoint) => !taken.has(codepoint) && has(codepoint) &&
    (!written || !skipped(codepoint)));

  /*
     And the characters the fitting rule measures a face on, when the source
     has them. The first source is the face and is measured on all thirteen; a
     source behind it is fitted to the face and is asked for nothing, which is
     what lets a subset of a script that has no Latin be a source.
  */

  const kept = metrics.filter(has);
  const missing = metrics.filter((codepoint) => !has(codepoint));

  if (index === 0 && missing.length) {
    process.stderr.write(
        `${source.input} is the first source, which is the face, and it has no glyph for ` +
        `${missing.map(name).join(' ')}, which the fitting rule measures a face on: nothing written\n`,
    );

    process.exit(1);
  }

  const keep = [...new Set([...contributed, ...kept])].sort((a, b) => a - b);

  for (const codepoint of contributed) {
    taken.add(codepoint);
  }

  report.push({
    input: source.input,
    output: written ? source.output : null,
    contributed: contributed.length,
    metrics: keep.length - contributed.length,
  });

  if (!written) {
    process.stdout.write(
        `${source.input}: ${contributed.length} code points, read for its coverage and left alone\n`,
    );

    continue;
  }

  const result = subset(font, namesOf(font, source.input), keep);

  /* What was asked for is what came out, .notdef ahead of it */

  if (result.glyphs !== keep.length + 1) {
    process.stderr.write(
        `${source.output} holds ${result.glyphs - 1} glyphs of the ${keep.length} that were asked for\n`,
    );

    process.exit(1);
  }

  fs.mkdirSync(path.dirname(source.output), {recursive: true});
  fs.writeFileSync(source.output, Buffer.from(result.font.toArrayBuffer()));

  const size = fs.statSync(source.output).size;
  const original = fs.statSync(source.input).size;

  process.stdout.write(
      `${source.output}: ${result.glyphs} glyphs, ${size} bytes, from ${original} bytes of ${source.input}\n` +
      `  ${contributed.length} code points of the set, ` +
      `${keep.length - contributed.length} more for the metrics of the face\n`,
  );

  report[report.length - 1].glyphs = result.glyphs;
  report[report.length - 1].size = size;
}

const left = wanted.filter((codepoint) => !taken.has(codepoint));

if (left.length) {
  process.stdout.write(`${left.length} code points no source has, which print the fallback\n`);
}

/* The provenance of the run, in the shape data/fonts/README.md quotes: the
   counts there are the tool's and never a hand's */

process.stdout.write('\nProvenance, for data/fonts/README.md:\n\n');
process.stdout.write('| Source | Subset | Code points of the set | Metric characters | Glyphs | Bytes |\n');
process.stdout.write('|---|---|---|---|---|---|\n');

for (const entry of report) {
  /* A source that is only read for its coverage keeps no characters and is
     written no file, so those columns are blank rather than a zero that could
     be read as a subset without an `M` in it */

  process.stdout.write(
      `| \`${path.basename(entry.input)}\` | ${entry.output ? `\`${entry.output}\`` : 'read only'} | ` +
      `${entry.contributed} | ${entry.output ? entry.metrics : ''} | ` +
      `${entry.glyphs ?? ''} | ${entry.size ?? ''} |\n`,
  );
}

process.stdout.write(
    `\n${taken.size} of the ${wanted.length} code points of the set are covered, ` +
    `${left.length} are not.\n`,
);
