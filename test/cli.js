import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable, Writable} from 'node:stream';
import {fileURLToPath} from 'node:url';

import {decode} from '@point-of-sale/receipt-printer-decoder';
import {detect} from '@point-of-sale/receipt-printer-decoder/tokenizer';

import ReceiptPrinterRenderer, {pieces, stitch, toPbm, toPng} from '../src/receipt-printer-renderer.js';
import {toSvg} from '../src/svg.js';
import {run} from '../src/cli.js';
import {assert} from 'chai';

/*
    The command line, src/cli.js.

    The command is a function over streams, so the whole of it is driven here in
    process: a readable of bytes for standard input, a writable that collects
    for standard output and standard error, and a temporary directory for the
    files it writes. Nothing is spawned; test/bin/check.js does that once, for
    the shim and the build.

    What is checked is that the command is the helpers of the package and
    nothing of its own: every file it writes is compared byte for byte with what
    toPng(), toPbm(), toSvg() or JSON.stringify() gives for the same stream and
    the same options, so an option that does not reach the renderer or the
    writer shows up as a different file. The rest is the interface: the formats,
    the names of the pieces, the exit codes and the messages.
*/

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/* The paper of the fixtures and the version the command reports */

const WIDTH = 576;
const VERSION = '9.9.9-test';

/**
 * The bytes of a fixture
 *
 * @param  {string}       language   Name of the directory, 'esc-pos'
 * @param  {string}       name       Name of the fixture
 * @return {Uint8Array}              The commands
 */
function bytes(language, name) {
  return new Uint8Array(fs.readFileSync(path.join(directory, language, `${name}.bin`)));
}

/**
 * The path of a fixture, which is what the command is given
 *
 * @param  {string}   language   Name of the directory, 'esc-pos'
 * @param  {string}   name       Name of the fixture
 * @return {string}              The path of the file of commands
 */
function file(language, name) {
  return path.join(directory, language, `${name}.bin`);
}

/**
 * What a token of decode() is called on a line of `-f commands`: the mnemonic
 * of a command, the kind of the token for everything else
 *
 * @param  {object}   token   One token of decode()
 * @return {string}           The name
 */
function label(token) {
  return token.type === 'command' ? token.mnemonic : token.type;
}

/**
 * What a token of decode() says on a line of `-f commands`
 *
 * @param  {object}   token   One token of decode()
 * @return {string}           The meaning
 */
function said(token) {
  if (token.type === 'command') {
    return token.summary;
  }

  if (token.type === 'text') {
    return token.multibyte ? 'data' : JSON.stringify(token.text);
  }

  return token.name || '';
}

/**
 * A writable that keeps what was written, as bytes and as text
 *
 * @return {object}   The stream, with a chunks array on it
 */
function collector() {
  const chunks = [];

  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });

  stream.bytes = () => new Uint8Array(Buffer.concat(chunks));
  stream.text = () => Buffer.concat(chunks).toString('utf8');

  return stream;
}

/**
 * Run the command over buffers
 *
 * @param  {string[]}   argv        The arguments
 * @param  {object}     [options]   `stdin` as bytes, and `tty` for a terminal
 * @return {Promise<object>}        The exit code and what the two streams got
 */
async function cli(argv, options) {
  const settings = options || {};

  const stdin = Readable.from(typeof settings.stdin === 'undefined' ? [] : [Buffer.from(settings.stdin)]);
  const stdout = collector();
  const stderr = collector();

  stdin.isTTY = Boolean(settings.tty);

  const code = await run(argv, {stdin, stdout, stderr, version: VERSION});

  return {code, stdout, stderr};
}

/**
 * The PNG of a stream, the way an application makes it
 *
 * @param  {Uint8Array}   commands    The commands
 * @param  {object}       [options]   The options of the renderer
 * @param  {object}       [stitching] The options of stitch()
 * @return {Promise<Uint8Array>}      The contents of the file
 */
async function png(commands, options, stitching) {
  const renderer = new ReceiptPrinterRenderer(Object.assign({width: WIDTH}, options || {}));

  return toPng(stitch(renderer.render(commands), Object.assign({width: WIDTH}, stitching || {})));
}

/**
 * The display list of a stream
 *
 * @param  {Uint8Array}   commands    The commands
 * @param  {object}       [options]   The options of the renderer
 * @return {object}                   The list
 */
function layout(commands, options) {
  return new ReceiptPrinterRenderer(Object.assign({width: WIDTH}, options || {})).layout(commands);
}

/**
 * The items of a render split into the runs between its cuts, the pieces of
 * paper that come out
 *
 * @param  {object[]}   items   The items of a render
 * @return {Array<object[]>}    The runs
 */
