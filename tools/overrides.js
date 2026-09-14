import fs from 'node:fs';

/*
    The hand made glyphs, data/fonts/overrides.json, laid over the rasterized
    ones for tools/generate.js.

    The fonts of the renderer are rasterized from the outline fonts in
    data/fonts by the four rules of tools/rasterize.js, and those rules get a
    number of glyphs wrong in a way no rule fixes: the shin dot and the sin dot
    of the Hebrew come out as the same dot, the Thai head loops fill solid, the
    kana are a stroke too heavy for the cell. Those glyphs are drawn by hand in
    ReceiptPrinterFontEditor, which exports this file, and this module lays them
    over the rasterized result.

    That keeps the build reproducible and the font a product of the outlines
    plus one small file: every glyph is still rasterized by the rules, `npm run
    generate` still needs nothing but this repository, and a review of the font
    is a review of the diff of this file, which is why the dots are ASCII art
    and not base64.

    The format, which is the editor's src/lib/overrides.js and the Overrides and
    OverridesFace typedefs of its src/lib/types.js:

        {
          "version": 1,                  version of the format, 1
          "fonts": ["iosevka-...ttf"],   the source fonts the dots were drawn
                                         over, in the order a glyph is looked
                                         for, which is SOURCES of the generator
          "commit": "4460626...",        the commit of this repository the
                                         editor's rasterizer was ported from,
                                         or null
          "faces": {
            "12x24": {                   the key is the cell, the way the
                                         generator names its fonts
              "width": 12,
              "height": 24,
              "baseline": 18,
              "glyphs": {
                "1488": [".....#....",   the code point, and the cell as rows
                         "..........",   of '#' and '.', one row per line so
                         ...]            that a diff shows which dots changed
              }
            },
            "8x16": { ... }
          }
        }

    Only the glyphs a hand touched are in the file. A glyph the rasterizer made
    is not, because putting it there would ask the generator to override its
    rasterizer with its rasterizer; a face with nothing pinned is in the file
    all the same, with no glyphs, so that the file says which cells were
    reviewed.

    The cell of a face is checked against the font of this build, the baseline
    with it: a face whose baseline is not the row the build's font stands on was
    drawn against another cell, and laying its dots over the rasterized glyphs
    would put them on the wrong rows, a letter sitting a dot above the line of
    every letter beside it. It is refused, with both rows in the message.

    The `fonts` and the `commit` stay provenance only and nothing is refused
    over them: they say which outlines the dots were drawn over and which port
    of these rules drew the glyphs underneath them, and neither can be checked
    here. A source list that is not SOURCES is not wrong by itself, an editor
    may hold fewer sources than the build or name them another way, and there is
    no constant in this repository that says which commit the rules last changed
    in. So the generator prints what the file carries, and a `fonts` or a
    `commit` that is not the one of this build is the reviewer's cue to look at
    the glyphs: dots drawn over other outlines or an older rasterizer may sit
    beside glyphs the rules since moved.
*/

export const OVERRIDES_FILE = 'data/fonts/overrides.json';

/* The version of the format this reads, which is the version the editor
   writes */

export const OVERRIDES_VERSION = 1;

/**
 * The bytes of one cell, from the rows of the file
 *
 * @param  {string[]}     rows     The rows of the cell, '#' is ink
 * @param  {number}       width    Cell width in dots
 * @param  {number}       height   Cell height in dots
 * @return {Uint8Array}            The packed rows, as the packed font holds them
 */
