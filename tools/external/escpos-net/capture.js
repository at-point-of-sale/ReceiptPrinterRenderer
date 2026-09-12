import {write, report, today} from '../shared.js';

/*
    ESCPOS_NET, MIT, https://github.com/lukevp/ESC-POS-.NET

    A .NET library, so nothing is run here. Its unit tests hold the byte arrays
    its EPSON emitter is expected to produce, and those are taken as they are:
    this script assembles the arrays the way the test writes them and freezes
    the streams, with the provenance naming the test file, the test and the row
    of the theory the bytes come from.

    The one test with literal byte arrays is PrintQRCode_Success of
    ESCPOS_NET.UnitTest/EmittersBased/EPSONTests/BarCode.cs, a theory over the
    three QR models, the five module sizes and the four correction levels. A
    representative row per model is captured, not all sixty, so that the eye
    review stays possible.

        node tools/external/escpos-net/capture.js

    Nothing here runs during npm test.
*/

const LIBRARY = 'escpos-net';

const SOURCE = 'https://github.com/lukevp/ESC-POS-.NET';

/* The commit the byte arrays are read from */

const COMMIT = 'ac185fc58bf9e5ad937750b8fc92c02baf344cc9';

const FILE = 'ESCPOS_NET.UnitTest/EmittersBased/EPSONTests/BarCode.cs';

/* The line of the test the arrays are on, for the provenance */

const LINE = 76;

/* The enums of ESCPOS_NET/Emitters/Enums/2DCode.cs, which are the values the
   theory rows carry */

const MODELS = {'model1': 49, 'model2': 50, 'micro': 51};
const SIZES = {'tiny': 2, 'small': 3, 'normal': 4, 'large': 5, 'extra': 6};
const LEVELS = {'7': 48, '15': 49, '25': 50, '30': 51};

/* The two strings the test encodes, the short one for the micro model */

const WEBSITE = 'https://github.com/lukevp/ESC-POS-.NET/';
const SHORTER = 'https://github.com/';

/* The print width the fixtures are rendered at: the test names no printer, and
   a QR code is a block of its own, so this is the 80 mm paper of the other
   fixtures */

const WIDTH = 576;
const COLUMNS = 48;

/*
    The rows of the theory that are captured, one per model with the sizes and
    the levels spread over them.
*/

const CAPTURES = [
  {name: 'qrcode-model1-normal-7', model: 'model1', size: 'normal', level: '7'},
  {name: 'qrcode-model2-normal-15', model: 'model2', size: 'normal', level: '15'},
  {name: 'qrcode-model2-tiny-30', model: 'model2', size: 'tiny', level: '30'},
  {name: 'qrcode-model2-extra-25', model: 'model2', size: 'extra', level: '25'},
  {name: 'qrcode-micro-large-25', model: 'micro', size: 'large', level: '25'},
];

/**
 * The bytes of a row of the theory, assembled the way the test writes them:
 * the model, the module size and the correction level, then the data of the
 * symbol, then the command that prints it
 *
 * @param  {object}   capture   One of CAPTURES
 * @return {Uint8Array}         The stream
 */
function stream(capture) {
  const data = capture.model === 'micro' ? SHORTER : WEBSITE;
  const bytes = [];

  const text = Array.from(data, (character) => character.charCodeAt(0));

  bytes.push(29, 40, 107, 4, 0, 49, 65, MODELS[capture.model], 0);
  bytes.push(29, 40, 107, 3, 0, 49, 67, SIZES[capture.size]);
  bytes.push(29, 40, 107, 3, 0, 49, 69, LEVELS[capture.level]);
  bytes.push(29, 40, 107, text.length + 3, 0, 49, 80, 48, ...text);
  bytes.push(29, 40, 107, 3, 0, 49, 81, 48);

  return Uint8Array.from(bytes);
}

/**
 * Capture the fixtures this script was asked for
 *
 * @param  {string[]}   only   Names of the fixtures, empty for all of them
 */
function main(only) {
  const list = CAPTURES.filter((capture) => only.length === 0 || only.includes(capture.name));

  if (!list.length) {
    throw new Error(`No such fixture, one of ${CAPTURES.map((capture) => capture.name).join(', ')}`);
  }

  console.log(LIBRARY);

  for (const capture of list) {
    const result = write(LIBRARY, capture.name, stream(capture), {
      source: SOURCE,
      file: FILE,
      commit: COMMIT,
      licence: 'MIT',
      setup: 'npm install',
      command: `node tools/external/${LIBRARY}/capture.js ${capture.name}`,
      version: COMMIT.slice(0, 7),
      language: 'esc-pos',
      columns: COLUMNS,
      width: WIDTH,
      codepageMapping: 'epson',
      captured: today(),
      notes: `PrintQRCode_Success of ${FILE}, line ${LINE}, the theory row ` +
        `QRCODE_${capture.model.toUpperCase()}, ${capture.size.toUpperCase()}, ` +
        `PERCENT_${capture.level}. The bytes are the array the test expects, not a run of the library. ` +
        'Reviewed as a PNG and decoded with jsQR.',
    });

    console.log(report(capture.name, result));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main(process.argv.slice(2));
}