function runs(items) {
  const result = [[]];

  for (const item of items) {
    if (item.type === 'cut') {
      result.push([]);
    } else {
      result[result.length - 1].push(item);
    }
  }

  return result;
}

describe('cli', function() {
  let target = null;

  beforeEach(function() {
    target = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-printer-renderer-cli-'));
  });

  afterEach(function() {
    fs.rmSync(target, {recursive: true, force: true});
  });

  /**
     * The path of a file in the temporary directory of the test
     *
     * @param  {string}   name   Name of the file
     * @return {string}          The path
     */
  function output(name) {
    return path.join(target, name);
  }

  /**
     * What the command wrote, as bytes
     *
     * @param  {string}       name   Name of the file
     * @return {Uint8Array}          The contents
     */
  function written(name) {
    return new Uint8Array(fs.readFileSync(path.join(target, name)));
  }

  describe('the default invocation', function() {
    it('should write the PNG of the stitched render, byte for byte', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '-o', output('receipt.png')]);

      assert.equal(code, 0);
      assert.equal(stderr.text(), '');

      assert.deepEqual(
          Array.from(written('receipt.png')),
          Array.from(await png(bytes('esc-pos', 'receipt'))),
      );
    });

    it('should write the same PNG to standard output when there is no --output', async function() {
      const {code, stdout} = await cli([file('esc-pos', 'receipt')]);

      assert.equal(code, 0);
      assert.deepEqual(Array.from(stdout.bytes()), Array.from(await png(bytes('esc-pos', 'receipt'))));
    });

    it('should render 576 dots wide, the 80 mm roll', async function() {
      await cli([file('esc-pos', 'receipt'), '-o', output('receipt.pbm')]);

      const paper = written('receipt.pbm');

      assert.equal(Buffer.from(paper.subarray(0, 8)).toString('utf8').split('\n')[1].split(' ')[0], '576');
    });
  });

  describe('the formats', function() {
    it('should write the PNG of the stitched render', async function() {
      await cli([file('esc-pos', 'receipt'), '-f', 'png', '-o', output('out.bin')]);

      assert.deepEqual(Array.from(written('out.bin')), Array.from(await png(bytes('esc-pos', 'receipt'))));
    });

    it('should write the PBM of the stitched render', async function() {
      await cli([file('esc-pos', 'receipt'), '-o', output('out.pbm')]);

      const items = new ReceiptPrinterRenderer({width: WIDTH}).render(bytes('esc-pos', 'receipt'));

      assert.deepEqual(Array.from(written('out.pbm')), Array.from(toPbm(stitch(items, {width: WIDTH}))));
    });

    it('should write the SVG of the display list', async function() {
      await cli([file('esc-pos', 'receipt'), '-o', output('out.svg')]);

      assert.equal(
          Buffer.from(written('out.svg')).toString('utf8'),
          toSvg(layout(bytes('esc-pos', 'receipt'))),
      );
    });

    it('should write the display list as JSON, with a newline behind it', async function() {
      await cli([file('esc-pos', 'receipt'), '-o', output('out.json')]);

      const text = Buffer.from(written('out.json')).toString('utf8');

      assert.equal(text, `${JSON.stringify(layout(bytes('esc-pos', 'receipt')), null, 2)}\n`);
      assert.equal(JSON.parse(text).version, 1);
    });

    it('should write the commands of the stream as text, one line per token', async function() {
      const {code, stdout} = await cli([file('esc-pos', 'text'), '-f', 'commands']);

      const tokens = decode(bytes('esc-pos', 'text'), 'esc-pos');
      const lines = stdout.text().split('\n');

      assert.equal(code, 0);
      assert.equal(lines[lines.length - 1], '');
      assert.equal(lines.length - 1, tokens.length);

      /* Every line is the token of decode() at the same position: where it
         begins, what it is called and what it says */

      const offset = String(tokens[tokens.length - 1].offset).length;
      const width = Math.max(...tokens.map((token) => label(token).length));

      for (const [index, token] of tokens.entries()) {
        assert.equal(
            lines[index],
            `${String(token.offset).padStart(offset)}  ${label(token).padEnd(width)}  ${said(token)}`.trimEnd(),
            `line ${index + 1}`,
        );
      }
    });

    it('should name a command by its mnemonic and a run of text by its text', async function() {
      const {stdout} = await cli(['-f', 'commands'], {stdin: Uint8Array.from([0x1b, 0x40, 0x41, 0x42, 0x0a])});

      assert.equal(stdout.text(), [
        '0  ESC @    Initialize the printer',
        '2  text     "AB"',
        '4  control  Line feed',
        '',
      ].join('\n'));
    });

    it('should read the codepage the mapping says, the way the renderer does', async function() {
      const stream = Uint8Array.from([0x1b, 0x74, 0x02, 0x41]);

      const epson = await cli(['-f', 'commands'], {stdin: stream});
      const citizen = await cli(['-f', 'commands', '-m', 'citizen'], {stdin: stream});

      assert.include(epson.stdout.text(), 'Select codepage 2, cp850');
      assert.include(citizen.stdout.text(), 'Select codepage 2, cp858');
    });

    it('should write the commands of the language -l auto found', async function() {
      const {code, stdout} = await cli([file('star-prnt', 'receipt'), '-l', 'auto', '-f', 'commands']);

      assert.equal(code, 0);
      assert.equal(stdout.text(), (await cli([
        file('star-prnt', 'receipt'), '-l', 'star-prnt', '-f', 'commands',
      ])).stdout.text());
    });

    it('should write one list for a stream with a cut in it', async function() {
      const plain = await cli([file('esc-pos', 'cut'), '-f', 'commands']);
      const {code} = await cli([file('esc-pos', 'cut'), '-f', 'commands', '-o', output('list.txt')]);

      assert.equal(code, 0);
      assert.equal(Buffer.from(written('list.txt')).toString('utf8'), plain.stdout.text());
    });

    it('should refuse --pieces for it, which has no pieces to number', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'cut'), '-f', 'commands', '--pieces', '-o', output('l.txt')]);

      assert.equal(code, 1);
      assert.equal(
          stderr.text(),
          'receipt-printer-renderer: --pieces has no pieces for the commands format, ' +
          'which is one list of the stream, see --help\n',
      );
    });

    it('should refuse --pieces for it before it asks for an --output', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'cut'), '-f', 'commands', '--pieces']);

      assert.equal(code, 1);
      assert.match(stderr.text(), /--pieces has no pieces for the commands format/);
      assert.notMatch(stderr.text(), /needs --output/);
    });

    it('should take the format from the extension of the output', async function() {
      await cli([file('esc-pos', 'receipt'), '-o', output('one.svg')]);
      await cli([file('esc-pos', 'receipt'), '-f', 'svg', '-o', output('two.txt')]);

      assert.deepEqual(Array.from(written('one.svg')), Array.from(written('two.txt')));
    });

    it('should let --format win over the extension', async function() {
      await cli([file('esc-pos', 'receipt'), '-f', 'pbm', '-o', output('out.png')]);

      assert.equal(Buffer.from(written('out.png').subarray(0, 2)).toString('utf8'), 'P4');
    });

    it('should refuse an extension it does not know without a --format', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '-o', output('out.tiff')]);

      assert.equal(code, 1);
      assert.match(
          stderr.text(),
          /Cannot tell the format of .*out\.tiff, use --format with one of png, svg, pbm, json/,
      );
    });

    it('should refuse a name without an extension without a --format', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '-o', output('out')]);

      assert.equal(code, 1);
      assert.match(stderr.text(), /Cannot tell the format of /);
    });

    it('should refuse a format it does not have', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '-f', 'gif']);

      assert.equal(code, 1);
      assert.equal(
          stderr.text(),
          'receipt-printer-renderer: Unknown format gif, must be one of ' +
          'png, svg, pbm, json, commands, see --help\n',
      );
    });
  });

  describe('the width', function() {
    it('should render at the width of --width', async function() {
      await cli([file('esc-pos', 'receipt'), '-w', '384', '-o', output('out.png')]);

      assert.deepEqual(
          Array.from(written('out.png')),
          Array.from(await toPng(stitch(
              new ReceiptPrinterRenderer({width: 384}).render(bytes('esc-pos', 'receipt')),
              {width: 384},
          ))),
      );
    });

    it('should count --columns as twelve dots each', async function() {
      await cli([file('esc-pos', 'receipt'), '-c', '32', '-o', output('columns.png')]);
      await cli([file('esc-pos', 'receipt'), '-w', '384', '-o', output('width.png')]);

      assert.deepEqual(Array.from(written('columns.png')), Array.from(written('width.png')));
    });

    it('should refuse --width and --columns together', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '-w', '576', '-c', '48']);

      assert.equal(code, 1);
      assert.equal(stderr.text(), 'receipt-printer-renderer: Use --width or --columns, not both, see --help\n');
    });

    it('should refuse a width that is not a positive multiple of 8', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '-w', '100']);

      assert.equal(code, 1);
      assert.match(stderr.text(), /Width must be a positive multiple of 8 dots, not 100, see --help/);
    });

    it('should refuse a number of columns that is not a multiple of 8 dots', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '-c', '33']);

      assert.equal(code, 1);
      assert.match(stderr.text(), /33 columns is 396 dots, which is not a positive multiple of 8, see --help/);
    });

    it('should refuse a width that is not a number at all', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '-w', 'wide']);

      assert.equal(code, 1);
      assert.match(stderr.text(), /--width takes a whole number, not wide/);
    });
  });

  describe('the languages', function() {
    const languages = [
      {language: 'esc-pos', fixture: ['esc-pos', 'receipt']},
      {language: 'star-prnt', fixture: ['star-prnt', 'receipt']},
      {language: 'star-line', fixture: ['star-prnt', 'receipt']},
      {language: 'star-graphics', fixture: ['star-prnt/raw', 'star-graphics']},
    ];

    for (const {language, fixture} of languages) {
      it(`should render ${language} the way the renderer of that language does`, async function() {
        const {code} = await cli([file(...fixture), '-l', language, '-o', output('out.png')]);

        assert.equal(code, 0);
        assert.deepEqual(
            Array.from(written('out.png')),
            Array.from(await png(bytes(...fixture), {language})),
        );
      });
    }

    it('should render a Star stream differently than an ESC/POS one', async function() {
      await cli([file('star-prnt', 'receipt'), '-l', 'star-prnt', '-o', output('star.png')]);
      await cli([file('star-prnt', 'receipt'), '-o', output('escpos.png')]);

      assert.notDeepEqual(Array.from(written('star.png')), Array.from(written('escpos.png')));
    });

    it('should refuse a language it does not have, and name the four it does with auto behind them', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '-l', 'meow']);

      assert.equal(code, 1);
      assert.equal(
          stderr.text(),
          'receipt-printer-renderer: Unknown language meow, must be one of ' +
          'esc-pos, star-prnt, star-line, star-graphics, auto, see --help\n',
      );
    });

    it('should refuse the language without reading the input, which -l auto is the exception to', async function() {
      const {code, stderr} = await cli(['-l', 'meow', '/no/such/file.bin']);

      assert.equal(code, 1);
      assert.match(stderr.text(), /Unknown language meow/);
    });
  });

  describe('the automatic language', function() {
    const automatic = [
      {name: 'an ESC/POS stream', fixture: ['esc-pos', 'receipt'], language: 'esc-pos'},
      {name: 'a StarPRNT stream', fixture: ['star-prnt', 'receipt'], language: 'star-prnt'},
      {name: 'a Star Graphics raster job', fixture: ['star-prnt/raw', 'star-graphics'], language: 'star-graphics'},
    ];

    for (const {name, fixture, language} of automatic) {
      it(`should read ${name} as ${language} and render it that way`, async function() {
        assert.equal(detect(bytes(...fixture)), language);

        const {code} = await cli([file(...fixture), '-l', 'auto', '-o', output('auto.png')]);

        assert.equal(code, 0);
        assert.deepEqual(
            Array.from(written('auto.png')),
            Array.from(await png(bytes(...fixture), {language})),
        );
      });
    }

    it('should render a stream of nothing but text as ESC/POS, which is the tie', async function() {
      const text = Buffer.from('The quick brown fox\n', 'ascii');

      const {code} = await cli(['-l', 'auto', '-o', output('text.png')], {stdin: text});

      assert.equal(code, 0);
      assert.deepEqual(
          Array.from(written('text.png')),
          Array.from(await png(new Uint8Array(text), {language: 'esc-pos'})),
      );
    });

    it('should read the file before it builds the renderer, so the mapping of the language applies', async function() {
      const {code} = await cli([file('star-prnt', 'receipt'), '-l', 'auto', '-m', 'star', '-o', output('star.png')]);

      assert.equal(code, 0);
      assert.deepEqual(
          Array.from(written('star.png')),
          Array.from(await png(bytes('star-prnt', 'receipt'), {language: 'star-prnt', codepageMapping: 'star'})),
      );
    });
  });

  describe('the pieces', function() {
    it('should write one numbered file per piece of paper', async function() {
      const {code} = await cli([file('esc-pos', 'cut'), '--pieces', '-o', output('receipt.png')]);

      assert.equal(code, 0);
      assert.deepEqual(fs.readdirSync(target).sort(), ['receipt.2.png', 'receipt.3.png', 'receipt.png']);
    });

    it('should write the stitched run between two cuts in every one of them', async function() {
      await cli([file('esc-pos', 'cut'), '--pieces', '-o', output('receipt.png')]);

      const items = new ReceiptPrinterRenderer({width: WIDTH, commands: ['cut']}).render(bytes('esc-pos', 'cut'));
      const papers = runs(items).map((run) => stitch(run, {width: WIDTH})).filter((paper) => paper.height > 0);

      assert.equal(papers.length, 3);

      for (const [index, paper] of papers.entries()) {
        assert.deepEqual(
            Array.from(written(index ? `receipt.${index + 1}.png` : 'receipt.png')),
            Array.from(await toPng(paper)),
            `piece ${index + 1}`,
        );
      }
    });

    it('should write one plain file for a stream without a cut', async function() {
      await cli([file('esc-pos', 'text'), '--pieces', '-o', output('text.png')]);

      assert.deepEqual(fs.readdirSync(target), ['text.png']);
      assert.deepEqual(
          Array.from(written('text.png')),
          Array.from(await png(bytes('esc-pos', 'text'), {commands: ['cut']})),
      );
    });

    it('should write the pieces of the display list as SVG', async function() {
      await cli([file('esc-pos', 'cut'), '--pieces', '-o', output('receipt.svg')]);

      const split = pieces(layout(bytes('esc-pos', 'cut'), {commands: ['cut']}));

      assert.equal(split.length, 3);

      for (const [index, piece] of split.entries()) {
        assert.equal(
            Buffer.from(written(index ? `receipt.${index + 1}.svg` : 'receipt.svg')).toString('utf8'),
            toSvg(piece),
            `piece ${index + 1}`,
        );
      }
    });

    it('should write the pieces of the display list as JSON', async function() {
      await cli([file('esc-pos', 'cut'), '--pieces', '-o', output('receipt.json')]);

      const split = pieces(layout(bytes('esc-pos', 'cut'), {commands: ['cut']}));

      for (const [index, piece] of split.entries()) {
        assert.equal(
            Buffer.from(written(index ? `receipt.${index + 1}.json` : 'receipt.json')).toString('utf8'),
            `${JSON.stringify(piece, null, 2)}\n`,
            `piece ${index + 1}`,
        );
      }
    });

    it('should number a name without an extension behind the name', async function() {
      await cli([file('esc-pos', 'cut'), '--pieces', '-f', 'pbm', '-o', output('receipt')]);

      assert.deepEqual(fs.readdirSync(target).sort(), ['receipt', 'receipt.2', 'receipt.3']);
    });

    it('should need an --output to number', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'cut'), '--pieces']);

      assert.equal(code, 1);
      assert.equal(
          stderr.text(),
          'receipt-printer-renderer: --pieces needs --output, since there is no name to number, see --help\n',
      );
    });

    it('should ignore --cut-marker, since a piece has no cut inside it', async function() {
      await cli([file('esc-pos', 'cut'), '--pieces', '-o', output('plain.png')]);
      await cli([file('esc-pos', 'cut'), '--pieces', '--cut-marker', '-o', output('marked.png')]);

      assert.deepEqual(Array.from(written('plain.png')), Array.from(written('marked.png')));
    });
  });

  describe('the cut marker', function() {
    it('should be the marker of stitch() for the bitmaps', async function() {
      await cli([file('esc-pos', 'cut'), '--cut-marker', '-o', output('out.png')]);

      assert.deepEqual(
          Array.from(written('out.png')),
          Array.from(await png(bytes('esc-pos', 'cut'), {commands: ['cut']}, {cutMarker: true})),
      );
    });

    it('should make the paper taller than the same render without it', async function() {
      await cli([file('esc-pos', 'cut'), '--cut-marker', '-o', output('marked.pbm')]);
      await cli([file('esc-pos', 'cut'), '-o', output('plain.pbm')]);

      assert.isAbove(written('marked.pbm').length, written('plain.pbm').length);
    });

    it('should be the marker of toSvg() for the SVG', async function() {
      await cli([file('esc-pos', 'cut'), '--cut-marker', '-o', output('out.svg')]);

      assert.equal(
          Buffer.from(written('out.svg')).toString('utf8'),
          toSvg(layout(bytes('esc-pos', 'cut'), {commands: ['cut']}), {cutMarker: true}),
      );

      assert.notEqual(
          Buffer.from(written('out.svg')).toString('utf8'),
          toSvg(layout(bytes('esc-pos', 'cut'), {commands: ['cut']})),
      );
    });
  });

  describe('the renderer options', function() {
    it('should pass --commands on, which is what makes the printer perform a cut', async function() {
      /* The demo of escpos-php reverse feeds ninety dots and cuts, so a printer
         that performs the cut has the paper of that feed in front of it and
         one that ignores the cut does not: the two render to another paper,
         which is what a command reaching the renderer looks like */

      const demo = ['external/escpos-php', 'demo'];

      await cli([file(...demo), '--commands', 'cut', '-o', output('performed.png')]);
      await cli([file(...demo), '-o', output('ignored.png')]);

      assert.deepEqual(
          Array.from(written('performed.png')),
          Array.from(await png(bytes(...demo), {commands: ['cut']})),
      );

      assert.notDeepEqual(Array.from(written('performed.png')), Array.from(written('ignored.png')));
    });

    it('should add the cut of --pieces to the commands that were listed', async function() {
      await cli([file('esc-pos', 'cut'), '--commands', 'pulse', '--pieces', '-o', output('paper.png')]);
      await cli([file('esc-pos', 'cut'), '--commands', 'pulse', '--pieces', '-o', output('paper.svg')]);

      const files = fs.readdirSync(target).sort();

      assert.deepEqual(files.filter((name) => name.endsWith('.png')).length, 3);
      assert.deepEqual(
          files.filter((name) => name.endsWith('.png')).map((name) => name.replace('.png', '')),
          files.filter((name) => name.endsWith('.svg')).map((name) => name.replace('.svg', '')),
          'the bitmaps and the documents are split into the same pieces',
      );
    });

    it('should add the cut of --cut-marker to the commands that were listed', async function() {
      await cli([file('esc-pos', 'cut'), '--commands', 'pulse', '--cut-marker', '-o', output('out.png')]);

      assert.deepEqual(
          Array.from(written('out.png')),
          Array.from(await png(bytes('esc-pos', 'cut'), {commands: ['pulse', 'cut']}, {cutMarker: true})),
      );
    });

    it('should pass --cutter-distance on, which moves the cuts and the pieces of paper', async function() {
      /* The cutter sits above the print head, so the blank lines the receipt
         fixture feeds in front of its cut stay in the printer and become the
         top of the next piece, and the job starts on the blank paper that was
         left there before it: the first piece keeps its rows and the second
         one grows by the distance */

      await cli([file('esc-pos', 'receipt'), '--cutter-distance', '120', '--pieces', '-o', output('shifted.png')]);

      assert.deepEqual(fs.readdirSync(target).sort(), ['shifted.2.png', 'shifted.png']);

      const options = {commands: ['cut'], cutterDistance: 120};
      const items = new ReceiptPrinterRenderer(Object.assign({width: WIDTH}, options)).render(
          bytes('esc-pos', 'receipt'),
      );

      const papers = runs(items).map((run) => stitch(run, {width: WIDTH})).filter((paper) => paper.height > 0);

      assert.deepEqual(papers.map((paper) => paper.height), [683, 150]);

      for (const [index, paper] of papers.entries()) {
        assert.deepEqual(
            Array.from(written(index ? `shifted.${index + 1}.png` : 'shifted.png')),
            Array.from(await toPng(paper)),
            `piece ${index + 1}`,
        );
      }

      /* And without the option the same stream leaves the last piece thirty
         rows tall, the feed of one line that stands behind its cut */

      await cli([file('esc-pos', 'receipt'), '--pieces', '-o', output('plain.png')]);

      const plain = new ReceiptPrinterRenderer({width: WIDTH, commands: ['cut']}).render(bytes('esc-pos', 'receipt'));

      assert.deepEqual(
          runs(plain).map((run) => stitch(run, {width: WIDTH})).filter((paper) => paper.height > 0)
              .map((paper) => paper.height),
          [683, 30],
      );
    });

    it('should refuse a --cutter-distance that is not a whole number', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'cut'), '--cutter-distance', 'far', '-o', output('x.png')]);

      assert.equal(code, 1);
      assert.match(stderr.text(), /--cutter-distance takes a whole number, not far/);
    });

    it('should pass --line-spacing on', async function() {
      await cli([file('esc-pos', 'receipt'), '--line-spacing', '40', '-o', output('spaced.png')]);
      await cli([file('esc-pos', 'receipt'), '-o', output('plain.png')]);

      assert.deepEqual(
          Array.from(written('spaced.png')),
          Array.from(await png(bytes('esc-pos', 'receipt'), {lineSpacing: 40})),
      );

      assert.notDeepEqual(Array.from(written('spaced.png')), Array.from(written('plain.png')));
    });

    it('should pass --codepage-mapping on', async function() {
      await cli([file('esc-pos', 'codepages'), '-m', 'citizen', '-o', output('citizen.png')]);

      assert.deepEqual(
          Array.from(written('citizen.png')),
          Array.from(await png(bytes('esc-pos', 'codepages'), {codepageMapping: 'citizen'})),
      );

      await cli([file('esc-pos', 'codepages'), '-o', output('epson.png')]);

      assert.notDeepEqual(Array.from(written('citizen.png')), Array.from(written('epson.png')));
    });

    it('should pass --profile on', async function() {
      await cli([file('esc-pos', 'receipt'), '-p', 'star', '-o', output('out.png')]);

      assert.deepEqual(
          Array.from(written('out.png')),
          Array.from(await png(bytes('esc-pos', 'receipt'), {profile: 'star'})),
      );
    });

    it('should refuse a command it does not know', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '--commands', 'cut,meow']);

      assert.equal(code, 1);
      assert.equal(
          stderr.text(),
          'receipt-printer-renderer: Unknown command meow, must be one of cut, pulse, feed, unknown, see --help\n',
      );
    });

    it('should refuse a codepage mapping the language does not have, and name the ones it does', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '-m', 'meow']);

      assert.equal(code, 1);
      assert.match(stderr.text(), /^receipt-printer-renderer: Unknown codepage mapping meow, must be one of .*epson/);
      assert.match(stderr.text(), /, see --help\n$/);
    });

    it('should name the mappings of the Star languages for a Star stream', async function() {
      const {code, stderr} = await cli([file('star-prnt', 'receipt'), '-l', 'star-prnt', '-m', 'epson']);

      assert.equal(code, 1);
      assert.equal(
          stderr.text(),
          'receipt-printer-renderer: Unknown codepage mapping epson, must be one of star, see --help\n',
      );
    });

    it('should refuse a profile the package does not have, and name the ones it does', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '-p', 'meow']);

      assert.equal(code, 1);
      assert.equal(
          stderr.text(),
          'receipt-printer-renderer: Unknown printer profile meow, must be one of epson, star, see --help\n',
      );
    });
  });

  describe('the SVG options', function() {
    it('should pass --units on to the writer', async function() {
      await cli([file('esc-pos', 'receipt'), '--units', 'mm', '-o', output('out.svg')]);

      const text = Buffer.from(written('out.svg')).toString('utf8');

      assert.equal(text, toSvg(layout(bytes('esc-pos', 'receipt')), {units: 'mm'}));
      assert.match(text, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[0-9.]+mm"/);
    });

    it('should refuse units the writer does not have', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '--units', 'inches', '-o', output('out.svg')]);

      assert.equal(code, 1);
      assert.equal(
          stderr.text(),
          'receipt-printer-renderer: Unknown units inches, must be one of dots, mm, pt, px, see --help\n',
      );
      assert.isFalse(fs.existsSync(output('out.svg')));
    });

    it('should pass --ink on to the writer', async function() {
      await cli([file('esc-pos', 'receipt'), '--ink', '#336699', '-o', output('out.svg')]);

      const text = Buffer.from(written('out.svg')).toString('utf8');

      assert.equal(text, toSvg(layout(bytes('esc-pos', 'receipt')), {ink: '#336699'}));
      assert.include(text, '#336699');
    });

    it('should turn --background none into the transparent paper of the writer', async function() {
      await cli([file('esc-pos', 'receipt'), '--background', 'none', '-o', output('out.svg')]);

      assert.equal(
          Buffer.from(written('out.svg')).toString('utf8'),
          toSvg(layout(bytes('esc-pos', 'receipt')), {background: null}),
      );
    });

    it('should leave the defaults of the writer alone when no SVG option is given', async function() {
      await cli([file('esc-pos', 'receipt'), '-o', output('out.svg')]);

      const text = Buffer.from(written('out.svg')).toString('utf8');

      assert.equal(text, toSvg(layout(bytes('esc-pos', 'receipt'))));
      assert.include(text, '#fff');
    });

    it('should ignore an SVG option for another format instead of refusing it', async function() {
      const {code} = await cli([file('esc-pos', 'receipt'), '--ink', '#336699', '-o', output('out.png')]);

      assert.equal(code, 0);
      assert.deepEqual(Array.from(written('out.png')), Array.from(await png(bytes('esc-pos', 'receipt'))));
    });
  });

  describe('standard input and standard output', function() {
    it('should read the commands from standard input when there is no file', async function() {
      const {code, stdout} = await cli([], {stdin: bytes('esc-pos', 'receipt')});

      assert.equal(code, 0);
      assert.deepEqual(Array.from(stdout.bytes()), Array.from(await png(bytes('esc-pos', 'receipt'))));
    });

    it('should read standard input for a - as well', async function() {
      const {code, stdout} = await cli(['-'], {stdin: bytes('esc-pos', 'receipt'), tty: true});

      assert.equal(code, 0);
      assert.deepEqual(Array.from(stdout.bytes()), Array.from(await png(bytes('esc-pos', 'receipt'))));
    });

    it('should write a text format to standard output as text', async function() {
      const {stdout} = await cli(['-f', 'svg'], {stdin: bytes('esc-pos', 'receipt')});

      assert.equal(stdout.text(), toSvg(layout(bytes('esc-pos', 'receipt'))));
    });

    it('should print the usage on a terminal with nothing to read', async function() {
      const {code, stdout, stderr} = await cli([], {tty: true});

      assert.equal(code, 1);
      assert.equal(stdout.text(), '');
      assert.match(stderr.text(), /^Usage: receipt-printer-renderer \[options\] \[input\]/);
    });

    it('should say what is wrong with the options before it prints the usage', async function() {
      const format = await cli(['-f', 'gif'], {tty: true});

      assert.equal(format.code, 1);
      assert.match(format.stderr.text(), /^receipt-printer-renderer: Unknown format gif/);

      const split = await cli(['--pieces'], {tty: true});

      assert.equal(split.code, 1);
      assert.match(split.stderr.text(), /^receipt-printer-renderer: --pieces needs --output/);
    });

    it('should write to standard output for an --output of -', async function() {
      const {code, stdout} = await cli([file('esc-pos', 'receipt'), '-o', '-', '-f', 'svg']);

      assert.equal(code, 0);
      assert.equal(stdout.text(), toSvg(layout(bytes('esc-pos', 'receipt'))));
      assert.deepEqual(fs.readdirSync(target), []);
    });

    it('should write the PNG of standard output for an --output of - without a format', async function() {
      const {code, stdout} = await cli([file('esc-pos', 'receipt'), '-o', '-']);

      assert.equal(code, 0);
      assert.deepEqual(Array.from(stdout.bytes()), Array.from(await png(bytes('esc-pos', 'receipt'))));
    });

    it('should refuse --pieces on an --output of -, which is no name to number', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'cut'), '--pieces', '-o', '-']);

      assert.equal(code, 1);
      assert.match(stderr.text(), /^receipt-printer-renderer: --pieces needs --output/);
    });
  });

  describe('the errors', function() {
    it('should refuse an option it does not know', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '--meow']);

      assert.equal(code, 1);
      assert.match(stderr.text(), /^receipt-printer-renderer: .*'--meow'.*, see --help\n$/);
    });

    it('should write an error of more than one sentence as one line', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '-w', '-8']);

      assert.equal(code, 1);
      assert.equal(stderr.text().split('\n').length, 2, 'one line and the newline that ends it');
      assert.match(stderr.text(), /^receipt-printer-renderer: Option '-w' argument is ambiguous\. Did you forget/);
      assert.match(stderr.text(), /, see --help\n$/);
    });

    it('should refuse an option that was given without its value', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '--width']);

      assert.equal(code, 1);
      assert.match(stderr.text(), /, see --help\n$/);
    });

    it('should refuse more than one input file', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), file('esc-pos', 'cut')]);

      assert.equal(code, 1);
      assert.equal(stderr.text(), 'receipt-printer-renderer: Only one input file at a time, see --help\n');
    });

    it('should refuse an input file it cannot read', async function() {
      const {code, stderr} = await cli([output('nothing.bin')]);

      assert.equal(code, 1);
      assert.match(stderr.text(), /^receipt-printer-renderer: Cannot read .*nothing\.bin, see --help\n$/);
    });

    it('should refuse an output it cannot write', async function() {
      const {code, stderr} = await cli([file('esc-pos', 'receipt'), '-o', output('nowhere/out.png')]);

      assert.equal(code, 1);
      assert.match(stderr.text(), /^receipt-printer-renderer: Cannot write .*out\.png, see --help\n$/);
    });

    it('should exit with 2 when the writer cannot handle the stream', async function() {
      const {code, stderr} = await cli(['-o', output('out.png')], {stdin: new Uint8Array(0)});

      assert.equal(code, 2);
      assert.equal(
          stderr.text(),
          'receipt-printer-renderer: A PNG needs an image of at least one dot, this one has none\n',
      );
      assert.isFalse(fs.existsSync(output('out.png')));
    });
  });

  describe('the help and the version', function() {
    it('should print the usage on standard output and exit with 0', async function() {
      const {code, stdout, stderr} = await cli(['--help']);

      assert.equal(code, 0);
      assert.equal(stderr.text(), '');
      assert.match(stdout.text(), /^Usage: receipt-printer-renderer \[options\] \[input\]/);
      assert.include(stdout.text(), '-l, --language <name>');
      assert.include(stdout.text(), 'receipt.2.png');
      assert.include(stdout.text(), 'Exit codes:');
    });

    it('should print the usage for -h as well', async function() {
      const {code, stdout} = await cli(['-h']);

      assert.equal(code, 0);
      assert.match(stdout.text(), /^Usage: /);
    });

    it('should wrap the usage at eighty columns', async function() {
      const {stdout} = await cli(['--help']);

      for (const line of stdout.text().split('\n')) {
        assert.isAtMost(line.length, 80, line);
      }
    });

    it('should print the version it was given and exit with 0', async function() {
      const {code, stdout} = await cli(['--version']);

      assert.equal(code, 0);
      assert.equal(stdout.text(), `${VERSION}\n`);
    });

    it('should print the version for -v as well', async function() {
      const {stdout} = await cli(['-v']);

      assert.equal(stdout.text(), `${VERSION}\n`);
    });
  });
});
