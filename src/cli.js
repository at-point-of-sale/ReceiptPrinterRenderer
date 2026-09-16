import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';

import ReceiptPrinterRenderer, {pieces, stitch, toPbm, toPng} from './receipt-printer-renderer.js';
import {toSvg} from './svg.js';

/**
 * @typedef {import('./types.js').Layout} Layout
 * @typedef {import('./types.js').RenderItem} RenderItem
 * @typedef {import('./types.js').Bitmap} Bitmap
 */

/*
    The command line.

    Printer commands in, an image out: the command reads a file of commands or
    standard input, renders it the way an application would with the public
    helpers of the package, and writes a PNG, an SVG, a PBM or the display list
    as JSON. It adds nothing to the package but the arguments: everything it
    does is render(), layout(), stitch(), pieces(), toPng(), toPbm() and
    toSvg(), in the order the interface of documentation/cli-plan.md describes.

    The command is a function and not a script, run(argv, io), so that the tests
    drive it in process over buffers instead of spawning a process per case. It
    reads and writes files itself and it touches nothing of the process but the
    working directory it resolves relative paths against: the streams and the
    version it is given, and the exit code it returns, are the whole of its
    contact with the shell. bin/receipt-printer-renderer.js is the file that
    holds the process, and it holds nothing else.

    An error is one line on standard error and an exit code. The arguments the
    user wrote wrong are a usage error, 1, and so is a file that cannot be read
    or written; a stream the renderer or the writer cannot handle is 2, which
    tells a script that the command was called correctly and the commands in it
    were the problem. The renderer's constructor draws that line: it validates
    the width, the codepage mapping and the profile, which are arguments, so
    what it throws is a usage error, and what render(), layout(), stitch() or
    toSvg() throws afterwards is about the stream.
*/

/* The name the errors and the usage go out under, which is the name of the bin
   and of the package without its scope */

const NAME = 'receipt-printer-renderer';

/* The defaults of the owner: ESC/POS on an 80 mm roll at 203 dpi. The codepage
   mapping and the profile have no default here on purpose, so that the renderer
   of the language applies its own */

const DEFAULT_LANGUAGE = 'esc-pos';
const DEFAULT_WIDTH = 576;

/* How wide one font A column is, in every profile the package has, which is
   what --columns counts */

const DOTS_PER_COLUMN = 12;

/* The formats the command writes, and the one standard output gets when
   nothing says otherwise */

const FORMATS = ['png', 'svg', 'pbm', 'json'];
const DEFAULT_FORMAT = 'png';

/* The command types --commands takes, which are the ones the renderer emits
   items for */

const COMMANDS = ['cut', 'pulse', 'feed', 'unknown'];

/* The units --units takes, which are the UNITS table of src/svg/writer.js and
   have to follow it: the writer owns them, and this list is here so that a unit
   it does not have is a usage error of the arguments, 1, and not a stream the
   writer choked on, 2 */

const UNITS = ['dots', 'mm', 'pt', 'px'];

/* The exit codes: the arguments were wrong, or the stream was */

const EXIT_USAGE = 1;
const EXIT_STREAM = 2;

/* The options as parseArgs reads them, in the order of the table of the plan */

const OPTIONS = {
  'language': {type: 'string', short: 'l'},
  'width': {type: 'string', short: 'w'},
  'columns': {type: 'string', short: 'c'},
  'codepage-mapping': {type: 'string', short: 'm'},
  'profile': {type: 'string', short: 'p'},
  'output': {type: 'string', short: 'o'},
  'format': {type: 'string', short: 'f'},
  'pieces': {type: 'boolean'},
  'cut-marker': {type: 'boolean'},
  'commands': {type: 'string'},
  'line-spacing': {type: 'string'},
  'units': {type: 'string'},
  'background': {type: 'string'},
  'ink': {type: 'string'},
  'help': {type: 'boolean', short: 'h'},
  'version': {type: 'boolean', short: 'v'},
};

/* The usage, wrapped at eighty columns, with the options in the order of the
   table of the plan and their defaults behind them */