function packCell(rows, width, height) {
  const rowBytes = Math.ceil(width / 8);
  const cell = new Uint8Array(rowBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rows[y].charAt(x) === '#') {
        cell[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return cell;
}

/**
 * Check one face of the file: its cell, its baseline, and the rows of every
 * glyph in it
 *
 * @param  {object}    face       The face, as the file holds it
 * @param  {string}    key        The key it is under, which is its cell
 * @param  {string}    where      Name of the file, for the message
 * @param  {number}    [baseline] Row the font of this build stands on, when it is known
 */
function validateFace(face, key, where, baseline) {
  if (!face || typeof face !== 'object') {
    throw new Error(`${where}: the ${key} face is not an object`);
  }

  const [width, height] = key.split('x').map(Number);

  if (face.width !== width || face.height !== height) {
    throw new Error(
        `${where}: the ${key} face says its cell is ${face.width}x${face.height}, ` +
        'and a face is under the key of its own cell',
    );
  }

  /* The dots of a face are rows of a cell, so a face that stands on another row
     than the font of this build holds its glyphs a dot or more off the line of
     every glyph beside them */

  if (typeof baseline === 'number' && face.baseline !== baseline) {
    throw new Error(
        `${where}: the ${key} face stands on baseline ${face.baseline}, ` +
        `and the ${key} font of this build stands on row ${baseline}`,
    );
  }

  if (!face.glyphs || typeof face.glyphs !== 'object') {
    throw new Error(`${where}: the ${key} face has no glyphs object`);
  }

  for (const [codepoint, rows] of Object.entries(face.glyphs)) {
    const name = `U+${Number(codepoint).toString(16).toUpperCase().padStart(4, '0')}`;

    if (!Number.isInteger(Number(codepoint)) || Number(codepoint) < 0) {
      throw new Error(`${where}: ${codepoint} in the ${key} face is not a code point`);
    }

    if (!Array.isArray(rows) || rows.length !== height) {
      throw new Error(
          `${where}: the glyph of ${name} in the ${key} face has ` +
          `${Array.isArray(rows) ? rows.length : 'no'} rows, and the cell is ${height} dots high`,
      );
    }

    for (let y = 0; y < rows.length; y++) {
      if (typeof rows[y] !== 'string' || rows[y].length !== width) {
        throw new Error(
            `${where}: row ${y} of the glyph of ${name} in the ${key} face is ` +
            `${typeof rows[y] === 'string' ? rows[y].length : 'not'} dots wide, ` +
            `and the cell is ${width} dots wide`,
        );
      }

      const wrong = rows[y].split('').find((character) => character !== '#' && character !== '.');

      if (wrong !== undefined) {
        throw new Error(
            `${where}: row ${y} of the glyph of ${name} in the ${key} face holds '${wrong}', ` +
            'and a row of a cell is \'#\' and \'.\' and nothing else',
        );
      }
    }
  }
}

/**
 * Check an overrides file: the version, the cells it holds a face for, and the
 * shape of every face and every glyph
 *
 * @param  {object}     overrides   The parsed file
 * @param  {object[]}   cells       The fonts that are packed, with their name, width and height
 * @param  {string}     [where]     Name of the file, for the message
 * @return {object}                 The overrides, unchanged
 */
export function validateOverrides(overrides, cells, where = OVERRIDES_FILE) {
  if (!overrides || typeof overrides !== 'object') {
    throw new Error(`${where}: not an object`);
  }

  if (overrides.version !== OVERRIDES_VERSION) {
    throw new Error(
        `${where}: version ${JSON.stringify(overrides.version)}, ` +
        `and this reads version ${OVERRIDES_VERSION} of the format`,
    );
  }

  if (!overrides.faces || typeof overrides.faces !== 'object') {
    throw new Error(`${where}: no faces object`);
  }

  const known = cells.map((cell) => cell.name);

  for (const [key, face] of Object.entries(overrides.faces)) {
    /* A face under a cell this build does not pack is refused rather than
       skipped: the dots were drawn for a font that is not in the font, and
       passing over them without a word would ship a font the file says is
       something else */

    if (!known.includes(key)) {
      throw new Error(
          `${where}: a face of ${key} dots, and the fonts of this build are ${known.join(' and ')}`,
      );
    }

    validateFace(face, key, where, cells.find((cell) => cell.name === key).baseline);
  }

  return overrides;
}

/**
 * Read the overrides file, when there is one
 *
 * @param  {string}     file    Path of the file
 * @param  {object[]}   cells   The fonts that are packed, with their name, width and height
 * @return {?object}            The overrides, or null when the file is not there
 */
export function readOverrides(file, cells) {
  if (!fs.existsSync(file)) {
    return null;
  }

  let parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }

  return validateOverrides(parsed, cells, file);
}

/**
 * How many glyphs an overrides file holds, over every face
 *
 * @param  {?object}   overrides   The overrides
 * @return {number}                The number of glyphs
 */
export function countOverrides(overrides) {
  if (!overrides) {
    return 0;
  }

  return Object.values(overrides.faces)
      .reduce((total, face) => total + Object.keys(face.glyphs).length, 0);
}

/**
 * The provenance of an overrides file as a line for the report of the
 * generator: what the dots were drawn over, and which port of the rasterizer
 * drew the glyphs they were drawn over. A commit that is not the one the rules
 * of this repository were last changed in is the reviewer's cue to look at the
 * glyphs.
 *
 * @param  {?object}   overrides   The overrides
 * @param  {string}    [file]      Path of the file
 * @return {string}                The line, with its newline, or the empty string
 */
export function overridesReport(overrides, file = OVERRIDES_FILE) {
  if (!overrides) {
    return '';
  }

  const fonts = Array.isArray(overrides.fonts) && overrides.fonts.length ?
    overrides.fonts.join(', ') :
    'no source';

  const commit = overrides.commit ? overrides.commit : 'no commit';

  const count = countOverrides(overrides);

  return `overrides: ${file}, version ${overrides.version}, ${count} hand made ` +
      `${count === 1 ? 'glyph' : 'glyphs'} over ${fonts}, rasterizer of ${commit}\n`;
}

/**
 * Lay the hand made glyphs of one face over the glyphs of a packed font.
 *
 * A code point the font has keeps its glyph number and gets the rows of the
 * file; a code point the font does not have is added as a glyph of its own,
 * because the editor exports what its face holds and a face may hold a glyph
 * for a code point no codepage of this build can reach. Such a glyph has dots
 * and no outline, so the SVG output draws the fallback for it: there is no
 * source to take an outline from, which is why it was drawn by hand.
 *
 * @param  {object}   packed   A packed font, as generateFonts makes it
 * @param  {object}   face     The face of that cell, as the overrides file holds it
 * @return {object}            The packed font with the dots laid over it, and what that took
 */
export function applyOverrides(packed, face) {
  const key = `${packed.width}x${packed.height}`;

  validateFace(face, key, OVERRIDES_FILE, packed.baseline);

  const rowBytes = Math.ceil(packed.width / 8);
  const glyphBytes = rowBytes * packed.height;

  const bytes = Buffer.from(packed.data, 'base64');
  const index = {...packed.index};
  const appended = [];

  let overridden = 0;
  let added = 0;

  const codepoints = Object.keys(face.glyphs).map(Number).sort((a, b) => a - b);

  for (const codepoint of codepoints) {
    const cell = packCell(face.glyphs[codepoint], packed.width, packed.height);

    if (index[codepoint] === undefined) {
      index[codepoint] = bytes.length / glyphBytes + appended.length;
      appended.push(cell);
      added++;
      continue;
    }

    bytes.set(cell, index[codepoint] * glyphBytes);
    overridden++;
  }

  const data = appended.length ?
    Buffer.concat([bytes, ...appended.map((cell) => Buffer.from(cell))]).toString('base64') :
    bytes.toString('base64');

  return {packed: {...packed, index, data}, overridden, added};
}
