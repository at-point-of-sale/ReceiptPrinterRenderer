import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ReceiptPrinterRenderer, {EscPosRenderer, StarPrntRenderer} from '../src/receipt-printer-renderer.js';
import Bitmap from '../src/bitmap.js';
import {stitch} from '../src/formats/stitch.js';
import {barcode as encodeBarcode} from '../src/symbologies/index.js';
import {qrcode as encodeQrcode} from '../src/symbologies/qrcode.js';
import {pdf417 as encodePdf417} from '../src/symbologies/pdf417.js';
import {names, fixture} from './helpers/fixtures.js';
import {libraries, fixtures, external, options} from './helpers/external.js';
import {toJson} from './helpers/layout.js';
import {assert} from 'chai';

/*
    The display list, see documentation/display-list.md.

    The first half of this file holds the rules that every fixture of every
    directory has to follow, the second half checks the entries and the
    operations of the fixtures of the plan against numbers written out here, and
    the last part draws the rectangles and the images of the symbol fixtures
    into a bitmap and compares them with what the symbologies and the parsers
    produce.
*/

/* The printer the fixtures were made for, see test/tools/make-fixtures.js */

const WIDTH = 576;
const COMMANDS = ['cut', 'pulse', 'feed'];

/* The markers of the list, the entries that are not boxes of the paper */

const MARKERS = ['cut', 'pulse', 'unknown'];

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * Every fixture of the two languages and the external suite, with the renderer
 * options its directory asks for
 *
 * @return {object[]}   The fixtures, with their directory and their options
 */
function every() {
  const list = [];

  for (const [language, mapping] of [['esc-pos', 'epson'], ['star-prnt', 'star']]) {
    for (const directory of [language, `${language}/raw`]) {
      for (const name of names(directory)) {
        list.push({
          directory,
          name,
          options: {language, width: WIDTH, codepageMapping: mapping, commands: COMMANDS},
        });
      }
    }
  }

  for (const library of libraries()) {
    for (const name of fixtures(library)) {
      list.push({
        directory: `external/${library}`,
        name,
        options: options(external(library, name).provenance),
      });
    }
  }

  return list;
}

/**
 * The bytes of a fixture
 *
 * @param  {object}       entry   One of every()
 * @return {Uint8Array}           The commands
 */
function bytes(entry) {
  return new Uint8Array(fs.readFileSync(path.join(root, entry.directory, `${entry.name}.bin`)));
}

/**
 * The display list of a fixture of the golden directories
 *
 * @param  {string}   directory   Name of the directory, 'esc-pos' or 'esc-pos/raw'
 * @param  {string}   name        Name of the fixture
 * @return {object}               The list
 */
function layout(directory, name) {
  const language = directory.startsWith('star') ? 'star-prnt' : 'esc-pos';

  const renderer = new ReceiptPrinterRenderer({
    language,
    width: WIDTH,
    codepageMapping: language === 'esc-pos' ? 'epson' : 'star',
    commands: COMMANDS,
  });

  return renderer.layout(fixture(directory, name).bytes);
}

/**
 * The text of a line, one character per text operation, so that a line can be
 * named in a test the way it reads on paper
 *
 * @param  {object}   entry   A line entry
 * @return {string}           The characters of its text operations
 */
function text(entry) {
  return entry.operations
      .filter((operation) => operation.type === 'text')
      .map((operation) => operation.codepoint ? String.fromCodePoint(operation.codepoint) : '￼')
      .join('');
}

/**
 * The rectangles and the images of a line, drawn into a bitmap of their own, so
 * that the test can compare them with the symbol the symbology produces
 *
 * @param  {object[]}   operations   The operations of a line
 * @param  {number}     width        Width of the bitmap
 * @param  {number}     height       Height of the bitmap
 * @param  {number}     [left]       Position the bitmap starts at, from the left of the line
 * @param  {number}     [top]        Row the bitmap starts at, from the top of the line
 * @return {object}                  The bitmap
 */
function draw(operations, width, height, left = 0, top = 0) {
  const bitmap = Bitmap.create(width, height);

  for (const operation of operations) {
    if (operation.type === 'rect') {
      for (let y = 0; y < operation.height; y++) {
        for (let x = 0; x < operation.width; x++) {
          Bitmap.setPixel(bitmap, operation.x - left + x, operation.y - top + y, 1);
        }
      }
    }

    if (operation.type === 'image') {
      Bitmap.blit(
          {width: operation.width, height: operation.height, data: operation.data},
          bitmap,
          operation.x - left,
          operation.y - top,
      );
    }
  }

  return bitmap;
}

