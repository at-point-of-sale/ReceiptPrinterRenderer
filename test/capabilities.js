import ReceiptPrinterRenderer, {pieces, rasterize, stitch} from '../src/receipt-printer-renderer.js';
import {toSvg} from '../src/svg.js';
import {names, fixture} from './helpers/fixtures.js';
import {assert} from 'chai';

/*
    What the printer can do, the `capabilities` option.

    The option takes the `printerCapabilities` object of ReceiptPrinterEncoder
    as it is. A command for something the printer of that object does not have
    draws nothing and becomes an `unsupported` entry of the display list, with
    the bytes it came from and a word for what was refused, and font B takes the
    cell of the profile. Without the option nothing is refused, which is what
    every fixture of this suite renders with.

    The capabilities below are the profiles of the encoder, copied as they
    stand there: a renderer takes them without translating anything.
*/

const WIDTH = 576;

/* The Bixolon SRP-350: nine symbologies, no QR code, no PDF417, font B in the
   9 by 17 cell of the Epson profile */

const SRP350 = {
  language: 'esc-pos',
  codepages: 'bixolon/legacy',
  fonts: {A: {size: '12x24', columns: 42}, B: {size: '9x17', columns: 56}},
  barcodes: {
    supported: true,
    symbologies: ['upca', 'upce', 'ean13', 'ean8', 'code39', 'itf', 'codabar', 'code93', 'code128'],
  },
  qrcode: {supported: false, models: []},
  pdf417: {supported: false},
  cutter: {feed: 4},
};

/* The Epson TM-T70, which takes its images in raster format */

const TM_T70 = {
  language: 'esc-pos',
  codepages: 'epson/legacy',
  fonts: {A: {size: '12x24', columns: 42}, B: {size: '9x17', columns: 56}},
  barcodes: {
    supported: true,
    symbologies: ['upca', 'upce', 'ean13', 'ean8', 'code39', 'itf', 'codabar', 'code93', 'code128'],
  },
  qrcode: {supported: true, models: ['1', '2']},
  pdf417: {supported: true},
  images: {mode: 'raster'},
  cutter: {feed: 4},
};

/* The Epson TM-m30II, whose font B is the 10 by 24 cell no profile of this
   package has */

const TM_M30II = {
  language: 'esc-pos',
  codepages: 'epson',
  fonts: {A: {size: '12x24', columns: 48}, B: {size: '10x24', columns: 57}, C: {size: '9x17', columns: 64}},
  barcodes: {
    supported: true,
    symbologies: [
      'upca', 'upce', 'ean13', 'ean8', 'code39', 'itf', 'codabar', 'code93', 'code128',
      'gs1-databar-omni', 'gs1-databar-truncated', 'gs1-databar-limited', 'gs1-databar-expanded', 'code128-auto',
    ],
  },
  qrcode: {supported: true, models: ['1', '2']},
  pdf417: {supported: true},
  cutter: {feed: 4},
};

/* The Star SM-L200: eight symbologies, neither Code 39 nor GS1-128, and the
   Code 128 of a Star printer under its own name */

const SM_L200 = {
  language: 'star-prnt',
  codepages: 'star',
  fonts: {A: {size: '12x24', columns: 32}, B: {size: '9x24', columns: 42}, C: {size: '9x17', columns: 42}},
  barcodes: {
    supported: true,
    symbologies: ['upca', 'upce', 'ean13', 'ean8', 'itf', 'codabar', 'code93', 'code128'],
  },
  qrcode: {supported: true, models: ['2']},
  pdf417: {supported: true},
};

/* The Star TSP650, which has neither a QR code nor a PDF417 */

const TSP650 = {
  language: 'star-line',
  codepages: 'star',
  fonts: {A: {size: '12x24', columns: 48}, B: {size: '9x24', columns: 64}},
  barcodes: {
    supported: true,
    symbologies: ['upca', 'upce', 'ean13', 'ean8', 'code39', 'itf', 'codabar', 'code93', 'code128'],
  },
  qrcode: {supported: false, models: []},
  pdf417: {supported: false},
  cutter: {feed: 3},
};

/* A printer that has everything this renderer draws, which must render every
   fixture the way a renderer without the option does */

