import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ReceiptPrinterRenderer, {rasterize} from '../src/receipt-printer-renderer.js';
import {names} from './helpers/fixtures.js';
import {libraries, fixtures, external} from './helpers/external.js';
import {assert} from 'chai';

/*
    The proof of the split, see documentation/svg-plan.md, section 2.

    The layout engine emits the same boxes whichever sink is attached, so the
    bitmap back-end draws the same dots from a display list as it does from a
    render: `rasterize(renderer.layout(bytes), options)` equals
    `renderer.render(bytes)` for every fixture of every directory, item for item
    and byte for byte, under every option combination below.
*/

/* The printer the fixtures were made for, see test/tools/make-fixtures.js */

const WIDTH = 576;

/* The option combinations the proof runs: the defaults, every command with a
   low feed threshold, so that the blank runs of a receipt become feed items and
   split the images around them, and a maximum height that splits every image */

const COMBINATIONS = [
  {name: 'the default options', options: {}},
  {
    name: 'every command with a feed threshold of eight',
    options: {commands: ['cut', 'pulse', 'feed', 'unknown'], feedThreshold: 8},
  },
  {name: 'a maximum height of a hundred rows', options: {maxHeight: 100}},
];

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * Every fixture of the two languages and the external suite, with the renderer
 * options its directory asks for, the commands left out
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
          options: {language, width: WIDTH, codepageMapping: mapping},
        });
      }
    }
  }

  for (const library of libraries()) {
    for (const name of fixtures(library)) {
      const provenance = external(library, name).provenance;

      list.push({
        directory: `external/${library}`,
        name,
        options: {
          language: provenance.language,
          width: provenance.width,
          codepageMapping: provenance.codepageMapping,
        },
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
 * The items of a render as plain data, so that a failure reads as a list of
 * items instead of as a wall of bytes
 *
 * @param  {object[]}   items   The items
 * @return {object[]}           The same items with the image data as a length
 */
function shape(items) {
  return items.map((item) => item.type === 'image' ?
    {type: item.type, width: item.width, height: item.height} :
    item);
}

describe('rasterize', function() {
  describe('every fixture', function() {
    for (const entry of every()) {
      describe(`${entry.directory}/${entry.name}`, function() {
        for (const combination of COMBINATIONS) {
          it(`should draw the same items as a render with ${combination.name}`, function() {
            const settings = Object.assign({}, entry.options, combination.options);
            const stream = bytes(entry);

            const renderer = new ReceiptPrinterRenderer(settings);
            const items = renderer.render(stream);

            const drawn = rasterize(new ReceiptPrinterRenderer(settings).layout(stream), combination.options);

            /* The shapes first, so that a difference in the items is reported
               as a list and not as a hundred kilobytes of dots */

            assert.deepEqual(shape(drawn), shape(items));
            assert.deepEqual(drawn, items);
          });
        }
      });
    }
  });

  describe('the contract', function() {
    const list = () => new ReceiptPrinterRenderer({width: WIDTH}).layout(
        new Uint8Array([0x1b, 0x40, 0x41, 0x0a]),
    );

    it('should be a static of the renderer as well as a named export', function() {
      assert.equal(ReceiptPrinterRenderer.rasterize, rasterize);
    });

    it('should draw a list without any options', function() {
      const items = rasterize(list());

      assert.equal(items.length, 1);
      assert.equal(items[0].type, 'image');
      assert.equal(items[0].width, WIDTH);
      assert.equal(items[0].height, 30);
    });

    it('should not accept a list of another version', function() {
      const other = Object.assign(list(), {version: 2});

      assert.throws(() => rasterize(other), /version 2 is not supported/);
    });

    it('should not accept something that is not a list', function() {
      assert.throws(() => rasterize(null), /display list is required/);
      assert.throws(() => rasterize([]), /is not supported/);
    });

    it('should draw a list a JSON round trip has been through', function() {
      const original = new ReceiptPrinterRenderer({width: WIDTH, commands: ['cut']}).layout(
          new Uint8Array([0x1b, 0x40, 0x41, 0x0a, 0x1d, 0x56, 0x00]),
      );

      const copy = JSON.parse(JSON.stringify(original, (key, value) => value instanceof Uint8Array ?
        Array.from(value) :
        value));

      for (const entry of copy.entries) {
        if (entry.type === 'unknown') {
          entry.data = Uint8Array.from(entry.data);
        }
      }

      assert.deepEqual(shape(rasterize(copy, {commands: ['cut']})), shape(rasterize(original, {commands: ['cut']})));
    });
  });
});