/**
 * The dots of a bitmap, as a string, so that two bitmaps can be compared
 *
 * @param  {object}   bitmap   The bitmap
 * @return {string}            The dots
 */
function dots(bitmap) {
  return `${bitmap.width}x${bitmap.height}:${Array.from(bitmap.data).join(',')}`;
}

/**
 * The bars of a barcode as the symbology encodes them, as a bitmap
 *
 * @param  {object}   code     The barcode, as the symbology returned it
 * @param  {number}   module   Width of a module in dots
 * @param  {number}   height   Height of the bars in dots
 * @return {object}            The bars
 */
function bars(code, module, height) {
  const width = code.bars.reduce((total, bar) => total + bar, 0) * module;
  const bitmap = Bitmap.create(width, height);

  let x = 0;

  for (let index = 0; index < code.bars.length; index++) {
    const bar = code.bars[index] * module;

    if (index % 2 === 0) {
      for (let column = x; column < x + bar; column++) {
        for (let row = 0; row < height; row++) {
          Bitmap.setPixel(bitmap, column, row, 1);
        }
      }
    }

    x += bar;
  }

  return bitmap;
}

/**
 * The line entry of a fixture that holds the rectangles or the images of a
 * block, by the number of the block on the paper
 *
 * @param  {object}   list      The display list
 * @param  {string}   type      Type of the operations, 'rect' or 'image'
 * @param  {number}   [index]   Which of them, the first one by default
 * @return {object}             The line entry
 */
function block(list, type, index = 0) {
  const blocks = list.entries.filter(
      (entry) => entry.type === 'line' && entry.operations.some((operation) => operation.type === type),
  );

  assert.isAbove(blocks.length, index, `the list has no ${type} block ${index}`);

  return blocks[index];
}

