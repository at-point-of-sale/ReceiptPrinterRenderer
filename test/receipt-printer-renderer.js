import ReceiptPrinterRenderer, {
  ReceiptPrinterRenderer as NamedReceiptPrinterRenderer,
  EscPosRenderer as NamedEscPosRenderer,
  StarPrntRenderer as NamedStarPrntRenderer,
  toPbm as namedToPbm,
  toPng as namedToPng,
  toImageData as namedToImageData,
  stitch as namedStitch,
} from '../src/receipt-printer-renderer.js';

import EscPosRenderer from '../src/renderers/esc-pos.js';
import StarPrntRenderer from '../src/renderers/star-prnt.js';
import {commands} from './helpers/items.js';
import {names, fixture} from './helpers/fixtures.js';
import {assert} from 'chai';

/* The printer the fixtures were made for, see test/tools/make-fixtures.js */

const WIDTH = 576;
const COMMANDS = ['cut', 'pulse', 'feed'];

/**
 * The items of a render in a form chai can compare: the commands as they are,
 * and every image as its size and its bytes
 *
 * @param  {object[]}   items   The items of a render
 * @return {object}             The commands and the images
 */
function summary(items) {
  return {
    commands: commands(items),
    images: items
        .filter((item) => item.type === 'image')
        .map((item) => ({width: item.width, height: item.height, data: Array.from(item.data)})),
  };
}