const EVERYTHING = {
  fonts: {A: {size: '12x24', columns: 48}},
  barcodes: {
    supported: true,
    symbologies: [
      'upca', 'upce', 'ean13', 'ean8', 'code39', 'itf', 'codabar', 'code93', 'code128', 'gs1-128',
      'gs1-databar-omni', 'gs1-databar-truncated', 'gs1-databar-limited', 'gs1-databar-expanded', 'code128-auto',
    ],
  },
  qrcode: {supported: true, models: ['1', '2']},
  pdf417: {supported: true},
};

/**
 * A renderer of a language, with the capabilities of a printer or without them
 *
 * @param  {string}   language       Language of the commands
 * @param  {object}   [capabilities] The capabilities, or nothing for a printer that does everything
 * @param  {object}   [options]      The other options
 * @return {ReceiptPrinterRenderer}  The renderer
 */
function renderer(language, capabilities, options) {
  return new ReceiptPrinterRenderer(Object.assign(
      {language, width: WIDTH, commands: ['cut', 'pulse', 'feed', 'unknown'], capabilities},
      options || {},
  ));
}

/**
 * A stream of commands
 *
 * @param  {Array<number|string>}   parts   Bytes and text, in order
 * @return {Uint8Array}                     The commands
 */
function stream(parts) {
  const bytes = [];

  for (const part of parts) {
    if (typeof part === 'string') {
      bytes.push(...[...part].map((character) => character.charCodeAt(0)));
      continue;
    }

    bytes.push(part);
  }

  return Uint8Array.from(bytes);
}

/**
 * The unsupported entries of a display list
 *
 * @param  {object}     layout   The list
 * @return {object[]}            The entries
 */
function refused(layout) {
  return layout.entries.filter((entry) => entry.type === 'unsupported');
}

/**
 * The operations of every line of a display list
 *
 * @param  {object}     layout   The list
 * @return {object[]}            The operations, in order
 */
function operations(layout) {
  return layout.entries
      .filter((entry) => entry.type === 'line')
      .flatMap((entry) => entry.operations);
}

/**
 * The bytes of a source range of a list
 *
 * @param  {Uint8Array}   bytes    The stream
 * @param  {object}       source   The range
 * @return {number[]}              The bytes
 */
function bytesOf(bytes, source) {
  return Array.from(bytes.subarray(source.offset, source.offset + source.length));
}

const INITIALIZE = [0x1b, 0x40];
const LF = 0x0a;