describe('the display list', function() {
  describe('every fixture', function() {
    for (const entry of every()) {
      describe(`${entry.directory}/${entry.name}`, function() {
        it('should carry the width, the language and the resolution of its renderer', function() {
          const renderer = new ReceiptPrinterRenderer(entry.options);
          const list = renderer.layout(bytes(entry));

          assert.equal(list.version, 1);
          assert.equal(list.language, entry.options.language);
          assert.equal(list.width, entry.options.width);
          /* Both built in profiles print at 203 dots per inch */

          assert.equal(list.dpi, 203);
          assert.isArray(list.entries);
        });

        it('should keep every operation inside the paper', function() {
          const renderer = new ReceiptPrinterRenderer(entry.options);
          const list = renderer.layout(bytes(entry));

          const inside = (operations, surface, where) => {
            for (const operation of operations) {
              assert.isAtLeast(operation.x, 0, `${where} ${operation.type} starts at ${operation.x}`);
              assert.isAtMost(
                  operation.x + operation.width,
                  surface,
                  `${where} ${operation.type} ends at ${operation.x + operation.width} of ${surface}`,
              );
            }
          };

          for (const box of list.entries) {
            if (box.type === 'line') {
              inside(box.operations, list.width, 'a line');
            }

            if (box.type === 'page') {
              for (const area of box.areas) {
                assert.isAtLeast(area.x, 0);
                assert.isAtMost(area.x + area.width, list.width);

                const sideways = area.direction === 1 || area.direction === 3;

                for (const line of area.entries) {
                  if (line.type === 'line') {
                    inside(line.operations, sideways ? area.height : area.width, 'an area');
                  }
                }
              }
            }
          }
        });

        it('should be as tall as the paper of a render', function() {
          const renderer = new ReceiptPrinterRenderer(entry.options);
          const list = renderer.layout(bytes(entry));

          assert.equal(list.height, stitch(renderer.render(bytes(entry)), {width: list.width}).height);

          /* And a driver that performs none of the commands gets the paper of a
             printer that cuts nothing off, in the list as on the paper */

          const plain = new ReceiptPrinterRenderer(Object.assign({}, entry.options, {commands: []}));

          assert.equal(
              plain.layout(bytes(entry)).height,
              stitch(plain.render(bytes(entry)), {width: list.width}).height,
          );
        });

        it('should have the markers of the item stream at the rows of the paper', function() {
          const renderer = new ReceiptPrinterRenderer(entry.options);
          const items = renderer.render(bytes(entry));
          const list = renderer.layout(bytes(entry));

          const supported = new Set(entry.options.commands || []);

          /* The list holds every command there is, the item stream only the
             ones the driver supports, and a marker stands at the row the paper
             has when its command arrives */

          const markers = list.entries
              .filter((box) => MARKERS.includes(box.type) && supported.has(box.type))
              .map((box) => ({type: box.type, y: box.y}));

          const expected = [];

          let row = 0;

          for (const item of items) {
            if (item.type === 'image' || item.type === 'feed') {
              row += item.height;
              continue;
            }

            expected.push({type: item.type, y: row});
          }

          assert.deepEqual(markers, expected);
        });
      });
    }
  });

  describe('text', function() {
    it('should be one operation per character, in the cell of font A', function() {
      const list = layout('esc-pos', 'text');

      assert.deepEqual(list.entries.map((entry) => [entry.type, entry.y, entry.height]), [
        ['line', 0, 30],
        ['line', 30, 30],
        ['feed', 60, 30],
        ['line', 90, 30],
      ]);

      const line = list.entries[0];

      assert.equal(text(line), 'ReceiptPrinterRenderer');
      assert.equal(line.rotation, 0);
      assert.equal(line.operations.length, 22);

      assert.deepEqual(line.operations[0], {
        type: 'text',
        x: 0,
        y: 0,
        width: 12,
        height: 24,
        codepoint: 0x52,
        font: 'A',
        cell: {width: 12, height: 24},
        glyph: {width: 12, height: 24},
        baseline: 18,
        scale: {x: 1, y: 1},
        style: {bold: false, underline: 0, upperline: 0, invert: false},
        rotation: 0,
      });

      /* The cells follow each other by the width of the cell, and the gap of
         the line spacing is the six rows below the cells of the line */

      assert.deepEqual(line.operations.map((operation) => operation.x), [
        0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144, 156, 168, 180, 192, 204, 216, 228, 240, 252,
      ]);

      assert.deepEqual(line.operations.map((operation) => operation.y), new Array(22).fill(0));
    });
  });

  describe('styles', function() {
    it('should carry the whole style of every cell', function() {
      const list = layout('esc-pos', 'styles');
      const style = (entry, index) => entry.operations[index].style;

      assert.deepEqual(style(list.entries[0], 0), {bold: true, underline: 0, upperline: 0, invert: false});
      assert.deepEqual(style(list.entries[0], 5), {bold: false, underline: 0, upperline: 0, invert: false});

      assert.deepEqual(style(list.entries[1], 0), {bold: false, underline: 1, upperline: 0, invert: false});
      assert.deepEqual(style(list.entries[1], 10), {bold: false, underline: 0, upperline: 0, invert: false});

      assert.deepEqual(style(list.entries[2], 0), {bold: false, underline: 0, upperline: 0, invert: true});
      assert.deepEqual(style(list.entries[2], 7), {bold: false, underline: 0, upperline: 0, invert: false});

      assert.deepEqual(style(list.entries[4], 0), {bold: true, underline: 1, upperline: 0, invert: false});
    });
  });

  describe('sizes', function() {
    it('should scale the box of a cell and keep its unscaled cell', function() {
      const list = layout('esc-pos', 'sizes');
      const triple = list.entries[4];

      assert.equal(triple.y, 156);
      assert.equal(triple.height, 72);

      for (const operation of triple.operations) {
        assert.deepEqual(operation.scale, {x: 3, y: 3});
        assert.deepEqual(operation.cell, {width: 12, height: 24});
        assert.equal(operation.width, 36);
        assert.equal(operation.height, 72);
        assert.equal(operation.baseline, 18);
      }

      assert.deepEqual(triple.operations.map((operation) => operation.x), [0, 36, 72]);
    });

    it('should put the cells of a mixed line on one baseline', function() {
      const list = layout('esc-pos', 'sizes');
      const mixed = list.entries[5];

      /* The tallest ascent is the 1x3 cell, 54 dots, and the largest descent is
         six dots, so the line is 72 dots and its baseline is row 54. Every cell
         stands at `baseline - ascent` from the top of the line */

      assert.equal(mixed.height, 72);

      assert.deepEqual(mixed.operations.map((operation) => [
        String.fromCodePoint(operation.codepoint), operation.x, operation.y, operation.width, operation.height,
      ]), [
        ['a', 0, 36, 12, 24],
        ['B', 12, 18, 24, 48],
        ['c', 36, 0, 12, 72],
        ['d', 48, 36, 12, 24],
      ]);
    });
  });

  describe('fonts', function() {
    it('should carry the cell of the profile and the glyph box of the font', function() {
      const list = layout('esc-pos', 'fonts');

      const a = list.entries[0].operations[0];
      const b = list.entries[1].operations[0];

      assert.deepEqual(a.cell, {width: 12, height: 24});
      assert.deepEqual(a.glyph, {width: 12, height: 24});
      assert.equal(a.baseline, 18);
      assert.equal(a.font, 'A');

      assert.deepEqual(b.cell, {width: 9, height: 17});
      assert.deepEqual(b.glyph, {width: 8, height: 16});
      assert.equal(b.baseline, 12);
      assert.equal(b.font, 'B');

      /* The cells of font B follow each other by the nine dots of the Epson
         cell, not by the eight of the glyphs */

      assert.deepEqual(list.entries[1].operations.slice(0, 4).map((operation) => operation.x), [0, 9, 18, 27]);
    });

    it('should keep the code points of the box drawing characters', function() {
      const list = layout('esc-pos', 'fonts');

      assert.equal(text(list.entries[2]), '┌─┬─┐ │ ║ ╔═╗');
      assert.equal(list.entries[2].operations[0].codepoint, 0x250c);
    });
  });

  describe('alignment', function() {
    it('should hold the cells of the encoder where the alignment puts them', function() {
      const list = layout('esc-pos', 'alignment');

      /* The encoder aligns by padding with spaces, so the cells of the line are
         where the spaces put them and every line starts at the left margin */

      assert.deepEqual(list.entries.map((entry) => entry.operations.length), [12, 28, 48, 10]);
      assert.deepEqual(list.entries.map((entry) => entry.operations[0].x), [0, 0, 0, 0]);

      const centred = list.entries[1].operations.findIndex((operation) => operation.codepoint !== 0x20);
      const right = list.entries[2].operations.findIndex((operation) => operation.codepoint !== 0x20);

      assert.equal(list.entries[1].operations[centred].x, 240);
      assert.equal(list.entries[2].operations[right].x, 420);
    });
  });

  describe('wrap', function() {
    it('should break a line that is longer than the print width', function() {
      const list = layout('esc-pos', 'wrap');

      assert.deepEqual(list.entries.map((entry) => [entry.y, entry.height]), [[0, 30], [30, 30], [60, 30]]);
      assert.deepEqual(list.entries.map((entry) => entry.operations.length), [45, 48, 27]);

      /* The full line is 48 cells of 12 dots, so no cell of it reaches past the
         576 dots of the paper */

      for (const entry of list.entries) {
        const last = entry.operations[entry.operations.length - 1];

        assert.isAtMost(last.x + last.width, 576);
      }
    });
  });

  describe('box', function() {
    it('should draw the borders of a box as text cells', function() {
      const list = layout('esc-pos', 'box');

      assert.equal(text(list.entries[0]), '┌──────────────────────────────────────────────┐');
      assert.equal(text(list.entries[5]), '║                 A double box                 ║');

      assert.equal(list.entries[0].operations.length, 48);
      assert.equal(list.entries[0].operations[47].x, 564);
    });
  });

  describe('table', function() {
    it('should hold the columns of a table as one line each', function() {
      const list = layout('esc-pos', 'table');

      assert.deepEqual(list.entries.map((entry) => entry.type), ['line', 'line', 'line', 'line']);
      assert.equal(text(list.entries[1]), 'Coffee                    2                 5.00');

      /* The last column ends at the right edge of the paper, which is what the
         encoder aligns it to */

      const line = list.entries[1];
      const last = line.operations[line.operations.length - 1];

      assert.equal(last.x + last.width, 576);
    });
  });

  describe('hri', function() {
    it('should put the human readable text under the bars in the font of the command', function() {
      const list = layout('esc-pos', 'hri');

      /* The bars are 95 modules of three dots, centred on the paper, and the
         text is thirteen cells centred under them, four dots below the bars */

      const none = list.entries[1];
      const fontA = list.entries[4];
      const fontB = list.entries[7];

      assert.equal(none.height, 50);
      assert.equal(fontA.height, 78);
      assert.equal(fontB.height, 71);

      assert.equal(none.operations.every((operation) => operation.type === 'rect'), true);

      const cells = fontA.operations.filter((operation) => operation.type === 'text');

      assert.equal(cells.length, 13);
      assert.equal(cells.map((operation) => String.fromCodePoint(operation.codepoint)).join(''), '4006381333931');
      assert.deepEqual(cells[0].cell, {width: 12, height: 24});
      assert.equal(cells[0].x, 209);
      assert.equal(cells[0].y, 54);
      assert.deepEqual(cells[0].style, {bold: false, underline: 0, upperline: 0, invert: false});

      const small = fontB.operations.filter((operation) => operation.type === 'text');

      assert.deepEqual(small[0].cell, {width: 9, height: 17});
      assert.equal(small[0].y, 54);
      assert.equal(small[0].x, 229);
    });
  });

  describe('upside down printing', function() {
    it('should turn the line box and leave its operations upright', function() {
      const list = layout('esc-pos/raw', 'upside-down');

      assert.deepEqual(list.entries.map((entry) => entry.rotation), [0, 180, 180, 180, 0]);

      for (const entry of list.entries) {
        for (const operation of entry.operations) {
          assert.equal(operation.rotation, 0);
        }
      }

      /* A centred line is centred in the frame of the line, which the rotation
         turns as a whole */

      assert.equal(list.entries[3].operations[0].x, 174);
    });
  });

  describe('the rotation of ESC V', function() {
    it('should swap the sides of the box of every cell', function() {
      const list = layout('esc-pos/raw', 'rotation');

      const upright = list.entries[0].operations[0];
      const turned = list.entries[1].operations[0];
      const large = list.entries[2].operations[0];

      assert.equal(upright.rotation, 0);
      assert.equal(upright.width, 12);
      assert.equal(upright.height, 24);

      assert.equal(turned.rotation, 90);
      assert.equal(turned.width, 24);
      assert.equal(turned.height, 12);
      assert.deepEqual(turned.cell, {width: 12, height: 24});
      assert.deepEqual(turned.scale, {x: 1, y: 1});

      assert.equal(large.rotation, 90);
      assert.equal(large.width, 48);
      assert.equal(large.height, 24);
      assert.deepEqual(large.scale, {x: 2, y: 2});

      /* The turned cells go left to right and stand on the bottom of the line
         box, the way a cell without a baseline does */

      assert.deepEqual(list.entries[1].operations.slice(0, 3).map((operation) => operation.x), [0, 24, 48]);
      assert.deepEqual(list.entries[1].operations.slice(0, 3).map((operation) => operation.y), [0, 0, 0]);

      /* A right aligned rotated line is aligned on the width of its cells */

      assert.equal(list.entries[4].operations[0].x, 48);
    });
  });

  describe('downloaded glyphs', function() {
    it('should carry the dots of the glyph instead of a code point', function() {
      const list = layout('esc-pos/raw', 'user-defined');
      const line = list.entries[2];

      /* The three glyphs the stream defined, and the one the ESC of the label
         of the line is drawn with, which is a glyph of the same set */

      const glyphs = line.operations.filter((operation) => operation.bitmap);

      assert.equal(glyphs.length, 4);
      assert.deepEqual(glyphs.map((operation) => operation.x), [192, 264, 276, 288]);

      for (const operation of glyphs) {
        assert.isUndefined(operation.codepoint);
        assert.equal(operation.font, 'A');
        assert.deepEqual(operation.cell, {width: 12, height: 24});
        assert.deepEqual(operation.glyph, {width: 12, height: 24});
        assert.equal(operation.baseline, 18);
        assert.equal(operation.width, 12);
        assert.equal(operation.height, 24);
        assert.equal(operation.bitmap.width, 12);
        assert.equal(operation.bitmap.height, 24);
        assert.instanceOf(operation.bitmap.data, Uint8Array);
      }

      /* The same glyphs in a double size, which scales the cell and not the
         dots the stream defined */

      const large = list.entries[3].operations;

      assert.equal(large.length, 3);
      assert.deepEqual(large[0].scale, {x: 2, y: 2});
      assert.equal(large[0].width, 24);
      assert.equal(large[0].height, 48);
      assert.equal(large[0].bitmap.width, 12);
    });
  });

  describe('margins', function() {
    it('should apply the left margin and the print area to the position of a cell', function() {
      const list = layout('esc-pos/raw', 'margins');

      assert.equal(list.entries[0].operations[0].x, 0);
      assert.equal(list.entries[1].operations[0].x, 24);
      assert.equal(list.entries[2].operations[0].x, 168);
      assert.equal(list.entries[3].operations[0].x, 336);
      assert.equal(list.entries[4].operations[0].x, 0);
    });
  });

  describe('tabs', function() {
    it('should put the cells behind a tab on the stop', function() {
      const list = layout('esc-pos/raw', 'tabs');

      assert.deepEqual(list.entries[0].operations.map((operation) => operation.x), [0, 96, 192, 288]);

      const line = list.entries[1];

      assert.equal(text(line), 'ItemQtyPrice');
      assert.deepEqual(line.operations.map((operation) => operation.x).slice(0, 6), [0, 12, 24, 36, 120, 132]);
    });
  });

  describe('character spacing', function() {
    it('should leave the spacing behind every cell and scale it with the width', function() {
      const list = layout('esc-pos/raw', 'spacing');

      assert.deepEqual(list.entries[0].operations.map((operation) => operation.x), [0, 12, 24, 36, 48]);
      assert.deepEqual(list.entries[1].operations.slice(0, 4).map((operation) => operation.x), [0, 16, 32, 48]);

      /* Four dots of spacing behind a double width cell is eight dots */

      assert.deepEqual(list.entries[2].operations.slice(0, 4).map((operation) => operation.x), [0, 32, 64, 96]);
      assert.equal(list.entries[2].operations[0].width, 24);
    });
  });

  describe('positions', function() {
    it('should put a cell where the position command puts it', function() {
      const list = layout('esc-pos/raw', 'positions');
      const line = list.entries[0];

      assert.equal(text(line), 'LeftMiddleRight');
      assert.deepEqual(line.operations.map((operation) => operation.x).slice(0, 6), [0, 12, 24, 36, 240, 252]);

      const last = line.operations[line.operations.length - 1];

      assert.equal(last.x, 468);
    });
  });

  describe('page mode', function() {
    it('should hold the four print directions as areas of one page', function() {
      const list = layout('esc-pos/raw', 'page-mode-directions');

      assert.deepEqual(list.entries.map((entry) => entry.type), ['line', 'page', 'line']);

      const page = list.entries[1];

      assert.equal(page.y, 30);
      assert.equal(page.height, 240);
      assert.equal(page.areas.length, 4);

      assert.deepEqual(page.areas.map((area) => [area.x, area.y, area.width, area.height, area.direction]), [
        [0, 0, 288, 120, 0],
        [288, 0, 288, 120, 1],
        [0, 120, 288, 120, 2],
        [288, 120, 288, 120, 3],
      ]);

      for (const area of page.areas) {
        assert.deepEqual(area.entries.map((entry) => [entry.type, entry.y, entry.height]), [
          ['line', 0, 30],
          ['line', 30, 30],
        ]);

        /* The entries of an area are in the logical frame of its direction, and
           ESC { and ESC V are standard mode commands, so nothing of a page is
           turned by anything but the direction of its area */

        for (const entry of area.entries) {
          assert.equal(entry.rotation, 0);

          for (const operation of entry.operations) {
            assert.equal(operation.rotation, 0);
          }
        }
      }

      assert.equal(text(page.areas[0].entries[0]), 'Dir 0');
      assert.equal(text(page.areas[3].entries[0]), 'Dir 3');
    });

    it('should print a page that was kept twice, with what was added to it', function() {
      const list = layout('esc-pos/raw', 'page-mode-esc-ff');

      assert.deepEqual(list.entries.map((entry) => [entry.type, entry.y, entry.height]), [
        ['page', 0, 100],
        ['page', 100, 100],
        ['line', 200, 30],
      ]);

      assert.equal(list.entries[0].areas.length, 1);
      assert.equal(list.entries[1].areas.length, 2);

      assert.equal(text(list.entries[0].areas[0].entries[0]), 'Printed twice');
      assert.equal(text(list.entries[1].areas[0].entries[0]), 'Printed twice');
      assert.equal(text(list.entries[1].areas[1].entries[0]), 'Only in the second print');
    });
  });

  describe('the symbols', function() {
    it('should draw the bars of a barcode as the symbology encodes them', function() {
      const cases = [
        {name: 'ean13', symbology: 'ean13', data: '4006381333931', module: 3, height: 60},
        {name: 'ean8', symbology: 'ean8', data: '96385074', module: 3, height: 60},
        {name: 'upca', symbology: 'upca', data: '123456789012', module: 3, height: 60},
        {name: 'upce', symbology: 'upce', data: '01234565', module: 3, height: 60},
        {name: 'code39', symbology: 'code39', data: 'ABC-123', module: 3, height: 60},
        {name: 'itf', symbology: 'itf', data: '12345670', module: 2, height: 60},
        {name: 'codabar', symbology: 'codabar', data: 'A12345A', module: 3, height: 60},
        {name: 'code93', symbology: 'code93', data: 'TEST93', module: 3, height: 60},
        {name: 'code128', symbology: 'code128', data: '{BABC-123', module: 3, height: 60},
      ];

      for (const one of cases) {
        const list = layout('esc-pos', one.name);
        const line = block(list, 'rect');
        const rectangles = line.operations.filter((operation) => operation.type === 'rect');

        const code = encodeBarcode(one.symbology, one.data);
        const expected = bars(code, one.module, one.height);

        const left = Math.min(...rectangles.map((rectangle) => rectangle.x));
        const drawn = draw(rectangles, expected.width, expected.height, left, 0);

        assert.equal(dots(drawn), dots(expected), `the bars of ${one.name}`);
      }
    });

    it('should draw the bars of a DataBar as the symbology encodes them', function() {
      const cases = [
        {name: 'databar-omni', symbology: 'gs1-databar-omni', data: '0952123454321', module: 3, height: 100},
        {name: 'databar-truncated', symbology: 'gs1-databar-truncated', data: '0952123454321', module: 3, height: 39},
        {name: 'databar-limited', symbology: 'gs1-databar-limited', data: '0123456789012', module: 3, height: 30},
        {
          name: 'databar-expanded',
          symbology: 'gs1-databar-expanded',
          data: '(01)90614141000015(3103)000123',
          module: 3,
          height: 102,
        },
      ];

      for (const one of cases) {
        const list = layout('esc-pos/raw', one.name);
        const line = block(list, 'rect');
        const rectangles = line.operations.filter((operation) => operation.type === 'rect');

        const code = encodeBarcode(one.symbology, one.data);
        const height = rectangles[0].height;
        const expected = bars(code, one.module, height);

        assert.equal(height, one.height, `the height of ${one.name}`);

        const left = Math.min(...rectangles.map((rectangle) => rectangle.x));
        const drawn = draw(rectangles, expected.width, expected.height, left, 0);

        assert.equal(dots(drawn), dots(expected), `the bars of ${one.name}`);
      }
    });

    it('should draw the modules of a QR code as the symbology encodes them', function() {
      const list = layout('esc-pos', 'qrcode');
      const data = new TextEncoder().encode('https://example.com/order/9912');

      for (const [index, size] of [[0, 4], [1, 6]]) {
        const line = block(list, 'rect', index);
        const rectangles = line.operations.filter((operation) => operation.type === 'rect');

        const symbol = encodeQrcode(data, index === 0 ? 'L' : 'H');
        const expected = Bitmap.scale(symbol, size, size);

        const left = Math.min(...rectangles.map((rectangle) => rectangle.x));
        const drawn = draw(rectangles, expected.width, expected.height, left, 0);

        assert.equal(dots(drawn), dots(expected), `the modules of the QR code of ${size} dots`);
      }
    });

    it('should draw the modules of a PDF417 symbol as the symbology encodes them', function() {
      const list = layout('esc-pos', 'pdf417');
      const line = block(list, 'rect');
      const rectangles = line.operations.filter((operation) => operation.type === 'rect');

      const symbol = encodePdf417(new TextEncoder().encode('https://example.com/order/9912'), {
        columns: 0,
        rows: 0,
        errorLevel: 2,
        rowHeight: 3,
      });

      const module = 3;
      const height = 3 * module;

      const expected = Bitmap.create(symbol.modules[0].length * module, symbol.rows * height);

      for (let row = 0; row < symbol.rows; row++) {
        for (let column = 0; column < symbol.modules[row].length; column++) {
          if (!symbol.modules[row][column]) {
            continue;
          }

          for (let x = column * module; x < (column + 1) * module; x++) {
            for (let y = row * height; y < (row + 1) * height; y++) {
              Bitmap.setPixel(expected, x, y, 1);
            }
          }
        }
      }

      const left = Math.min(...rectangles.map((rectangle) => rectangle.x));
      const drawn = draw(rectangles, expected.width, expected.height, left, 0);

      assert.equal(dots(drawn), dots(expected));
    });

    it('should carry the dots of an image the parser made', function() {
      for (const [directory, name] of [['esc-pos', 'image-raster'], ['esc-pos', 'image-column']]) {
        const list = layout(directory, name);
        const paper = fixture(directory, name).paper;

        const lines = list.entries.filter(
            (entry) => entry.type === 'line' &&
              entry.operations.some((operation) => operation.type === 'image'),
        );

        assert.isAbove(lines.length, 0);

        for (const line of lines) {
          for (const operation of line.operations.filter((one) => one.type === 'image')) {
            const expected = Bitmap.create(operation.width, operation.height);

            for (let y = 0; y < operation.height; y++) {
              for (let x = 0; x < operation.width; x++) {
                Bitmap.setPixel(
                    expected, x, y,
                    Bitmap.getPixel(paper, operation.x + x, line.y + operation.y + y),
                );
              }
            }

            const drawn = draw([operation], operation.width, operation.height, operation.x, operation.y);

            assert.equal(dots(drawn), dots(expected), `the image of ${directory}/${name}`);
          }
        }
      }
    });

    it('should carry the rows of a Star raster image as one image each', function() {
      const list = layout('star-prnt/raw', 'star-graphics');
      const images = list.entries.filter((entry) => entry.type === 'line');

      assert.isAbove(images.length, 0);

      for (const entry of images) {
        assert.equal(entry.operations.length, 1);
        assert.equal(entry.operations[0].type, 'image');
        assert.equal(entry.operations[0].x, 0);
        assert.equal(entry.operations[0].width, WIDTH);
        assert.equal(entry.operations[0].height, entry.height);
      }
    });
  });

  describe('the golden lists', function() {
    const golden = [
      ['esc-pos', 'receipt'],
      ['esc-pos', 'hri'],
      ['esc-pos', 'image-raster'],
      ['star-prnt/raw', 'page-mode-directions'],
      ['star-prnt/raw', 'star-graphics'],
    ];

    for (const [directory, name] of golden) {
      it(`should equal the golden list of ${directory}/${name}`, function() {
        const file = path.join(root, directory, `${name}.layout.json`);

        assert.isTrue(fs.existsSync(file), `${file} is missing, run node test/tools/make-fixtures.js`);

        assert.deepEqual(
            toJson(layout(directory, name)),
            JSON.parse(fs.readFileSync(file, 'utf8')),
        );
      });
    }
  });

  describe('the renderers', function() {
    it('should lay out on the renderer of one language as well', function() {
      const bytes = fixture('esc-pos', 'text').bytes;

      const list = new EscPosRenderer({width: WIDTH, commands: COMMANDS}).layout(bytes);

      assert.equal(list.language, 'esc-pos');
      assert.equal(list.width, WIDTH);
    });

    it('should report the Star language the renderer was created for', function() {
      const bytes = fixture('star-prnt', 'text').bytes;

      assert.equal(new StarPrntRenderer({width: WIDTH}).layout(bytes).language, 'star-prnt');

      assert.equal(
          new ReceiptPrinterRenderer({language: 'star-line', width: WIDTH}).layout(bytes).language,
          'star-line',
      );

      assert.equal(
          new ReceiptPrinterRenderer({language: 'star-graphics', width: WIDTH}).layout(bytes).language,
          'star-graphics',
      );
    });

    it('should lay out and render the same stream on one renderer', function() {
      const renderer = new ReceiptPrinterRenderer({width: WIDTH, commands: COMMANDS});
      const bytes = fixture('esc-pos', 'receipt').bytes;

      const first = renderer.layout(bytes);
      const items = renderer.render(bytes);
      const second = renderer.layout(bytes);

      assert.deepEqual(toJson(second), toJson(first));
      assert.isAbove(items.length, 0);
    });

    it('should own the bitmaps of the list', function() {
      const renderer = new ReceiptPrinterRenderer({width: WIDTH, commands: COMMANDS});
      const list = renderer.layout(fixture('esc-pos', 'image-raster').bytes);

      const images = list.entries
          .filter((entry) => entry.type === 'line')
          .flatMap((entry) => entry.operations)
          .filter((operation) => operation.type === 'image');

      assert.isAbove(images.length, 0);

      /* Changing the list changes nothing of the next render */

      images[0].data.fill(0xff);

      const again = renderer.layout(fixture('esc-pos', 'image-raster').bytes);
      const first = again.entries
          .filter((entry) => entry.type === 'line')
          .flatMap((entry) => entry.operations)
          .filter((operation) => operation.type === 'image')[0];

      assert.notEqual(Array.from(first.data).join(','), Array.from(images[0].data).join(','));
    });
  });
});
