import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

/*
    The UMD build, checked the way a script tag loads it.

    Run with `npm run test:umd`, which needs a build, so it is a script of its
    own and not part of the mocha suite, the same as `npm run test:types`. The
    bundle is evaluated in a context without a module system, which is what a
    browser gives it, and the global it leaves behind must be the class itself,
    with the renderers and the image format helpers attached to it.
*/

const bundle = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'receipt-printer-renderer.umd.js',
);

if (!fs.existsSync(bundle)) {
  console.error('No UMD build found, run npm run build first');
  process.exit(1);
}

/* A script tag has no exports, no module and no define, so the bundle falls
   through to the global. Only the globals a browser has are in the context */

const context = vm.createContext({console, TextDecoder, TextEncoder, atob, btoa, URL});

vm.runInContext(fs.readFileSync(bundle, 'utf8'), context, {filename: 'receipt-printer-renderer.umd.js'});

const ReceiptPrinterRenderer = context.ReceiptPrinterRenderer;

assert.equal(typeof ReceiptPrinterRenderer, 'function', 'the global is the class, not an object of exports');

/* The bundle runs in its own context, so its arrays have another Array
   prototype than this module's and are compared as text */

assert.equal(ReceiptPrinterRenderer.languages.join(' '), 'esc-pos star-prnt star-line star-graphics');

assert.equal(typeof ReceiptPrinterRenderer.EscPosRenderer, 'function');
assert.equal(typeof ReceiptPrinterRenderer.StarPrntRenderer, 'function');
assert.equal(ReceiptPrinterRenderer.EscPosRenderer.language, 'esc-pos');
assert.equal(ReceiptPrinterRenderer.StarPrntRenderer.language, 'star-prnt');

for (const helper of ['toPbm', 'toPng', 'toImageData', 'stitch']) {
  assert.equal(typeof ReceiptPrinterRenderer[helper], 'function', `${helper} is attached to the class`);
}

/* And it renders, in every language, from a script tag */

for (const language of ReceiptPrinterRenderer.languages) {
  const renderer = new ReceiptPrinterRenderer({
    language,
    width: 576,
    codepageMapping: language === 'esc-pos' ? 'epson' : 'star',
    commands: ['cut'],
  });

  assert.equal(renderer.language, language);
  assert.equal(renderer.columns, 48);

  const items = renderer.render(new Uint8Array([0x1b, 0x40, 0x41, 0x0a]));

  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'image');
  assert.equal(items[0].width, 576);

  const paper = ReceiptPrinterRenderer.stitch(items, {width: 576});

  assert.equal(ReceiptPrinterRenderer.toPbm(paper).length, paper.data.length + `P4\n576 ${paper.height}\n`.length);
}

assert.throws(() => new ReceiptPrinterRenderer({language: 'meow', width: 576}), /Unknown language meow/);

console.log('UMD global is ReceiptPrinterRenderer, renders esc-pos, star-prnt, star-line and star-graphics');