const USAGE = `Usage: ${NAME} [options] [input]

Render a stream of printer commands to an image: the whole receipt as one
stitched image, or one image per piece of paper. The input is a file of
commands; left out, or -, it is standard input, read to the end.

Options:
  -l, --language <name>          esc-pos, star-prnt, star-line or
                                 star-graphics (default: esc-pos)
  -w, --width <dots>             Width of the paper in dots, a positive
                                 multiple of 8 (default: 576)
  -c, --columns <n>              Width as a number of font A columns, 12 dots
                                 each: 48 is 576. Exclusive with --width
  -m, --codepage-mapping <name>  Codepage mapping the commands were encoded
                                 with (default: epson for ESC/POS, star for
                                 the Star languages)
  -p, --profile <name>           Printer family the defaults come from
                                 (default: epson for ESC/POS, star for the
                                 Star languages)
  -o, --output <path>            Where the image goes, - for standard output
                                 (default: standard output)
  -f, --format <name>            png, svg, pbm or json, the display list
                                 (default: the extension of --output, png for
                                 standard output)
      --pieces                   One image per piece of paper, the stream
                                 split at its cuts. Needs --output
      --cut-marker               A dashed line where the paper is cut, in one
                                 image of the whole roll. Nothing with
                                 --pieces, which has no cut inside a piece
      --commands <list>          Comma separated cut, pulse, feed and unknown,
                                 the commands the printer performs. A cut is
                                 added when --pieces or --cut-marker needs
                                 one, listed or not (default: none)
      --line-spacing <dots>      Default line spacing (default: the profile's)
      --units <name>             SVG: dots, mm, pt or px, the units of the
                                 width and the height of the document
                                 (default: dots)
      --background <colour>      SVG: colour of the paper, none for a
                                 transparent one (default: #fff)
      --ink <colour>             SVG: colour of the ink (default: #000)
  -h, --help                     This text, on standard output
  -v, --version                  The version of the package

The SVG options are ignored by the other formats.

Pieces:
  With --pieces the first piece keeps the name of --output and the rest are
  numbered from 2 before the extension: receipt.png, receipt.2.png,
  receipt.3.png. A stream without a cut writes one file under the plain name,
  and a piece with no rows on it, a cut at the very end, is skipped.

Exit codes:
  0  the image was written
  1  a usage error: an option, a file that cannot be read or written
  2  the renderer or the writer could not handle the stream

Examples:
  ${NAME} receipt.bin -o receipt.png
  ${NAME} -l star-prnt -c 32 receipt.bin -o receipt.svg
  ${NAME} --pieces receipt.bin -o receipt.png
  cat receipt.bin | ${NAME} > receipt.png
`;

/**
 * An error in the arguments, or in a file the arguments name: everything the
 * user can fix by writing the command differently, which exits with 1 and
 * points at the usage
 */
class UsageError extends Error {}

/**
 * Read the arguments, turning what parseArgs rejects into a usage error
 *
 * @param  {string[]}   argv   The arguments after the name of the script
 * @return {object}            The values and the positionals of parseArgs
 */
function parse(argv) {
  try {
    return parseArgs({args: argv, options: OPTIONS, allowPositionals: true, strict: true});
  } catch (error) {
    /* The messages of parseArgs are sentences, sometimes three of them on three
       lines; the full stop at the end would sit in front of the `, see --help`
       of the line they end up on, and the line breaks are taken out where that
       line is written */

    throw new UsageError(String(error.message).replace(/\.$/, ''));
  }
}

/**
 * The value of an option as a whole number of at least zero
 *
 * @param  {string}   value    What the user wrote
 * @param  {string}   option   Name of the option, for the message
 * @return {number}            The number
 */
function integer(value, option) {
  if (!/^\d+$/.test(String(value).trim())) {
    throw new UsageError(`${option} takes a whole number, not ${value}`);
  }

  return parseInt(String(value).trim(), 10);
}

/**
 * The width of the paper in dots, from --width, from --columns, or the default
 * of the owner
 *
 * @param  {object}   values   The options as they were given
 * @return {number}            The width in dots
 */
