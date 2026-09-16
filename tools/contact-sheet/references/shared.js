import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';

import Bitmap from '../../../src/bitmap.js';

/*
    What the reference renderer modules of section 16b share.

    A reference module runs another project's renderer over the same byte stream
    the contact sheet renders itself, so that the two can be looked at side by
    side. Every module exports the same three things:

      name         the name of the tool, as the page shows it
      version      the version or the commit the module was written against
      reference()  what the tool made of one fixture, or why it could not

    None of them throws into the sheet: a tool that is not installed, or that
    fails on a stream, reports itself as unavailable with a reason, and the page
    writes "not available" in its place. A machine with none of the tools builds
    the same sheet without them.

    This module carries the pieces they all need: running a command, reading a
    PNG back as a bitmap, scaling one bitmap to the width of another and the
    coarse agreement metric the page tabulates.
*/

/**
 * @typedef {import('../../../src/types.js').Bitmap} Bitmap
 */

/**
 * What a reference module made of one fixture
 *
 * @typedef {object} Reference
 * @property {string}       tool        Name of the tool
 * @property {string}       version     Version or commit of the tool
 * @property {boolean}      available   Whether the tool ran
 * @property {boolean}      [applicable] False when the tool has nothing to say about this fixture at all,
 *                                       and the sheet leaves its cell out
 * @property {string}       reason      Why it did not run or did not produce a render
 * @property {string}       [file]      Path of what it wrote, relative to the contact sheet, which the page shows
 * @property {string}       [raster]    Path of the raster a bitmap was measured on when `file` is not one, relative
 *                                      to the contact sheet
 * @property {string[]}     [files]     One path per piece of paper, relative to the contact sheet, when the tool
 *                                      has pieces to show; the page stacks them and falls back to `file`
 * @property {string}       [kind]      'image' or 'html'
 * @property {Bitmap}       [bitmap]    The render, for the agreement metric
 * @property {string}       [command]   The exact invocation, for the page
 * @property {string}       [flag]      A warning the sheet shows with the render, such as a pre-filter that was needed
 * @property {string[]}     [filtered]  The commands a pre-filter removed before the tool would render
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Where a reference tool is looked for when it has to be built first */

export const references = path.join(root, 'build', 'references');

export {root};

/**
 * A tool that is not there, as a reference the page can render
 *
 * @param  {string}      tool      Name of the tool
 * @param  {string}      version   Version the module was written against
 * @param  {string}      reason    Why the tool did not run
 * @return {Reference}             The reference
 */
export function unavailable(tool, version, reason) {
  return {tool, version, available: false, reason};
}

/**
 * A reference for a fixture the tool has nothing to say about, which is not
 * the same as a tool that is missing: the sheet shows a missing tool as a
 * "not available" cell and leaves the cell of an inapplicable one out, so a
 * fixture that is not a receiptline document has no receiptio column.
 *
 * @param  {string}   tool      Name of the tool
 * @param  {string}   version   Version or commit of the tool
 * @param  {string}   reason    Why the tool does not apply
 * @return {Reference}          The reference
 */
export function notApplicable(tool, version, reason) {
  return {tool, version, available: false, applicable: false, reason};
}

/**
 * Whether a fixture is a stream a reference renderer can read at all. Every one
 * of them reads ESC/POS and nothing else, so a StarPRNT or a Star Line fixture
 * is reported as out of scope rather than rendered into nonsense.
 *
 * @param  {object}   fixture   The fixture, with its provenance
 * @return {string}             Why the tool cannot read it, or an empty string
 */
export function outOfScope(fixture) {
  return fixture.provenance.language === 'esc-pos' ?
    '' :
    `the tool reads ESC/POS and this stream is ${fixture.provenance.language}`;
}

/**
 * Run a command and wait for it, without letting a failure escape
 *
 * @param  {string}     file      The executable
 * @param  {string[]}   args      Its arguments
 * @param  {object}     options   Options for execFile, a cwd or an env
 * @return {Promise<object>}      The exit code, the output and the error
 */
export function run(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, Object.assign({maxBuffer: 64 * 1024 * 1024}, options), (error, stdout, stderr) => {
      resolve({
        code: error ? error.code ?? 1 : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        error: error ? error.message : '',
      });
    });
  });
}

