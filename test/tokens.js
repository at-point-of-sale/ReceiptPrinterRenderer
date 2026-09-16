import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {tokenize, LANGUAGES} from '@point-of-sale/receipt-printer-decoder/tokenizer';
import EscPosRenderer from '../src/renderers/esc-pos.js';
import StarPrntRenderer from '../src/renderers/star-prnt.js';
import {assert} from 'chai';

/*
    The renderers and the tables of the tokenizer, see documentation/decoder-plan.md.

    Both renderers hand the syntax of their language to
    @point-of-sale/receipt-printer-decoder: `tokenize()` says where every
    command begins and ends and the renderer says what it does to the paper. The
    two only meet if they agree on which byte pairs are a command, so a handler
    of a command the tokenizer has no length for would read its arguments as
    text and lose the rest of the stream.

    That agreement is asserted here, one test per handler and through the
    tokenizer alone. The tokenizer's own tables are not imported, they are not
    part of the package's interface and a test that read them would only assert
    them back; what the handlers are asked for instead is three things a stream
    shows:

    - the token is a command of that prefix and that command byte, rather than
      the text or the ignored bytes a prefix without a table would become;
    - `known` is true, which is the tokenizer saying the table has this entry
      and not that it fell back on the prefix and the command byte alone. This
      is the assertion that bites: a command the table has nothing for still
      comes back as a two byte command of the right prefix and code;
    - the command is as long as it says it is, and the command behind it is
      still a command. The stream is rebuilt as the header, the argument bytes
      the token claimed, and an `ESC @` behind them, and the tokens of it are
      exactly those two commands. A length that overruns or falls short shows
      up there and nowhere else.

    The handlers come from `EscPosRenderer.handlers()` and
    `StarPrntRenderer.handlers()`, two statics that exist for this file.
*/

/* The argument bytes that go behind a header, of which one filling has to make
   the command complete. A command whose length is in its arguments reads them:
   a run of NUL bytes ends every command that is terminated by one and gives
   every count and every size of an image the value zero, and the Star barcode
   ends at a record separator instead, which is why there are two */

const PADDING = [
  Array(512).fill(0),
  Array(256).fill([0x00, 0x1e]).flat(),
];

/* The command behind the command under test, which both languages have and
   both read as two bytes: ESC @, initialize the printer */

const SENTINEL = [0x1b, 0x40];

/* The prefix of an ESC/POS command is one byte and the mnemonic names it; a
   Star command is ESC and a command byte, or one of the three groups of two
   bytes and a command byte */

const PREFIXES = {
  'esc-pos': {'ESC': [0x1b], 'GS': [0x1d], 'FS': [0x1c], 'DLE': [0x10]},
  'star-prnt': {'ESC': [0x1b], 'ESC GS': [0x1b, 0x1d], 'ESC RS': [0x1b, 0x1e], 'ESC FS': [0x1b, 0x1c]},
};

/* The number of handlers each renderer has, which is what the decoder counted
   from the other side when it took the tables over, 74 and 47. A handler that
   is added on one side and not on the other fails the tests below; a handler
   that is added to both silently would pass them, and these two numbers are
   what makes that a decision rather than a diff nobody read */

const COUNTS = {'esc-pos.js': 74, 'star-prnt.js': 47};

/**
 * The renderers, their language and the handlers they report
 *
 * @return {object[]}   One entry per renderer
 */
function renderers() {
  return [
    {file: 'esc-pos.js', language: 'esc-pos', handlers: EscPosRenderer.handlers()},
    {file: 'star-prnt.js', language: 'star-prnt', handlers: StarPrntRenderer.handlers()},
  ];
}

/**
 * The handlers of a renderer as a flat list, in the order of its tables
 *
 * @param  {Object<string, number[]>}   tables   What handlers() reported
 * @return {object[]}                            The handlers, `{prefix, code}` each
 */
function flatten(tables) {
  return Object.entries(tables).flatMap(
      ([prefix, codes]) => codes.map((code) => ({prefix, code})),
  );
}

/**
 * The version of a package in node_modules
 *
 * @param  {string}   name   Name of the package
 * @return {string}          The version of the manifest that is installed
 */
function installed(name) {
  const manifest = path.join(
      path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', name, 'package.json',
  );

  return JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
}

/**
 * Whether a version satisfies a caret range, which is the only kind of range
 * this package writes: the same major, and no older than the minor and the
 * patch the range names
 *
 * @param  {string}    version   The version that is installed
 * @param  {string}    range     The range of the manifest
 * @return {boolean}             True when the range accepts the version
 */
