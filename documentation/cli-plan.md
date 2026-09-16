# The command line

A plan for a command line that ships with the package: printer commands in, an image out. Written 2026-09-16 on the owner's decision; the defaults are his: ESC/POS, an 80 mm roll of 576 dots, the common Epson printer.

<br>

## Goal

Render a stream of printer commands to an image from the shell, without writing a script: the whole receipt as one stitched image, or one image per piece of paper, as PNG or SVG. It runs installed, `receipt-printer-renderer`, and it runs without installing, `npx @point-of-sale/receipt-printer-renderer`, which works because the package has one bin and its name is the unscoped name of the package.

```
npx @point-of-sale/receipt-printer-renderer receipt.bin -o receipt.png
receipt-printer-renderer -l star-prnt -c 32 receipt.bin -o receipt.svg
receipt-printer-renderer --pieces receipt.bin -o receipt.png     # receipt.png, receipt.2.png, ...
cat receipt.bin | receipt-printer-renderer > receipt.png
```

Everything the command does is public API already: `layout()`, `render()`, `rasterize()`, `pieces()`, `stitch()`, `toPng()`, `toPbm()` and `toSvg()`. The command is a thin layer that parses arguments, reads bytes and writes files, and it adds no dependency: `parseArgs` of `node:util` reads the arguments and `CompressionStream` writes the PNG, both in Node 18 and up, which becomes the `engines` of the package.

<br>

## The interface

```
receipt-printer-renderer [options] [input]
```

`input` is a file of printer commands. Left out, or `-`, it is standard input, read to the end. Standard input that is a terminal with no file given prints the usage and exits with 1, so that a bare invocation explains itself rather than waiting.

| Option | Default | Meaning |
|---|---|---|
| `-l, --language <name>` | `esc-pos` | `esc-pos`, `star-prnt`, `star-line` or `star-graphics`, the languages of `ReceiptPrinterRenderer.languages` |
| `-w, --width <dots>` | `576` | Width of the paper in dots, the 80 mm roll at 203 dpi |
| `-c, --columns <n>` | | Width as a number of font A columns, 12 dots each in every profile: `-c 48` is 576, `-c 32` is 384. Exclusive with `--width` |
| `-m, --codepage-mapping <name>` | the renderer's, `epson` for ESC/POS | Passed to the renderer as `codepageMapping` |
| `-p, --profile <name>` | the renderer's, `epson` for ESC/POS | Passed to the renderer as `profile`, a name of a built in profile |
| `-o, --output <path>` | standard output | Where the image goes. With `--pieces` the path is the pattern of the names, see below |
| `-f, --format <name>` | from the extension of `--output`, `png` for standard output | `png`, `svg`, `pbm` or `json`, which is the display list of `layout()` as JSON |
| `--pieces` | off | One image per piece of paper, the list split at its cuts with `pieces()`. Needs `--output` |
| `--cut-marker` | off | A dashed line where the paper is cut, in one image of the whole roll: `stitch()`'s marker for the bitmaps, `toSvg()`'s for the SVG. Nothing with `--pieces`, which has no cut inside a piece |
| `--commands <list>` | the renderer's | Comma separated `cut`, `pulse`, `feed`, `unknown`, the `commands` option of the renderer |
| `--feed-threshold <rows>`, `--max-height <rows>`, `--line-spacing <dots>` | the renderer's | The options of the same names |
| `--units <name>`, `--background <colour>`, `--ink <colour>` | the writer's | The SVG options; `--background none` is a transparent paper. Nothing for the other formats |
| `-h, --help` | | The usage, to standard output, exit 0 |
| `-v, --version` | | The version of the package, exit 0 |

**Formats.** `png` and `pbm` are the stitched paper, `stitch(render(bytes), {width, cutMarker})` through `toPng()` or `toPbm()`. `svg` is `toSvg(layout(bytes), options)`. `json` is `JSON.stringify(layout(bytes), null, 2)` with a newline, for looking at what a stream lays out. The format is the extension of the output file when there is one and `--format` says nothing, so `-o receipt.svg` writes SVG; an extension the command does not know, or no extension, needs `--format`. Standard output is binary safe: the PNG bytes are written as they are, and the three text formats end in a newline.

**Pieces.** `--pieces` splits the stream at its cuts: the items of `render()` per run between two cut items for the bitmaps, the way the contact sheet does it, and `pieces(layout())` for SVG and JSON, which is the same split on the list. The files are named after `--output` the way the contact sheet names them: the first piece keeps the name, the rest are numbered from 2 before the extension, `receipt.png`, `receipt.2.png`, `receipt.3.png`. A stream without a cut writes one file under the plain name. A piece that has no rows, a cut at the very end, is skipped and does not take a number. `--pieces` with standard output is an error, since there is no name to number.