describe('The capabilities of a printer', function() {
  describe('without the option', function() {
    for (const language of ['esc-pos', 'star-prnt']) {
      it(`should render every ${language} fixture the way a printer that does everything does`, function() {
        for (const name of names(language)) {
          const bytes = fixture(language, name).bytes;

          const plain = renderer(language).render(bytes);
          const everything = renderer(language, EVERYTHING).render(bytes);

          assert.deepEqual(everything, plain, name);
        }
      });

      it(`should put no unsupported entry in the list of a ${language} fixture`, function() {
        for (const name of names(language)) {
          const layout = renderer(language).layout(fixture(language, name).bytes);

          assert.lengthOf(refused(layout), 0, name);
        }
      });
    }
  });

  describe('barcodes', function() {
    it('should draw a symbology the profile lists', function() {
      const bytes = fixture('esc-pos', 'ean13').bytes;

      assert.deepEqual(renderer('esc-pos', SRP350).render(bytes), renderer('esc-pos').render(bytes));
    });

    it('should draw the barcode of the receipt fixture, which is an EAN-13', function() {
      const bytes = fixture('esc-pos', 'receipt').bytes;
      const layout = renderer('esc-pos', TM_T70).layout(bytes);

      assert.lengthOf(refused(layout), 0);
      assert.deepEqual(
          rasterize(layout, {commands: ['cut']}),
          rasterize(renderer('esc-pos').layout(bytes), {commands: ['cut']}),
      );
    });

    it('should refuse a symbology the profile does not list', function() {
      const bytes = fixture('esc-pos', 'gs1-128').bytes;
      const layout = renderer('esc-pos', SRP350).layout(bytes);
      const entries = refused(layout);

      assert.lengthOf(entries, 1);
      assert.equal(entries[0].what, 'gs1-128');
      assert.equal(entries[0].type, 'unsupported');
      assert.isNumber(entries[0].y);

      /* The source is the GS k that drew it, the command and nothing else */

      assert.deepEqual(bytesOf(bytes, entries[0].source).slice(0, 3), [0x1d, 0x6b, 74]);
    });

    it('should draw nothing for a refused barcode', function() {
      const bytes = fixture('esc-pos', 'gs1-128').bytes;
      const layout = renderer('esc-pos', SRP350).layout(bytes);

      assert.lengthOf(operations(layout).filter((operation) => operation.type === 'rect'), 0);
    });

    it('should not print the data of a refused barcode as text', function() {
      const bytes = stream([
        ...INITIALIZE, 'A', LF,
        0x1d, 0x6b, 74, 13, ...'1234567890128',
        'B', LF,
      ]);

      const layout = renderer('esc-pos', SRP350).layout(bytes);
      const text = operations(layout)
          .filter((operation) => operation.type === 'text')
          .map((operation) => String.fromCodePoint(operation.codepoint))
          .join('');

      assert.equal(text, 'AB');
      assert.deepEqual(refused(layout).map((entry) => entry.what), ['gs1-128']);
    });

    it('should leave the stream in sync behind a refused barcode', function() {
      const bytes = stream([
        ...INITIALIZE, 'A', LF,
        0x1d, 0x6b, 74, 13, ...'1234567890128',
        'B', LF,
      ]);

      const without = renderer('esc-pos').layout(stream([...INITIALIZE, 'A', LF, 'B', LF]));
      const layout = renderer('esc-pos', SRP350).layout(bytes);

      const lines = layout.entries.filter((entry) => entry.type === 'line');

      assert.lengthOf(lines, 2);
      assert.deepEqual(lines.map((line) => line.y), without.entries
          .filter((entry) => entry.type === 'line')
          .map((line) => line.y));
    });

    it('should refuse every barcode of a printer that has none', function() {
      const bytes = fixture('esc-pos', 'ean13').bytes;
      const layout = renderer('esc-pos', Object.assign({}, SRP350, {barcodes: {supported: false}})).layout(bytes);

      assert.isAtLeast(refused(layout).length, 1);
      assert.deepEqual([...new Set(refused(layout).map((entry) => entry.what))], ['ean13']);
    });

    it('should refuse a Star symbology the profile does not list', function() {
      const bytes = fixture('star-prnt', 'gs1-128').bytes;
      const layout = renderer('star-prnt', SM_L200).layout(bytes);
      const entries = refused(layout);

      assert.lengthOf(entries, 1);
      assert.equal(entries[0].what, 'gs1-128');
      assert.deepEqual(bytesOf(bytes, entries[0].source).slice(0, 3), [0x1b, 0x62, 9]);
      assert.lengthOf(operations(layout).filter((operation) => operation.type === 'rect'), 0);
    });

    it('should refuse the Star Code 39 of a profile without one', function() {
      const layout = renderer('star-prnt', SM_L200).layout(fixture('star-prnt', 'code39').bytes);

      assert.deepEqual(refused(layout).map((entry) => entry.what), ['code39']);
    });

    it('should draw the Star Code 128, which a profile calls code128', function() {
      const bytes = fixture('star-prnt', 'code128').bytes;
      const layout = renderer('star-prnt', SM_L200).layout(bytes);

      assert.lengthOf(refused(layout), 0);
      assert.deepEqual(renderer('star-prnt', SM_L200).render(bytes), renderer('star-prnt').render(bytes));
    });
  });

  describe('two dimensional codes', function() {
    it('should refuse a QR code on a printer without one', function() {
      const bytes = fixture('esc-pos', 'qrcode').bytes;
      const layout = renderer('esc-pos', SRP350).layout(bytes);
      const entries = refused(layout);

      assert.isAtLeast(entries.length, 1);
      assert.deepEqual([...new Set(entries.map((entry) => entry.what))], ['qrcode']);
      assert.lengthOf(operations(layout).filter((operation) => operation.type === 'rect'), 0);
    });

    it('should refuse the print function of a QR code and not the store', function() {
      const bytes = fixture('esc-pos', 'qrcode').bytes;
      const entries = refused(renderer('esc-pos', SRP350).layout(bytes));

      /* GS ( k pL pH 49 81 48, the function that prints the symbol */

      for (const entry of entries) {
        const command = bytesOf(bytes, entry.source);

        assert.deepEqual(command.slice(0, 3), [0x1d, 0x28, 0x6b]);
        assert.deepEqual(command.slice(5), [49, 0x51, 48]);
      }
    });

    it('should refuse a PDF417 on a printer without one', function() {
      const bytes = fixture('esc-pos', 'pdf417').bytes;
      const layout = renderer('esc-pos', SRP350).layout(bytes);

      assert.isAtLeast(refused(layout).length, 1);
      assert.deepEqual([...new Set(refused(layout).map((entry) => entry.what))], ['pdf417']);
      assert.lengthOf(operations(layout).filter((operation) => operation.type === 'rect'), 0);
    });

    it('should refuse a Star QR code and a Star PDF417 on a printer without them', function() {
      for (const [name, what] of [['qrcode', 'qrcode'], ['pdf417', 'pdf417']]) {
        const bytes = fixture('star-prnt', name).bytes;
        const layout = renderer('star-prnt', TSP650, {language: 'star-line'}).layout(bytes);

        assert.isAtLeast(refused(layout).length, 1, name);
        assert.deepEqual([...new Set(refused(layout).map((entry) => entry.what))], [what], name);
        assert.lengthOf(operations(layout).filter((operation) => operation.type === 'rect'), 0, name);
      }
    });

    it('should draw the codes of a printer that has them', function() {
      for (const name of ['qrcode', 'pdf417']) {
        const bytes = fixture('esc-pos', name).bytes;

        assert.deepEqual(renderer('esc-pos', TM_T70).render(bytes), renderer('esc-pos').render(bytes), name);
      }
    });
  });

  describe('images', function() {
    /* An image of eight by eight dots, in the raster format of one byte per row
       and in the column format of one byte per column */

    const DOTS = [0xff, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0xff];

    /* GS ( L: the image stored in the graphics print buffer by function 112,
       in raster format, and printed by function 50 */

    const GRAPHICS = stream([
      ...INITIALIZE,
      0x1d, 0x28, 0x4c, 18, 0, 48, 112, 48, 1, 1, 49, 8, 0, 8, 0, ...DOTS,
      0x1d, 0x28, 0x4c, 2, 0, 48, 50,
    ]);

    /* The same buffer filled by function 113, in column format */

    const GRAPHICS_COLUMN = stream([
      ...INITIALIZE,
      0x1d, 0x28, 0x4c, 18, 0, 48, 113, 48, 1, 1, 49, 8, 0, 8, 0, ...DOTS,
      0x1d, 0x28, 0x4c, 2, 0, 48, 50,
    ]);

    /* GS ( L: the image defined under a key code by function 67, in raster
       format, and printed by function 69 */

    const DEFINED = stream([
      ...INITIALIZE,
      0x1d, 0x28, 0x4c, 19, 0, 48, 67, 48, 65, 66, 1, 8, 0, 8, 0, 49, ...DOTS,
      0x1d, 0x28, 0x4c, 6, 0, 48, 69, 65, 66, 1, 1,
    ]);

    /* The same definition by function 68, in column format */

    const DEFINED_COLUMN = stream([
      ...INITIALIZE,
      0x1d, 0x28, 0x4c, 19, 0, 48, 68, 48, 65, 66, 1, 8, 0, 8, 0, 49, ...DOTS,
      0x1d, 0x28, 0x4c, 6, 0, 48, 69, 65, 66, 1, 1,
    ]);

    /* GS * and GS /, the downloaded bit image, and FS q and FS p, the NV bit
       images, both of which carry their dots in column format */

    const DOWNLOAD = stream([...INITIALIZE, 0x1d, 0x2a, 1, 1, ...DOTS, 0x1d, 0x2f, 0]);
    const NV = stream([...INITIALIZE, 0x1c, 0x71, 1, 1, 0, 1, 0, ...DOTS, 0x1c, 0x70, 1, 0]);

    it('should refuse a column mode image on a printer that takes raster images', function() {
      const bytes = fixture('esc-pos', 'image-column').bytes;
      const layout = renderer('esc-pos', TM_T70).layout(bytes);

      assert.isAtLeast(refused(layout).length, 1);
      assert.deepEqual([...new Set(refused(layout).map((entry) => entry.what))], ['column image']);
      assert.lengthOf(operations(layout).filter((operation) => operation.type === 'image'), 0);

      /* The source is the ESC * that carried the dots */

      assert.deepEqual(bytesOf(bytes, refused(layout)[0].source).slice(0, 2), [0x1b, 0x2a]);
    });

    it('should draw a raster image on a printer that takes raster images', function() {
      const bytes = fixture('esc-pos', 'image-raster').bytes;

      assert.deepEqual(renderer('esc-pos', TM_T70).render(bytes), renderer('esc-pos').render(bytes));
    });

    it('should refuse a raster image on a printer that takes column mode images', function() {
      const bytes = fixture('esc-pos', 'image-raster').bytes;
      const column = Object.assign({}, TM_T70, {images: {mode: 'column'}});
      const layout = renderer('esc-pos', column).layout(bytes);

      assert.deepEqual(refused(layout).map((entry) => entry.what), ['raster image']);
      assert.lengthOf(operations(layout).filter((operation) => operation.type === 'image'), 0);
      assert.deepEqual(bytesOf(bytes, refused(layout)[0].source).slice(0, 4), [0x1d, 0x76, 0x30, 0]);
    });

    it('should draw a column mode image on a printer that takes column mode images', function() {
      const bytes = fixture('esc-pos', 'image-column').bytes;
      const column = Object.assign({}, TM_T70, {images: {mode: 'column'}});

      assert.deepEqual(renderer('esc-pos', column).render(bytes), renderer('esc-pos').render(bytes));
    });

    it('should draw both modes for a profile without an images section', function() {
      for (const name of ['image-column', 'image-raster']) {
        const bytes = fixture('esc-pos', name).bytes;

        assert.deepEqual(renderer('esc-pos', SRP350).render(bytes), renderer('esc-pos').render(bytes), name);
      }
    });

    it('should refuse the function that fills the graphics buffer, not the one that prints it', function() {
      const layout = renderer('esc-pos', Object.assign({}, TM_T70, {images: {mode: 'column'}})).layout(GRAPHICS);
      const entries = refused(layout);

      /* The store carries the dots, so it is the command that is refused, and
         the print function behind it prints an empty buffer and says nothing */

      assert.deepEqual(entries.map((entry) => entry.what), ['raster image']);
      assert.deepEqual(bytesOf(GRAPHICS, entries[0].source).slice(0, 7), [0x1d, 0x28, 0x4c, 18, 0, 48, 112]);
      assert.lengthOf(operations(layout).filter((operation) => operation.type === 'image'), 0);
      assert.lengthOf(layout.entries.filter((entry) => entry.type === 'unknown'), 0);
    });

    it('should refuse the column format of the graphics buffer on a raster printer', function() {
      const layout = renderer('esc-pos', TM_T70).layout(GRAPHICS_COLUMN);
      const entries = refused(layout);

      assert.deepEqual(entries.map((entry) => entry.what), ['column image']);
      assert.deepEqual(bytesOf(GRAPHICS_COLUMN, entries[0].source).slice(0, 7), [0x1d, 0x28, 0x4c, 18, 0, 48, 113]);
      assert.lengthOf(operations(layout).filter((operation) => operation.type === 'image'), 0);
    });

    it('should draw the graphics buffer of a printer that takes the format it was filled in', function() {
      assert.deepEqual(renderer('esc-pos', TM_T70).render(GRAPHICS), renderer('esc-pos').render(GRAPHICS));

      const column = Object.assign({}, TM_T70, {images: {mode: 'column'}});

      assert.deepEqual(renderer('esc-pos', column).render(GRAPHICS_COLUMN), renderer('esc-pos').render(GRAPHICS_COLUMN));
    });

    it('should refuse a definition in a format the printer does not take', function() {
      const column = Object.assign({}, TM_T70, {images: {mode: 'column'}});
      const layout = renderer('esc-pos', column).layout(DEFINED);
      const entries = refused(layout);

      assert.deepEqual(entries.map((entry) => entry.what), ['raster image']);
      assert.deepEqual(bytesOf(DEFINED, entries[0].source).slice(0, 7), [0x1d, 0x28, 0x4c, 19, 0, 48, 67]);
      assert.lengthOf(operations(layout).filter((operation) => operation.type === 'image'), 0);

      /* Nothing was stored under the key code, so the function that prints it
         finds nothing there and reports it the way it reports any key code the
         printer was never given */

      assert.lengthOf(layout.entries.filter((entry) => entry.type === 'unknown'), 1);
    });

    it('should draw a definition in a format the printer does take, whatever the print function is', function() {
      const column = Object.assign({}, TM_T70, {images: {mode: 'column'}});
      const layout = renderer('esc-pos', column).layout(DEFINED_COLUMN);

      assert.lengthOf(refused(layout), 0);
      assert.deepEqual(
          renderer('esc-pos', column).render(DEFINED_COLUMN),
          renderer('esc-pos').render(DEFINED_COLUMN),
      );
    });

    it('should refuse the column format definitions of GS * and FS q', function() {
      for (const [name, bytes, command] of [
        ['GS *', DOWNLOAD, [0x1d, 0x2a]],
        ['FS q', NV, [0x1c, 0x71]],
      ]) {
        const layout = renderer('esc-pos', TM_T70).layout(bytes);
        const entries = refused(layout);

        assert.deepEqual(entries.map((entry) => entry.what), ['column image'], name);
        assert.deepEqual(bytesOf(bytes, entries[0].source).slice(0, 2), command, name);
        assert.lengthOf(operations(layout).filter((operation) => operation.type === 'image'), 0, name);
      }
    });

    it('should draw the images a printer holds whatever the mode says', function() {
      const column = Object.assign({}, TM_T70, {images: {mode: 'column'}});

      for (const [name, bytes] of [['GS /', DOWNLOAD], ['FS p', NV]]) {
        assert.deepEqual(renderer('esc-pos', column).render(bytes), renderer('esc-pos').render(bytes), name);
        assert.lengthOf(refused(renderer('esc-pos', column).layout(bytes)), 0, name);
      }
    });

    it('should refuse the Star column mode images on a printer that takes raster images', function() {
      const bytes = fixture('star-prnt', 'image-column').bytes;
      const layout = renderer('star-prnt', Object.assign({}, SM_L200, {images: {mode: 'raster'}})).layout(bytes);

      assert.isAtLeast(refused(layout).length, 1);
      assert.deepEqual([...new Set(refused(layout).map((entry) => entry.what))], ['column image']);
      assert.lengthOf(operations(layout).filter((operation) => operation.type === 'image'), 0);
      assert.deepEqual(bytesOf(bytes, refused(layout)[0].source).slice(0, 2), [0x1b, 0x58]);
    });

    it('should refuse the Star raster image and the Star raster mode on a printer that takes column images', function() {
      const column = Object.assign({}, SM_L200, {images: {mode: 'column'}});

      for (const name of ['star-raster-image', 'star-raster']) {
        const bytes = fixture('star-prnt/raw', name).bytes;
        const layout = renderer('star-prnt', column).layout(bytes);

        assert.isAtLeast(refused(layout).length, 1, name);
        assert.deepEqual([...new Set(refused(layout).map((entry) => entry.what))], ['raster image'], name);
        assert.lengthOf(operations(layout).filter((operation) => operation.type === 'image'), 0, name);
      }
    });

    it('should report the rows of a refused raster mode buffer at the tokens that filled it', function() {
      const bytes = fixture('star-prnt/raw', 'star-raster').bytes;
      const column = Object.assign({}, SM_L200, {images: {mode: 'column'}});
      const entry = refused(renderer('star-prnt', column).layout(bytes))[0];

      /* The range runs from the first row of the buffer to the last, and not
         over the execute command that printed it */

      assert.isAbove(entry.source.length, 1);
      assert.isAtMost(entry.source.offset + entry.source.length, bytes.length);
    });

    it('should draw the Star images of a printer that takes them', function() {
      for (const [directory, name] of [
        ['star-prnt', 'image-column'],
        ['star-prnt/raw', 'star-raster-image'],
        ['star-prnt/raw', 'star-raster'],
      ]) {
        const bytes = fixture(directory, name).bytes;

        assert.deepEqual(renderer('star-prnt', SM_L200).render(bytes), renderer('star-prnt').render(bytes), name);
      }
    });
  });

  describe('font B', function() {
    /**
     * The cells of font B of a stream
     *
     * @param  {object}     layout   The list
     * @return {string[]}            The sizes, each once
     */
    function cells(layout) {
      return [...new Set(operations(layout)
          .filter((operation) => operation.type === 'text' && operation.font === 'B')
          .map((operation) => `${operation.cell.width}x${operation.cell.height}`))];
    }

    it('should keep the cell of the profile without the option', function() {
      assert.deepEqual(cells(renderer('esc-pos').layout(fixture('esc-pos', 'fonts').bytes)), ['9x17']);
      assert.deepEqual(cells(renderer('star-prnt').layout(fixture('star-prnt', 'fonts').bytes)), ['9x24']);
    });

    it('should take the cell of the profile on an ESC/POS stream', function() {
      const bytes = fixture('esc-pos', 'fonts').bytes;
      const tall = Object.assign({}, SRP350, {fonts: {A: {size: '12x24'}, B: {size: '9x24'}}});

      assert.deepEqual(cells(renderer('esc-pos', tall).layout(bytes)), ['9x24']);
      assert.notDeepEqual(renderer('esc-pos', tall).render(bytes), renderer('esc-pos').render(bytes));
    });

    it('should draw the ten dot cell of a TM-m30II with the font of the other two', function() {
      const bytes = fixture('esc-pos', 'fonts').bytes;
      const layout = renderer('esc-pos', TM_M30II).layout(bytes);

      assert.deepEqual(cells(layout), ['10x24']);

      /* The glyph box is the 8 by 16 dot face of the built in font, whatever
         the cell is */

      const cell = operations(layout).find((operation) => operation.font === 'B');

      assert.deepEqual(cell.glyph, {width: 8, height: 16});
      assert.equal(cell.baseline, 18);
    });

    it('should take the cell of the profile on a Star stream', function() {
      const bytes = fixture('star-prnt', 'fonts').bytes;
      const short = Object.assign({}, SM_L200, {fonts: {A: {size: '12x24'}, B: {size: '9x17'}}});

      assert.deepEqual(cells(renderer('star-prnt', short).layout(bytes)), ['9x17']);
      assert.notDeepEqual(renderer('star-prnt', short).render(bytes), renderer('star-prnt').render(bytes));
    });

    it('should keep the cell of the profile for a printer without a font B', function() {
      const bytes = fixture('esc-pos', 'fonts').bytes;
      const none = Object.assign({}, SRP350, {fonts: {A: {size: '12x24'}}});

      assert.deepEqual(cells(renderer('esc-pos', none).layout(bytes)), ['9x17']);
    });

    it('should leave the columns of font A alone', function() {
      assert.equal(renderer('esc-pos', SRP350).columns, 48);
    });
  });

  describe('the unsupported entry', function() {
    const bytes = fixture('esc-pos', 'gs1-128').bytes;

    it('should carry a type, a row, a word and a source', function() {
      const entry = refused(renderer('esc-pos', SRP350).layout(bytes))[0];

      assert.deepEqual(Object.keys(entry).sort(), ['source', 'type', 'what', 'y']);
      assert.equal(entry.type, 'unsupported');
      assert.isNumber(entry.y);
      assert.isString(entry.what);
      assert.isNumber(entry.source.offset);
      assert.isNumber(entry.source.length);
    });

    it('should not reach the item stream of a render', function() {
      const items = renderer('esc-pos', SRP350).render(bytes);

      assert.lengthOf(items.filter((item) => item.type === 'unsupported'), 0);
    });

    it('should be ignored by rasterize, stitch, pieces and the SVG writer', function() {
      const layout = renderer('esc-pos', SRP350).layout(fixture('esc-pos', 'receipt').bytes);

      assert.isAtLeast(refused(layout).length, 1);

      const items = rasterize(layout, {commands: ['cut']});

      assert.lengthOf(items.filter((item) => item.type === 'unsupported'), 0);
      assert.isObject(stitch(items, {width: WIDTH}));

      for (const piece of pieces(layout)) {
        assert.isString(toSvg(piece));
      }

      assert.isString(toSvg(layout));
    });
  });

  describe('the option itself', function() {
    it('should refuse something that is not an object', function() {
      assert.throws(() => renderer('esc-pos', 'bixolon-srp350'), /capabilities/i);
      assert.throws(() => renderer('esc-pos', 42), /capabilities/i);
      assert.throws(() => renderer('esc-pos', [SRP350]), /capabilities/i);
    });

    it('should refuse a font size it cannot read', function() {
      for (const size of ['small', '9', '9x', 'x17', '0x0', '9x0']) {
        assert.throws(() => renderer('esc-pos', {fonts: {B: {size}}}), /font size/i, size);
      }
    });

    it('should accept a profile that says nothing at all', function() {
      const bytes = fixture('esc-pos', 'receipt').bytes;

      assert.deepEqual(renderer('esc-pos', {}).render(bytes), renderer('esc-pos').render(bytes));
    });

    it('should draw both image modes for a mode it does not know', function() {
      const bytes = fixture('esc-pos', 'image-column').bytes;

      assert.deepEqual(
          renderer('esc-pos', {images: {mode: 'something-else'}}).render(bytes),
          renderer('esc-pos').render(bytes),
      );
    });
  });
});