/**
 * The first path of a list that exists, for finding a tool
 *
 * @param  {string[]}   candidates   The paths to try
 * @return {string}                  The path, or an empty string
 */
export function locate(candidates) {
  return candidates.filter((candidate) => candidate && fs.existsSync(candidate))[0] || '';
}

/**
 * Decompress with the platform's DecompressionStream, the counterpart of the
 * deflate in src/formats/png.js, so that reading a PNG needs no dependency
 * either
 *
 * @param  {Uint8Array}            data   The compressed bytes
 * @return {Promise<Uint8Array>}          The bytes
 */
async function inflate(data) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('No DecompressionStream available, reading a PNG needs one');
  }

  const stream = new DecompressionStream('deflate');
  const writer = stream.writable.getWriter();

  writer.write(data);
  writer.close();

  const reader = stream.readable.getReader();
  const pieces = [];

  let length = 0;

  for (;;) {
    const {done, value} = await reader.read();

    if (done) {
      break;
    }

    pieces.push(value);
    length += value.length;
  }

  const result = new Uint8Array(length);

  let offset = 0;

  for (const piece of pieces) {
    result.set(piece, offset);
    offset += piece.length;
  }

  return result;
}

/**
 * One sample of a scanline as the file writes it, for the bit depths a
 * reference renderer produces. A sixteen bit sample keeps its high byte, which
 * is all a one bit bitmap needs.
 *
 * @param  {Uint8Array}   row     The unfiltered scanline
 * @param  {number}       index   Number of the sample
 * @param  {number}       depth   Bits per sample
 * @return {number}               The value, 0 to (1 << depth) - 1
 */
function bits(row, index, depth) {
  if (depth === 8) {
    return row[index];
  }

  if (depth === 16) {
    return row[index * 2];
  }

  const perByte = 8 / depth;
  const byte = row[Math.floor(index / perByte)];
  const shift = 8 - depth * ((index % perByte) + 1);

  return (byte >> shift) & ((1 << depth) - 1);
}

/**
 * One sample of a scanline, scaled to the 0 to 255 a grey value has
 *
 * @param  {Uint8Array}   row     The unfiltered scanline
 * @param  {number}       index   Number of the sample
 * @param  {number}       depth   Bits per sample
 * @return {number}               The value, 0 to 255
 */
function sample(row, index, depth) {
  if (depth >= 8) {
    return bits(row, index, depth);
  }

  return Math.round((bits(row, index, depth) * 255) / ((1 << depth) - 1));
}

/**
 * Undo the filter of one scanline, the five filters of the PNG specification
 *
 * @param  {number}       filter    Number of the filter
 * @param  {Uint8Array}   row       The scanline, filtered, which is written in place
 * @param  {Uint8Array}   previous  The scanline above, unfiltered
 * @param  {number}       step      Bytes per pixel, at least one
 */
function unfilter(filter, row, previous, step) {
  for (let index = 0; index < row.length; index++) {
    const left = index >= step ? row[index - step] : 0;
    const up = previous[index];
    const corner = index >= step ? previous[index - step] : 0;

    switch (filter) {
      case 1: row[index] = (row[index] + left) & 0xff; break;
      case 2: row[index] = (row[index] + up) & 0xff; break;
      case 3: row[index] = (row[index] + ((left + up) >> 1)) & 0xff; break;
      case 4: {
        const estimate = left + up - corner;
        const dLeft = Math.abs(estimate - left);
        const dUp = Math.abs(estimate - up);
        const dCorner = Math.abs(estimate - corner);
        const nearest = dLeft <= dUp && dLeft <= dCorner ? left : dUp <= dCorner ? up : corner;

        row[index] = (row[index] + nearest) & 0xff;
        break;
      }
      default: break;
    }
  }
}