describe('ReceiptPrinterRenderer', function() {
  describe('exports', function() {
    it('is the default export and a named export, the same class', function() {
      assert.equal(NamedReceiptPrinterRenderer, ReceiptPrinterRenderer);
    });

    it('exports the two renderers and the four helpers by name', function() {
      assert.equal(NamedEscPosRenderer, EscPosRenderer);
      assert.equal(NamedStarPrntRenderer, StarPrntRenderer);

      assert.isFunction(namedToPbm);
      assert.isFunction(namedToPng);
      assert.isFunction(namedToImageData);
      assert.isFunction(namedStitch);
    });

    it('carries the renderers and the helpers as static properties, for the UMD global', function() {
      assert.equal(ReceiptPrinterRenderer.EscPosRenderer, EscPosRenderer);
      assert.equal(ReceiptPrinterRenderer.StarPrntRenderer, StarPrntRenderer);

      assert.equal(ReceiptPrinterRenderer.toPbm, namedToPbm);
      assert.equal(ReceiptPrinterRenderer.toPng, namedToPng);
      assert.equal(ReceiptPrinterRenderer.toImageData, namedToImageData);
      assert.equal(ReceiptPrinterRenderer.stitch, namedStitch);
    });

    it('leaves the static language of the two renderers alone', function() {
      assert.equal(EscPosRenderer.language, 'esc-pos');
      assert.equal(StarPrntRenderer.language, 'star-prnt');
    });
  });

  describe('languages', function() {
    it('lists the three languages of the encoder and the raster protocol of a TSP100', function() {
      assert.deepEqual(
          ReceiptPrinterRenderer.languages,
          ['esc-pos', 'star-prnt', 'star-line', 'star-graphics'],
      );
    });

    it('hands out a new array every time, so a caller cannot change the list', function() {
      const list = ReceiptPrinterRenderer.languages;

      list.push('meow');

      assert.deepEqual(
          ReceiptPrinterRenderer.languages,
          ['esc-pos', 'star-prnt', 'star-line', 'star-graphics'],
      );
    });

    it('has no static language, unlike the renderers of one language', function() {
      assert.isUndefined(ReceiptPrinterRenderer.language);
    });
  });

  describe('language option', function() {
    it('defaults to esc-pos', function() {
      const renderer = new ReceiptPrinterRenderer({width: WIDTH});

      assert.equal(renderer.language, 'esc-pos');
    });

    it('reports the language it was given', function() {
      assert.equal(new ReceiptPrinterRenderer({language: 'esc-pos', width: WIDTH}).language, 'esc-pos');
      assert.equal(new ReceiptPrinterRenderer({language: 'star-prnt', width: WIDTH}).language, 'star-prnt');
      assert.equal(new ReceiptPrinterRenderer({language: 'star-line', width: WIDTH}).language, 'star-line');

      assert.equal(
          new ReceiptPrinterRenderer({language: 'star-graphics', width: WIDTH}).language,
          'star-graphics',
      );
    });

    it('throws on a language it does not know, and names the ones it does', function() {
      assert.throws(
          () => new ReceiptPrinterRenderer({language: 'meow', width: WIDTH}),
          /Unknown language meow, must be one of esc-pos, star-prnt, star-line, star-graphics/,
      );
    });

    it('throws on a language of another kind altogether', function() {
      assert.throws(() => new ReceiptPrinterRenderer({language: 42, width: WIDTH}), /Unknown language 42/);
    });
  });

  describe('options', function() {
    it('passes the options on to the renderer of the language', function() {
      const renderer = new ReceiptPrinterRenderer({language: 'esc-pos', width: 384});

      assert.equal(renderer.columns, 32);
      assert.equal(new ReceiptPrinterRenderer({width: WIDTH}).columns, 48);
    });

    it('lets the width check of the renderer through', function() {
      assert.throws(() => new ReceiptPrinterRenderer({width: 100}), /multiple of 8/);
      assert.throws(() => new ReceiptPrinterRenderer({}), /Width is required/);
    });

    it('lets the codepage mapping check of the renderer through, per language', function() {
      /* The two languages have their own set of mappings: 'epson' is one of
         the ESC/POS mappings and is not a StarPRNT one */

      assert.doesNotThrow(
          () => new ReceiptPrinterRenderer({language: 'esc-pos', width: WIDTH, codepageMapping: 'epson'}),
      );

      assert.throws(
          () => new ReceiptPrinterRenderer({language: 'star-line', width: WIDTH, codepageMapping: 'epson'}),
          /Unknown codepage mapping epson/,
      );

      assert.throws(
          () => new ReceiptPrinterRenderer({width: WIDTH, codepageMapping: 'nonesuch'}),
          /Unknown codepage mapping nonesuch/,
      );
    });

    it('takes the defaults of the renderer of the language', function() {
      const escpos = new ReceiptPrinterRenderer({width: WIDTH});
      const star = new ReceiptPrinterRenderer({language: 'star-prnt', width: WIDTH});

      /* The two profiles differ in line spacing, 30 dots against 32, which is
         the height of the image of one line of text */

      assert.equal(escpos.render([0x41, 0x0a])[0].height, 30);
      assert.equal(star.render([0x41, 0x0a])[0].height, 32);
    });
  });

  describe('delegation', function() {
    for (const language of ['esc-pos', 'star-prnt']) {
      it(`renders ${language} exactly as its own renderer does`, function() {
        const Renderer = language === 'esc-pos' ? EscPosRenderer : StarPrntRenderer;

        const unified = new ReceiptPrinterRenderer({language, width: WIDTH, commands: COMMANDS});
        const direct = new Renderer({width: WIDTH, commands: COMMANDS});

        for (const name of names(language)) {
          const {bytes} = fixture(language, name);

          assert.deepEqual(summary(unified.render(bytes)), summary(direct.render(bytes)), name);
        }
      });
    }

    it('renders star-line with the StarPRNT renderer', function() {
      const unified = new ReceiptPrinterRenderer({language: 'star-line', width: WIDTH, commands: COMMANDS});
      const direct = new StarPrntRenderer({width: WIDTH, commands: COMMANDS});

      for (const name of names('star-prnt')) {
        const {bytes} = fixture('star-prnt', name);

        assert.deepEqual(summary(unified.render(bytes)), summary(direct.render(bytes)), name);
      }
    });

    it('renders star-graphics with the StarPRNT renderer', function() {
      /* The raster job of a TSP100 is the StarPRNT command set with the raster
         mode of ESC * r A in it, which the renderer has read since section 12,
         so the language is a name and nothing else */

      const unified = new ReceiptPrinterRenderer({language: 'star-graphics', width: WIDTH, commands: COMMANDS});
      const direct = new StarPrntRenderer({width: WIDTH, commands: COMMANDS});

      const {bytes} = fixture('star-prnt/raw', 'star-graphics');

      assert.deepEqual(summary(unified.render(bytes)), summary(direct.render(bytes)));
    });

    it('renders the star-graphics fixture to the paper of the receipt it was made from', function() {
      /* The fixture is the receipt fixture encoded by StarGraphicsPrinterEncoder,
         so the two render the same paper, see test/star-raster.js */

      const graphics = new ReceiptPrinterRenderer({language: 'star-graphics', width: WIDTH, commands: COMMANDS});
      const star = new ReceiptPrinterRenderer({language: 'star-prnt', width: WIDTH, commands: COMMANDS});

      const job = graphics.render(fixture('star-prnt/raw', 'star-graphics').bytes);
      const receipt = star.render(fixture('star-prnt', 'receipt').bytes);

      assert.deepEqual(
          summary(job).images.map((image) => image.data.length),
          summary(receipt).images.map((image) => image.data.length),
      );

      assert.deepEqual(commands(job), commands(receipt));
    });

    it('matches the fixtures of the language, commands and all', function() {
      for (const language of ['esc-pos', 'star-prnt']) {
        const renderer = new ReceiptPrinterRenderer({language, width: WIDTH, commands: COMMANDS});

        for (const name of names(language)) {
          const {bytes, commands: expected} = fixture(language, name);

          assert.deepEqual(commands(renderer.render(bytes)), expected, `${language} ${name}`);
        }
      }
    });

    it('can render one receipt after another, like the renderers themselves', function() {
      const renderer = new ReceiptPrinterRenderer({width: WIDTH, commands: COMMANDS});

      const first = summary(renderer.render([0x1b, 0x40, 0x41, 0x0a]));
      const second = summary(renderer.render([0x1b, 0x40, 0x41, 0x0a]));

      assert.deepEqual(second, first);
    });

    it('accepts a Uint8Array and an array of numbers', function() {
      const renderer = new ReceiptPrinterRenderer({width: WIDTH});

      const fromArray = summary(renderer.render([0x41, 0x0a]));
      const fromBytes = summary(renderer.render(Uint8Array.from([0x41, 0x0a])));

      assert.deepEqual(fromBytes, fromArray);
      assert.equal(fromBytes.images.length, 1);
    });
  });
});