**Exit codes and errors.** 0 when the image was written. 1 for a usage error: an unknown option, a language, a format or a profile the package does not have, a width that is not a positive multiple of 8, `--pieces` without `--output`, an input file that cannot be read. 2 when the renderer or the writer threw, which is a stream the package cannot handle. Every error is one line on standard error, `receipt-printer-renderer: ` and the message, and the usage errors add `see --help`. An unknown language names the four; an unknown profile names the profiles of that language.

<br>

## Structure

- **`src/cli.js`** holds the command as a function, `run(argv, io)`, where `argv` is the arguments after the script name and `io` is `{stdin, stdout, stderr, version}`: readable and writable streams, so the tests drive it in process with buffers and never spawn anything. It returns a promise of the exit code and never calls `process.exit()` itself. It reads and writes files through `node:fs`, resolving relative paths against the working directory. The main entry's classes and helpers are imported from `./receipt-printer-renderer.js` and `toSvg` from `./svg.js`, so the command sees the source in development and the bundle when built.
- **`bin/receipt-printer-renderer.js`** is the shim: a shebang line, an import of `../dist/receipt-printer-renderer-cli.mjs`, the version read from `../package.json`, and `process.exitCode = await run(process.argv.slice(2), {stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, version})`. It is the one file that touches `process`.
- **`rollup.config.js`** gains an entry for `src/cli.js` to `dist/receipt-printer-renderer-cli.mjs`, ES module only, with the two dependencies external as in the other Node builds and the Node built-ins external as well. The declarations are not built for it: the command is not an API and `tsconfig.json` does not include it.
- **`package.json`**: `"bin": {"receipt-printer-renderer": "bin/receipt-printer-renderer.js"}`, `bin` added to `files`, `"engines": {"node": ">=18"}`, and a script `test:bin` that runs the built command, see the tests.

<br>

## The plan

### Section 1: the command

`src/cli.js` with `run()`, the argument parsing, the defaults, the four formats, the pieces, the cut marker, the renderer and SVG options, the usage text and the version, the errors and the exit codes, all as the interface above says. `test/cli.js` drives it in process over the fixtures: the default invocation on `test/fixtures/esc-pos/receipt.bin` writes the PNG that `toPng(stitch(render()))` gives, byte for byte; every format against its helper; `--columns` against `--width`; the four languages on a fixture of each, `star-line` and `star-graphics` included; `--pieces` on `test/fixtures/esc-pos/cut.bin` writes the numbered files and each equals the stitched run of the items between the cuts, and on a stream without a cut writes one plain file; `--cut-marker` is the marker of `stitch()` and of `toSvg()`; the renderer options reach the renderer, `--commands` by an item that appears and `--feed-threshold` by a feed item; the SVG options reach the writer; standard input and standard output carry the bytes; every usage error gives 1 with its message and a stream that throws gives 2; `--help` and `--version` give 0 with their text. Effort: half a day.

### Section 2: the bin, the build and the package

The shim, the rollup entry, the `bin`, `files` and `engines` fields, and `test/bin/check.js` with the script `test:bin`, in the style of `test/umd/check.js`: it spawns the built shim with `node:child_process` on a fixture, once with a file and once through a pipe, and compares the bytes it wrote with the helper's; it is run after `npm run build`, the way `test:umd` is, and it says so when `dist` is missing rather than failing on the import. A check by hand that `npm pack` holds `bin/` and `dist/receipt-printer-renderer-cli.mjs`, and that `npx` on the packed tarball runs. Effort: a quarter of a day.

### Section 3: documentation

`documentation/usage.md` gains a section "Command line" after "Previewing a receipt", with the invocation, the table of options, the pieces naming and the exit codes; the README's usage gets the two line example with `npx` and a pointer to the section; `documentation/design.md`'s architecture names `src/cli.js` and the bin, and the roadmap's list gets the command. Effort: a quarter of a day.

<br>

## Decisions

Taken here:

- The defaults are the owner's: ESC/POS, 576 dots, and the renderer's own defaults for the codepage mapping and the profile, which are Epson's. A command that needs no option for the common case is the point of a command.
- One bin, named as the package without its scope, so `npx @point-of-sale/receipt-printer-renderer` needs no `--package` and an installed `receipt-printer-renderer` is the same command.
- The format comes from the extension, and standard output is PNG unless `--format` says otherwise: an image is what the command is for, and the text formats are asked for by name.
- The pieces are named the contact sheet's way, the name for the first and a number from 2 for the rest, so the two agree and a piece is found by the name of its file.
- No scaling, colour or margin options in the first version: the SVG scales by itself and the bitmaps are the paper; anything else is a job for the tool that receives the image.
- `json` is the display list and nothing else, since it is the one public description of a stream the package has; the item stream is bytes and has no useful text form.
- The command imports the source and is bundled like the entries, so the tests run it without a build and the package ships it built; the shim is the one file with a `process` in it.
- Node 18 as the floor, for `parseArgs` and `CompressionStream`, which the package's own `toPng()` already needs; stated in `engines` rather than assumed.

<br>

## Notes per section

*Written when a section lands.*