/**
 * Read a PNG file as pixels: the {width, height, data} object of RGBA samples
 * that the encoder takes as an image and that fromPng() thresholds into a
 * bitmap. A colour type without an alpha channel comes back fully opaque, so
 * that a reader never has to know which type the file was.
 *
 * Only what the reference renderers and the sample scripts write is read, which
 * is enough: greyscale, palette, RGB and RGBA at one, two, four, eight or
 * sixteen bits per sample, not interlaced. Anything else throws, and the module
 * that called it reports the reason.
 *
 * @param  {Uint8Array}      bytes   The contents of a .png file
 * @return {Promise<object>}         The pixels, {width, height, data}
 */
export async function decodePng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const parts = [];

  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let interlace = 0;
  let palette = null;
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      depth = data[8];
      colour = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  if (!width || !height) {
    throw new Error('The PNG has no image header');
  }

  if (interlace) {
    throw new Error('The PNG is interlaced, which is not read here');
  }

  const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colour];

  if (!channels) {
    throw new Error(`The PNG has colour type ${colour}, which is not read here`);
  }

  const compressed = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));

  let at = 0;

  for (const part of parts) {
    compressed.set(part, at);
    at += part.length;
  }

  const raw = await inflate(compressed);

  const rowBytes = Math.ceil((width * channels * depth) / 8);
  const step = Math.max(1, (channels * depth) >> 3);
  const pixels = new Uint8Array(width * height * 4);

  let previous = new Uint8Array(rowBytes);

  for (let y = 0; y < height; y++) {
    const start = y * (rowBytes + 1);
    const row = raw.slice(start + 1, start + 1 + rowBytes);

    unfilter(raw[start], row, previous, step);

    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;

      let red;
      let green;
      let blue;

      if (colour === 3) {
        const base = bits(row, x, depth) * 3;

        red = palette ? palette[base] : 255;
        green = palette ? palette[base + 1] : 255;
        blue = palette ? palette[base + 2] : 255;
      } else if (colour === 0 || colour === 4) {
        red = green = blue = sample(row, x * channels, depth);
      } else {
        const base = x * channels;

        red = sample(row, base, depth);
        green = sample(row, base + 1, depth);
        blue = sample(row, base + 2, depth);
      }

      pixels[target] = red;
      pixels[target + 1] = green;
      pixels[target + 2] = blue;
      pixels[target + 3] = colour === 4 || colour === 6 ?
        sample(row, x * channels + channels - 1, depth) :
        255;
    }

    previous = row;
  }

  return {width, height, data: pixels};
}

/**
 * Read a PNG file as a one bit bitmap: a pixel darker than the threshold is
 * ink. It is decodePng() with the samples of a pixel averaged, which is what
 * every reference render is compared as.
 *
 * @param  {Uint8Array}            bytes       The contents of a .png file
 * @param  {number}                threshold   A sample below this is ink, 0 to 255
 * @return {Promise<Bitmap>}                   The bitmap
 */
export async function fromPng(bytes, threshold = 128) {
  const image = await decodePng(bytes);
  const bitmap = Bitmap.create(image.width, image.height);

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;

      /* A pixel of a colour type with alpha is composited over the white of the
         paper, which is the only reading that makes sense of a render on a
         transparent background: receiptio screenshots its receipt with
         `omitBackground`, so its whole page is black at an alpha of zero and
         every row would carry ink without this. Section 16f. */

      const alpha = image.data[offset + 3] / 255;
      const grey = (image.data[offset] + image.data[offset + 1] + image.data[offset + 2]) / 3;

      if (grey * alpha + 255 * (1 - alpha) < threshold) {
        Bitmap.setPixel(bitmap, x, y, 1);
      }
    }
  }

  return bitmap;
}

/**
 * Scale a bitmap to a width, nearest neighbour, keeping its aspect ratio. It is
 * how a reference render of another width is brought to ours before the two are
 * compared.
 *
 * @param  {Bitmap}   bitmap   The bitmap
 * @param  {number}   width    The width to scale to
 * @return {Bitmap}            The scaled bitmap
 */
export function scaleTo(bitmap, width) {
  if (!bitmap.width || !bitmap.height || bitmap.width === width) {
    return bitmap;
  }

  const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
  const result = Bitmap.create(width, height);

  for (let y = 0; y < height; y++) {
    const source = Math.min(bitmap.height - 1, Math.floor((y * bitmap.height) / height));

    for (let x = 0; x < width; x++) {
      const column = Math.min(bitmap.width - 1, Math.floor((x * bitmap.width) / width));

      if (Bitmap.getPixel(bitmap, column, source)) {
        Bitmap.setPixel(result, x, y, 1);
      }
    }
  }

  return result;
}