function satisfies(version, range) {
  const wanted = range.replace(/^\^/, '').split('.').map(Number);
  const have = version.split('-')[0].split('.').map(Number);

  if (have[0] !== wanted[0]) {
    return false;
  }

  for (let index = 1; index < 3; index++) {
    if (have[index] > wanted[index]) {
      return true;
    }

    if (have[index] < wanted[index]) {
      return false;
    }
  }

  return true;
}

describe('the tokenizer of the decoder', function() {
  const DECODER = '@point-of-sale/receipt-printer-decoder';

  describe('the dependency', function() {
    const manifest = JSON.parse(fs.readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8',
    ));

    it('should be a dependency of the package, not a development one', function() {
      assert.isString(manifest.dependencies[DECODER]);
      assert.isUndefined((manifest.devDependencies || {})[DECODER]);
    });

    it('should be installed in a version the manifest accepts', function() {
      const range = manifest.dependencies[DECODER];
      const version = installed(DECODER);

      console.log(`      ${DECODER} ${version}, which ${range} accepts`);

      assert.isTrue(satisfies(version, range), `${version} does not satisfy ${range}`);
    });

    it('should read the four languages this package renders', function() {
      assert.deepEqual(LANGUAGES.slice().sort(), ['esc-pos', 'star-graphics', 'star-line', 'star-prnt']);
    });
  });

  describe('the assertion itself', function() {
    /* The tests below would pass on a tokenizer that has no table at all, were
       it not for `known`: a prefix and a command byte the table has nothing for
       take their two bytes and come back as a command of exactly that prefix
       and that code. This is the case that says so, and it is a command byte
       neither language has a handler for */

    it('should read a command the table has nothing for as a command all the same', function() {
      const [token] = tokenize(Uint8Array.from([0x1d, 0xfe, 0x41, 0x42]), 'esc-pos');

      assert.equal(token.type, 'command');
      assert.equal(token.prefix, 'GS');
      assert.equal(token.code, 0xfe);
      assert.equal(token.length, 2);

      /* Which is why every handler below is asserted on this flag */

      assert.isFalse(token.known);
    });
  });

  for (const {file, language, handlers} of renderers()) {
    describe(`the handlers of ${file}`, function() {
      const list = flatten(handlers);

      /* Star's ESC FS group is a table without a handler in it, both of its
         commands print a logo this renderer does not draw, so the prefixes of
         the handlers are a subset rather than the whole of the groups */

      it('should key their tables by the prefixes the tokens carry', function() {
        for (const prefix of Object.keys(handlers)) {
          assert.isArray(PREFIXES[language][prefix], `${prefix} is not a prefix of ${language}`);
        }
      });

      it(`should be ${COUNTS[file]} commands, the number the decoder took over`, function() {
        console.log(`      ${list.length} handlers in src/renderers/${file}`);

        assert.equal(list.length, COUNTS[file]);
      });

      for (const {prefix, code} of list) {
        const name = `${prefix} 0x${code.toString(16).padStart(2, '0')}`;

        it(`should have a length for ${name}, the command of a handler`, function() {
          const header = PREFIXES[language][prefix].concat(code);

          const read = PADDING.map((padding) => {
            return tokenize(Uint8Array.from([...header, ...padding]), language)[0];
          });

          const command = read.find((token) => token &&
            token.type === 'command' && token.prefix === prefix && token.code === code);

          assert.isObject(command, `${name} is read as ${read.map((token) => token && token.type).join(' or ')}`);

          /* The table has this command rather than falling back on its prefix
             and its command byte, which is the assertion that bites */

          assert.isTrue(command.known, `${name} is not a command the tokenizer knows`);

          /* And the length it claims is the length it takes: the same command
             with nothing but an ESC @ behind it is those two commands and
             nothing else, so a length that overruns or falls short shows */

          const bytes = Uint8Array.from([...header, ...command.arguments, ...SENTINEL]);
          const tokens = tokenize(bytes, language);

          assert.equal(command.length, header.length + command.arguments.length);
          assert.deepEqual(
              tokens.map((token) => `${token.type} ${token.prefix || ''} ${token.length}`),
              [`command ${prefix} ${command.length}`, 'command ESC 2'],
              `${name} does not leave the stream at the byte behind it`,
          );
        });
      }
    });
  }
});