function widthOf(values) {
  if (typeof values.width !== 'undefined' && typeof values.columns !== 'undefined') {
    throw new UsageError('Use --width or --columns, not both');
  }

  if (typeof values.columns !== 'undefined') {
    const columns = integer(values.columns, '--columns');
    const width = columns * DOTS_PER_COLUMN;

    if (width < DOTS_PER_COLUMN || width % 8 !== 0) {
      throw new UsageError(
          `${columns} columns is ${width} dots, which is not a positive multiple of 8`,
      );
    }

    return width;
  }

  if (typeof values.width !== 'undefined') {
    const width = integer(values.width, '--width');

    if (width < 8 || width % 8 !== 0) {
      throw new UsageError(`Width must be a positive multiple of 8 dots, not ${width}`);
    }

    return width;
  }

  return DEFAULT_WIDTH;
}

/**
 * The command types the printer performs. A cut is added whenever --pieces or
 * --cut-marker is given, whether or not --commands lists one: the display list
 * carries every cut whatever this option says, but the items of a render carry
 * the ones the printer performs, so without it the two formats would disagree,
 * the SVG splitting into pieces the PNG has no cut to split at
 *
 * @param  {object}    values   The options as they were given
 * @return {string[]}           The command types, or undefined for the renderer's own
 */
function commandsOf(values) {
  const marker = Boolean(values.pieces || values['cut-marker']);

  if (typeof values.commands === 'undefined') {
    return marker ? ['cut'] : undefined;
  }

  const list = values.commands.split(',').map((name) => name.trim()).filter((name) => name.length);

  for (const name of list) {
    if (!COMMANDS.includes(name)) {
      throw new UsageError(`Unknown command ${name}, must be one of ${COMMANDS.join(', ')}`);
    }
  }

  return marker && !list.includes('cut') ? [...list, 'cut'] : list;
}

/**
 * The options of the renderer, the ones the user gave and no others, so that
 * the renderer of the language applies its own defaults to the rest
 *
 * @param  {object}   values   The options as they were given
 * @param  {number}   width    The width of the paper in dots
 * @return {object}            The options of ReceiptPrinterRenderer
 */
function rendererOptions(values, width) {
  const options = {language: values.language || DEFAULT_LANGUAGE, width};

  const commands = commandsOf(values);

  if (typeof commands !== 'undefined') {
    options.commands = commands;
  }

  if (typeof values['codepage-mapping'] !== 'undefined') {
    options.codepageMapping = values['codepage-mapping'];
  }

  if (typeof values.profile !== 'undefined') {
    options.profile = values.profile;
  }

  if (typeof values['line-spacing'] !== 'undefined') {
    options.lineSpacing = integer(values['line-spacing'], '--line-spacing');
  }

  return options;
}

/**
 * The options of the SVG writer, again only the ones the user gave: the writer
 * lays its defaults under the options it is handed, and a key that is there
 * with nothing in it would cover one
 *
 * @param  {object}   values   The options as they were given
 * @return {object}            The options of toSvg()
 */
function svgOptions(values) {
  const options = {};

  if (typeof values.units !== 'undefined') {
    if (!UNITS.includes(values.units)) {
      throw new UsageError(`Unknown units ${values.units}, must be one of ${UNITS.join(', ')}`);
    }

    options.units = values.units;
  }

  if (typeof values.background !== 'undefined') {
    options.background = values.background === 'none' ? null : values.background;
  }

  if (typeof values.ink !== 'undefined') {
    options.ink = values.ink;
  }

  return options;
}

/**
 * The format to write: what --format says, the extension of the output file,
 * or the PNG standard output gets
 *
 * @param  {object}        values   The options as they were given
 * @param  {string|null}   output   Path of the output file, or null for standard output
 * @return {string}                 The name of the format
 */
function formatOf(values, output) {
  if (typeof values.format !== 'undefined') {
    if (!FORMATS.includes(values.format)) {
      throw new UsageError(`Unknown format ${values.format}, must be one of ${FORMATS.join(', ')}`);
    }

    return values.format;
  }

  if (!output) {
    return DEFAULT_FORMAT;
  }

  const extension = path.extname(output).slice(1).toLowerCase();

  if (!FORMATS.includes(extension)) {
    throw new UsageError(
        `Cannot tell the format of ${output}, use --format with one of ${FORMATS.join(', ')}`,
    );
  }

  return extension;
}