/**
 * A rectangle of a bitmap as a bitmap of its own, which is how a reference
 * render that draws margins around its paper is cut down to the paper before
 * it is compared with ours. The rectangle is clipped to the bitmap.
 *
 * @param  {Bitmap}   bitmap   The bitmap
 * @param  {number}   x        Left edge of the rectangle
 * @param  {number}   y        Top edge of the rectangle
 * @param  {number}   width    Width of the rectangle
 * @param  {number}   height   Height of the rectangle
 * @return {Bitmap}            The rectangle
 */
export function crop(bitmap, x, y, width, height) {
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(bitmap.width, x + width);
  const bottom = Math.min(bitmap.height, y + height);
  const result = Bitmap.create(Math.max(0, right - left), Math.max(0, bottom - top));

  for (let row = top; row < bottom; row++) {
    for (let column = left; column < right; column++) {
      if (Bitmap.getPixel(bitmap, column, row)) {
        Bitmap.setPixel(result, column - left, row - top, 1);
      }
    }
  }

  return result;
}

/**
 * The number of rows of a bitmap that carry any ink
 *
 * @param  {Bitmap}   bitmap   The bitmap
 * @return {number}            The number of rows
 */
export function inkRows(bitmap) {
  const bytes = Bitmap.rowBytes(bitmap.width);

  let rows = 0;

  for (let y = 0; y < bitmap.height; y++) {
    for (let byte = 0; byte < bytes; byte++) {
      if (bitmap.data[y * bytes + byte]) {
        rows++;
        break;
      }
    }
  }

  return rows;
}

/**
 * The dot for dot agreement between two renders of the same paper: the fraction
 * of the dots of the larger of the two that are the same in both, with the dots
 * of one that the other does not have counted as a difference.
 *
 * It is the measure of the SVG writer, section 4 of the SVG plan, where the two
 * renders are the same receipt at the same size: an outline filled by a
 * rasterizer and a bitmap made with the 0.45 coverage rule differ at the edges
 * of a stroke and nowhere else, so the number is the drift of the two and not a
 * comparison of two renderers. The coarse metric below is what a reference
 * render of another renderer and another width is compared with.
 *
 * @param  {Bitmap}   ours    One render
 * @param  {Bitmap}   other   The other render, at the same size
 * @return {object}           The fraction that agrees, and the dots of each that the other misses
 */
export function dotAgreement(ours, other) {
  const width = Math.max(ours.width, other.width);
  const height = Math.max(ours.height, other.height);

  let missing = 0;
  let extra = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ink = x < ours.width && y < ours.height && Bitmap.getPixel(ours, x, y);
      const theirs = x < other.width && y < other.height && Bitmap.getPixel(other, x, y);

      if (ink && !theirs) {
        missing++;
      } else if (theirs && !ink) {
        extra++;
      }
    }
  }

  const total = width * height;

  return {agreement: total ? (total - missing - extra) / total : 1, missing, extra, total};
}

/**
 * The coarse agreement between our render and a reference render, the metric of
 * section 16b: the reference is scaled to our width, and what is compared is
 * the number of rows that carry ink in both and the relative difference of the
 * heights. It is information for the maintainer, not a check; nothing fails on
 * it.
 *
 * @param  {Bitmap}   ours        Our render
 * @param  {Bitmap}   reference   The reference render, at its own width
 * @return {object}               The two ink row counts, the two heights and the difference
 */
export function agreement(ours, reference) {
  const scaled = scaleTo(reference, ours.width);

  const rows = inkRows(ours);
  const referenceRows = inkRows(scaled);

  return {
    rows,
    referenceRows,
    height: ours.height,
    referenceHeight: scaled.height,
    rowDifference: rows ? (referenceRows - rows) / rows : null,
    heightDifference: ours.height ? (scaled.height - ours.height) / ours.height : null,
  };
}