/**
 * The renderer of the options, whose constructor validates the language, the
 * width, the codepage mapping and the profile, which are arguments and not a
 * stream: what it throws is a usage error, and it names the languages, the
 * mappings or the profiles the user may write itself
 *
 * @param  {object}   options   The options of ReceiptPrinterRenderer
 * @return {object}             The renderer
 */
function build(options) {
  try {
    return new ReceiptPrinterRenderer(options);
  } catch (error) {
    throw new UsageError(String(error.message));
  }
}

/**
 * The items of a render split into the pieces of paper they print: a run of
 * items between two cuts, the way the contact sheet splits them
 *
 * @param  {RenderItem[]}            items   The items of a render
 * @return {Array<RenderItem[]>}             The runs, one per piece of paper
 */
function runs(items) {
  const result = [[]];

  for (const item of items || []) {
    if (item.type === 'cut') {
      result.push([]);
    } else {
      result[result.length - 1].push(item);
    }
  }

  return result;
}

/**
 * Render the commands to the files the command writes, one per piece of paper
 * with --pieces and one altogether without it
 *
 * @param  {object}       renderer   The renderer of the language
 * @param  {Uint8Array}   bytes      The commands
 * @param  {object}       settings   The format, the options and the flags
 * @return {Promise<Array<Uint8Array|string>>}   The contents of the files, in the order they print
 */
async function documents(renderer, bytes, settings) {
  const width = settings.renderer.width;

  if (settings.format === 'png' || settings.format === 'pbm') {
    const items = renderer.render(bytes);

    /* A run with no rows on it, a cut at the very end, stitches to nothing and
       is skipped; a stream that leaves no run at all, which is a stream with
       nothing on the paper, still writes its one file, so that --pieces and a
       plain render fail over the same empty paper rather than differently */

    const stitched = settings.pieces ?
      runs(items).map((run) => stitch(run, {width})).filter((paper) => paper.height > 0) :
      [stitch(items, {width, cutMarker: settings.cutMarker})];

    const papers = stitched.length ? stitched : [stitch(items, {width})];

    if (settings.format === 'pbm') {
      return papers.map((paper) => toPbm(paper));
    }

    return Promise.all(papers.map((paper) => toPng(paper)));
  }

  const layout = renderer.layout(bytes);
  const split = settings.pieces ? pieces(layout) : [];
  const lists = split.length ? split : [layout];

  if (settings.format === 'json') {
    return lists.map((list) => `${JSON.stringify(list, null, 2)}\n`);
  }

  /* The cut marker of the writer is the marker of one image of the whole roll,
     so it belongs to the list that was not split; the SVG of a piece has no
     cut on it to draw */

  return lists.map((list) => toSvg(list, settings.pieces ?
    settings.svg :
    Object.assign({}, settings.svg, {cutMarker: settings.cutMarker})));
}

/**
 * The name of a piece: the first keeps the name of --output and the rest are
 * numbered from 2 before the extension, which is the last dot of the last part
 * of the path, the way the contact sheet names them
 *
 * @param  {string}   target   The path of --output
 * @param  {number}   index    Which piece it is, counting from zero
 * @return {string}            The path to write it to
 */
function name(target, index) {
  if (index === 0) {
    return target;
  }

  const directory = path.dirname(target);
  const base = path.basename(target);
  const dot = base.lastIndexOf('.');

  const named = dot > 0 ?
    `${base.slice(0, dot)}.${index + 1}${base.slice(dot)}` :
    `${base}.${index + 1}`;

  return path.join(directory, named);
}

/**
 * The commands to render: the file the user named, or standard input read to
 * the end
 *
 * @param  {string|null}   input   Path of the file, or null for standard input
 * @param  {object}        io      The streams of the caller
 * @return {Promise<Uint8Array>}   The bytes
 */
async function read(input, io) {
  if (input) {
    try {
      return new Uint8Array(fs.readFileSync(path.resolve(process.cwd(), input)));
    } catch (error) {
      throw new UsageError(`Cannot read ${input}`);
    }
  }

  const chunks = [];

  for await (const chunk of io.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'binary') : Buffer.from(chunk));
  }

  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Write what was rendered: the files of --output, numbered per piece, or the
 * one document standard output takes
 *
 * @param  {Array<Uint8Array|string>}   files      The contents, in the order they print
 * @param  {object}                     settings   The output path and the flags
 * @param  {object}                     io         The streams of the caller
 * @return {void}
 */
function write(files, settings, io) {
  if (!settings.output) {
    for (const file of files) {
      io.stdout.write(typeof file === 'string' ? file : Buffer.from(file));
    }

    return;
  }

  for (const [index, file] of files.entries()) {
    const target = path.resolve(process.cwd(), name(settings.output, index));

    try {
      fs.writeFileSync(target, typeof file === 'string' ? file : Buffer.from(file));
    } catch (error) {
      throw new UsageError(`Cannot write ${name(settings.output, index)}`);
    }
  }
}

/**
 * The command itself, which either writes what was asked for or throws
 *
 * @param  {string[]}   argv   The arguments after the name of the script
 * @param  {object}     io     The streams, and the version of the package
 * @return {Promise<number>}   The exit code
 */
async function command(argv, io) {
  const {values, positionals} = parse(argv);

  if (values.help) {
    io.stdout.write(USAGE);

    return 0;
  }

  if (values.version) {
    io.stdout.write(`${io.version}\n`);

    return 0;
  }

  if (positionals.length > 1) {
    throw new UsageError('Only one input file at a time');
  }

  /* A - is the standard stream on both sides, the input and the output */

  const input = positionals.length && positionals[0] !== '-' ? positionals[0] : null;
  const output = typeof values.output === 'undefined' || values.output === '-' ? null : values.output;

  if (values.pieces && !output) {
    throw new UsageError('--pieces needs --output, since there is no name to number');
  }

  const settings = {
    format: formatOf(values, output),
    output,
    pieces: Boolean(values.pieces),
    cutMarker: Boolean(values['cut-marker']),
    renderer: rendererOptions(values, widthOf(values)),
    svg: svgOptions(values),
  };

  /* The renderer is built before the input is read, so that an option it
     rejects is reported without reading a stream first. Every option has been
     read by now, the arguments first and the renderer's own last, so an
     invocation that is wrong is told what is wrong with it; the usage below is
     for an invocation that is right and has nothing to read */

  const renderer = build(settings.renderer);

  /* A bare invocation on a terminal explains itself instead of waiting for a
     stream that nobody is typing */

  if (!input && !positionals.length && io.stdin && io.stdin.isTTY) {
    io.stderr.write(USAGE);

    return EXIT_USAGE;
  }

  write(await documents(renderer, await read(input, io), settings), settings, io);

  return 0;
}

/**
 * Run the command: read the arguments, render the commands and write the
 * image, or write one line about what went wrong.
 *
 * It calls nothing of the process but cwd(), and process.exit() least of all:
 * the exit code is what it returns and the streams are what it was given, so
 * that a test drives it over buffers.
 *
 * @param  {string[]}   argv   The arguments after the name of the script
 * @param  {object}     io     {stdin, stdout, stderr, version}
 * @return {Promise<number>}   The exit code, 0, 1 or 2
 */
export async function run(argv, io) {
  try {
    return await command(argv, io);
  } catch (error) {
    /* One error is one line: the messages of parseArgs run over three lines of
       their own, and a line of standard error that a script reads with `head
       -1` or a log that counts lines must not break in the middle */

    const message = String(error && error.message ? error.message : error)
        .replace(/\s*\n\s*/g, ' ')
        .trim();

    if (error instanceof UsageError) {
      io.stderr.write(`${NAME}: ${message}, see --help\n`);

      return EXIT_USAGE;
    }

    io.stderr.write(`${NAME}: ${message}\n`);

    return EXIT_STREAM;
  }
}

export default run;
