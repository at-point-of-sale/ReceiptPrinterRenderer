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
| `-o, --output <path>` | standard output, or `-` | Where the image goes; `-` is standard output, the way it is for the input. With `--pieces` the path is the pattern of the names, see below |
| `-f, --format <name>` | from the extension of `--output`, `png` for standard output | `png`, `svg`, `pbm` or `json`, which is the display list of `layout()` as JSON |
| `--pieces` | off | One image per piece of paper, the list split at its cuts with `pieces()`. Needs `--output` |
| `--cut-marker` | off | A dashed line where the paper is cut, in one image of the whole roll: `stitch()`'s marker for the bitmaps, `toSvg()`'s for the SVG. Nothing with `--pieces`, which has no cut inside a piece |
| `--commands <list>` | the renderer's | Comma separated `cut`, `pulse`, `feed`, `unknown`, the `commands` option of the renderer |
| `--line-spacing <dots>` | the renderer's | The option of the same name |
| `--units <name>`, `--background <colour>`, `--ink <colour>` | the writer's | The SVG options; `--background none` is a transparent paper. Nothing for the other formats |
| `-h, --help` | | The usage, to standard output, exit 0 |
| `-v, --version` | | The version of the package, exit 0 |

**Formats.** `png` and `pbm` are the stitched paper, `stitch(render(bytes), {width, cutMarker})` through `toPng()` or `toPbm()`. `svg` is `toSvg(layout(bytes), options)`. `json` is `JSON.stringify(layout(bytes), null, 2)` with a newline, for looking at what a stream lays out. The format is the extension of the output file when there is one and `--format` says nothing, so `-o receipt.svg` writes SVG; an extension the command does not know, or no extension, needs `--format`. Standard output is binary safe: the PNG bytes are written as they are, and the three text formats end in a newline.

**Pieces.** `--pieces` splits the stream at its cuts: the items of `render()` per run between two cut items for the bitmaps, the way the contact sheet does it, and `pieces(layout())` for SVG and JSON, which is the same split on the list. The files are named after `--output` the way the contact sheet names them: the first piece keeps the name, the rest are numbered from 2 before the extension, `receipt.png`, `receipt.2.png`, `receipt.3.png`. A stream without a cut writes one file under the plain name. A piece that has no rows, a cut at the very end, is skipped and does not take a number. `--pieces` with standard output is an error, since there is no name to number.

**Exit codes and errors.** 0 when the image was written. 1 for a usage error: an unknown option, a language, a format or a profile the package does not have, a width that is not a positive multiple of 8, `--pieces` without `--output`, an input file that cannot be read. 2 when the renderer or the writer threw, which is a stream the package cannot handle. Every error is one line on standard error, `receipt-printer-renderer: ` and the message, and the usage errors add `see --help`. An unknown language names the four; an unknown profile names the profiles of that language.

<br>

## Structure

- **`src/cli.js`** holds the command as a function, `run(argv, io)`, where `argv` is the arguments after the script name and `io` is `{stdin, stdout, stderr, version}`: readable and writable streams, so the tests drive it in process with buffers and never spawn anything. It returns a promise of the exit code and never calls `process.exit()` itself. It reads and writes files through `node:fs`, resolving relative paths against the working directory. The main entry's classes and helpers are imported from `./receipt-printer-renderer.js` and `toSvg` from `./svg.js`, so the command sees the source in development and the bundle when built.
- **`bin/receipt-printer-renderer.js`** is the shim: a shebang line, an import of `../dist/receipt-printer-renderer-cli.mjs`, the version read from `../package.json`, and `process.exitCode = await run(process.argv.slice(2), {stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, version})`. It is the one file that touches `process`, and it ends the process quietly when standard output reports EPIPE, a pipe closed before the image was through, `| head` on a PNG, which is the reader's business and not an error of the command.
- **`rollup.config.js`** gains an entry for `src/cli.js` to `dist/receipt-printer-renderer-cli.mjs`, ES module only, with the two dependencies and the Node built-ins external as in the other Node builds, and the renderer and the SVG writer external as well: `output.paths` points `src/receipt-printer-renderer.js` and `src/svg.js` at `./receipt-printer-renderer.mjs` and `./receipt-printer-renderer-svg.mjs`, the two module builds that ship beside it, so that the package holds one copy of the renderer and one of the glyph outlines and the command is the arguments and nothing else. The declarations are not built for it: the command is not an API and `tsconfig.json` does not include it.
- **`package.json`**: `"bin": {"receipt-printer-renderer": "bin/receipt-printer-renderer.js"}`, `bin` added to `files`, `"engines": {"node": ">=18"}`, and a script `test:bin` that runs the built command, see the tests.

<br>

## The plan

### Section 1: the command

`src/cli.js` with `run()`, the argument parsing, the defaults, the four formats, the pieces, the cut marker, the renderer and SVG options, the usage text and the version, the errors and the exit codes, all as the interface above says. `test/cli.js` drives it in process over the fixtures: the default invocation on `test/fixtures/esc-pos/receipt.bin` writes the PNG that `toPng(stitch(render()))` gives, byte for byte; every format against its helper; `--columns` against `--width`; the four languages on a fixture of each, `star-line` and `star-graphics` included; `--pieces` on `test/fixtures/esc-pos/cut.bin` writes the numbered files and each equals the stitched run of the items between the cuts, and on a stream without a cut writes one plain file; `--cut-marker` is the marker of `stitch()` and of `toSvg()`; the renderer options reach the renderer, `--commands` by the paper a performed cut leaves behind and `--line-spacing` by a taller receipt; the SVG options reach the writer; standard input and standard output carry the bytes; every usage error gives 1 with its message and a stream that throws gives 2; `--help` and `--version` give 0 with their text. Effort: half a day.

**Fixed after the review, 2026-09-16.** Six things the bug check found, all in `src/cli.js` and `test/cli.js`:

- **A cut is performed whether or not `--commands` lists one.** `commandsOf()` returned the user's list as it stood, so `--commands pulse --pieces` wrote one PNG and three SVGs and `--commands pulse --cut-marker` drew a marker in the SVG and none in the PNG. `cut` is now appended to the list when `--pieces` or `--cut-marker` is given, which is what the usage text always claimed; two tests hold it, the file names of the two formats against each other and the marked PNG against `stitch()` of a render with `['pulse', 'cut']`.
- **`--feed-threshold` and `--max-height` are gone**, from the options, the usage text, the tests and the plan. Both shape the item stream of `render()`, and the command writes the stitched paper or the display list, neither of which shows a feed item or the seam between two image items, so no value of either could ever change a byte the command writes: the tests for them compared two identical renders and passed for that reason. The Decisions list carries the reasoning.
- **The `--commands` test is a real one.** It renders `test/fixtures/external/escpos-php/demo.bin`, whose stream reverse feeds ninety dots over a cut, so a printer that performs the cut cannot feed back over it and the paper is 2477 rows against 2417: the PNG of `--commands cut` differs from the PNG without it and equals the API's. `--line-spacing 40` is checked the same way, equal to the API and different from the default.
- **An error is one line.** `parseArgs` writes three sentences on three lines for `-w -8`; every run of whitespace with a newline in it is now one space before the line is written, so standard error carries exactly one line ending in `, see --help`.
- **`-o -` is standard output**, the mirror of `-` for the input: the format comes from `--format` or is PNG, nothing is written to a file, and `--pieces` is refused for want of a name to number.
- **The options are checked before the terminal.** A `--pieces` or an `-f gif` typed at a terminal used to get the whole usage; it now gets its own message, and the usage is for an invocation whose options are right and that has nothing to read.

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
- No `--feed-threshold` and no `--max-height`: they shape the item stream of `render()`, which the command never writes, so they could not change an image or a list; `--commands` stays because a cut the printer performs takes the paper away and changes the paper, and `--line-spacing` because it changes the paper.
- Node 18 as the floor, for `parseArgs` and `CompressionStream`, which the package's own `toPng()` already needs; stated in `engines` rather than assumed.

<br>

## Notes per section

*Written when a section lands.*

### Section 1: the command

Date: 2026-09-16. `src/cli.js` added, `test/cli.js` added, 71 tests; `src/renderers/esc-pos.js` and `src/renderers/star-prnt.js` changed, for the messages of the two tables they own.

**The shape of it.** `run(argv, io)` is the whole command: it parses with `parseArgs` of `node:util`, `allowPositionals` and `strict`, builds the renderer, reads the bytes, renders and writes, and returns 0, 1 or 2. It catches everything: a `UsageError`, which is the class the argument checks throw, is one line of `receipt-printer-renderer: ` and the message and `, see --help`, and anything else is the same line without the pointer and exit 2. The order of the checks is the arguments first and the stream last: the positionals, `--pieces` against `--output`, the format, the width, the commands, the SVG options, then the renderer's own constructor, then the terminal, then the bytes. Nothing is read or rendered before every option has been read, so an invocation that is wrong is told what is wrong with it rather than made to wait for a stream.

**A cut is added when the command needs one.** The plan did not say what `--commands` defaults to, only that it is the renderer's, and the renderer's is nothing: `render()` emits an item for a command only when `commands` names it, so `--pieces` would have had nothing to split at and `--cut-marker` nothing to draw. The display list is the other way round, it carries every cut whatever the option says, so `--pieces` on an SVG would have written three files where the PNG wrote one. The command therefore adds `cut` to the commands whenever `--pieces` or `--cut-marker` is given, listed or not: the two formats agree for every combination, `--commands pulse --pieces` included. It is in the usage text under `--commands`.

**Where the line between 1 and 2 runs.** The renderer's constructor validates the language, the width, the codepage mapping and the profile, which are all arguments, so what it throws is a usage error, passed through as it was thrown, and exits 1; what `render()`, `layout()`, `stitch()` or `toSvg()` throws afterwards is about the stream and exits 2. `--units` is the one option that would otherwise fall on the wrong side of that line, since the writer checks it and the writer is a stream error by then, so the command checks it against `dots, mm, pt, px` before anything is rendered, with a comment saying that the list is the writer's `UNITS` table and has to follow it. It is checked whatever the format is, the way `--width` is: an argument that means nothing is worth saying even where the format would ignore it.

**The messages name the names, and the renderers say them.** The unified class already named the four languages in its error. The two renderers now do the same for the two tables they own: `Unknown codepage mapping meow, must be one of bixolon/legacy, bixolon, citizen, ...` and `Unknown printer profile meow, must be one of epson, star`, the names being the keys of `generated/mapping.js` for that language and of `generated/profiles.js`. The command therefore reads no generated table of its own and matches no message: it hands the constructor's error to standard error as it stands, and every caller of the package gets the better message and not only the command. `test/receipt-printer-renderer.js` asserts the mapping message per language and gains a test for the profile message.

**PBM is bytes, not text.** The plan calls PNG binary and the other three text. A binary P4 is a header and the rows of the bitmap, so the command writes PNG and PBM exactly as their helpers give them and only adds a newline where there is one to add: `toSvg()` already ends in one, and the JSON gets one. Every file the command writes is therefore byte for byte what the helper of that format returns, which is what the tests assert.

**The names of the pieces** are split at the last dot of the last part of the path, so `out/receipt.png` numbers as `out/receipt.2.png` and a name without an extension, `receipt`, numbers as `receipt.2`. A stream that leaves no piece at all, which is a stream with nothing on the paper, still writes its one file under the plain name, so that `--pieces` and a plain render fail over an empty paper in the same way instead of differently. An output that cannot be written is a usage error like an input that cannot be read, 1 and `Cannot write receipt.png`: both are a path the user gave.

**Exit 2 is reachable** without inventing a broken stream: an empty input renders to no items, stitches to a paper of no dots, and `toPng()` refuses it, `A PNG needs an image of at least one dot, this one has none`. That is the case the test uses, and it also shows that nothing is written when the writer throws.

**Tests.** 71 in `test/cli.js`, driven in process over a `Readable` for standard input, two collecting writables and a fresh `mkdtemp` directory per test. Everything the section lists: the default invocation byte for byte against `toPng(stitch(render()))`, the four formats against their helpers, `--columns 32` against `--width 384`, the four languages each on a fixture of its own, `star-graphics` on `test/fixtures/star-prnt/raw/star-graphics.bin` and `star-line` on the StarPRNT receipt, which is the same command set, `--pieces` on `cut.bin` as three numbered files each equal to its stitched run and as the three pieces of `pieces(layout())` for SVG and JSON, a stream without a cut as one plain file, `--cut-marker` against the marker of `stitch()` and of `toSvg()`, the renderer options against the same options through the API, the SVG options against the same options through the writer and an unknown unit as a 1, standard input to standard output and `-o -` to standard output, every usage error with its code and its message, the stream error with 2, and `--help` and `--version` with 0. Two fixtures had to be chosen with care: `receipt.bin` has a cut in it, so the one plain file of a stream without a cut is checked on `text.bin`, and the `codepages` fixture renders the same under most mappings, so `citizen` is the one that proves `--codepage-mapping` arrives.

**Fixed after the review, 2026-09-16.** Six things the bug check found, all in `src/cli.js` and `test/cli.js`:

- **A cut is performed whether or not `--commands` lists one.** `commandsOf()` returned the user's list as it stood, so `--commands pulse --pieces` wrote one PNG and three SVGs and `--commands pulse --cut-marker` drew a marker in the SVG and none in the PNG. `cut` is now appended to the list when `--pieces` or `--cut-marker` is given, which is what the usage text always claimed; two tests hold it, the file names of the two formats against each other and the marked PNG against `stitch()` of a render with `['pulse', 'cut']`.
- **`--feed-threshold` and `--max-height` are gone**, from the options, the usage text, the tests and the plan. Both shape the item stream of `render()`, and the command writes the stitched paper or the display list, neither of which shows a feed item or the seam between two image items, so no value of either could ever change a byte the command writes: the tests for them compared two identical renders and passed for that reason. The Decisions list carries the reasoning.
- **The `--commands` test is a real one.** It renders `test/fixtures/external/escpos-php/demo.bin`, whose stream reverse feeds ninety dots over a cut, so a printer that performs the cut cannot feed back over it and the paper is 2477 rows against 2417: the PNG of `--commands cut` differs from the PNG without it and equals the API's. `--line-spacing 40` is checked the same way, equal to the API and different from the default.
- **An error is one line.** `parseArgs` writes three sentences on three lines for `-w -8`; every run of whitespace with a newline in it is now one space before the line is written, so standard error carries exactly one line ending in `, see --help`.
- **`-o -` is standard output**, the mirror of `-` for the input: the format comes from `--format` or is PNG, nothing is written to a file, and `--pieces` is refused for want of a name to number.
- **The options are checked before the terminal.** A `--pieces` or an `-f gif` typed at a terminal used to get the whole usage; it now gets its own message, and the usage is for an invocation whose options are right and that has nothing to read.

### Section 2: the bin, the build and the package

Date: 2026-09-16. `bin/receipt-printer-renderer.js` added, mode 755, `rollup.config.js` and `package.json` changed, `test/bin/check.js` added.

**The shim** is thirty lines: the shebang, the import of `../dist/receipt-printer-renderer-cli.mjs`, the version out of `../package.json`, and `process.exitCode = await run(...)` over the three real streams. The exit code is set and not passed to `process.exit()`, so that what standard output still holds is flushed before the process ends, which a pipe needs.

**The build.** One rollup entry, `src/cli.js` to `dist/receipt-printer-renderer-cli.mjs`, ES module, no minification, the way the Node builds of the entries are made. The two dependencies and `/^node:/` are external, and so are the renderer and the SVG writer: an `external` function matches the resolved paths of `src/receipt-printer-renderer.js` and `src/svg.js`, and `output.paths` maps them to `./receipt-printer-renderer.mjs` and `./receipt-printer-renderer-svg.mjs`, the module builds that sit beside it in `dist`. The built file opens with those two imports and holds nothing else of the package: 22 kB, which is `src/cli.js` with its comments, against the 1.2 MB it was when it bundled the renderer and the outlines a third time. No declarations: `tsconfig.json` is unchanged and does not include it.

**The package** gains `"bin": {"receipt-printer-renderer": "bin/receipt-printer-renderer.js"}`, `bin` in `files`, `"engines": {"node": ">=18"}` and the script `test:bin`. `npm pack --dry-run` lists 19 files, `bin/receipt-printer-renderer.js` and `dist/receipt-printer-renderer-cli.mjs` among them, 2.2 MB packed.

**The check.** `test/bin/check.js` is the UMD check's shape: it exits 1 with `No command line build found, run npm run build first` when the bundle is missing, which is what `test/umd/check.js` does for its own, and otherwise spawns the shim with `execFileSync` four times, a file in and a file out, a pipe in and a pipe out for the SVG, `--pieces` on `cut.bin` for the three names, and `--version` and `--help`, comparing the bytes with what the sources give for the same stream, and prints one line. `npx` on the packed tarball was not run; `npm exec --prefix . -- receipt-printer-renderer --version` prints the version of the manifest, which is the same resolution through the `bin` field.

**Fixed after the review, 2026-09-16.** The external matcher of the rollup entry compared `/src/receipt-printer-renderer.js` against a resolved path, which on Windows holds backslashes and would have matched nothing, bundling the renderer and the outlines back in without a word: an `entry()` helper now turns the separators of the platform into forward slashes before matching and is the one place both the `external` function and `output.paths` ask. And `lint` is `eslint --fix src test tools bin`, so the shim is linted like everything else; it passes as it stands.

### Section 3: documentation

Date: 2026-09-16. `documentation/usage.md`, `README.md` and `documentation/design.md` changed; no code and no tests.

**The section.** `documentation/usage.md` gains "Command line" between "Previewing a receipt" and "The display list", with the two ways to run it, five invocations, the table of the options as they now stand, and a paragraph each on the formats, the pieces and the exit codes. The table was written against the `OPTIONS` and the usage text of `src/cli.js` rather than against the table of this plan, so the defaults in it are the ones the command has: `--commands` is none, the three SVG options carry the writer's own defaults, `dots`, `#fff` and `#000`, rather than "the writer's", and `-o -` is named as standard output beside an absent `--output`. `--feed-threshold` and `--max-height` are nowhere in it. The paragraph on the pieces says that a cut is performed with `--pieces` or `--cut-marker` whether or not `--commands` lists one, and why. The contents list at the top of the page gains the section, and the paragraph that opens "Usage and installation" gains a sentence saying the package ships a command line; the list at the top does not mention "SVG output" or "Checking a render against other renderers" either, which was left as it was.

**The README** gains a paragraph and a two line block after the SVG example, `npx` on a file to a PNG and `npx -l star-prnt -c 32` to an SVG, with a pointer to the section; the closing paragraph of the page now names the command line among what the usage page covers.

**The design document** gains a "Command line" bullet in the module list of the architecture, one sentence for `src/cli.js` and one for the shim, and the two files in the repository layout, `src/cli.js` at the end of `src/` and a `bin/` of its own above `data/`. The roadmap is a numbered list of the work in the order it was done with "Later" as its tail, so the command line went in as a done item, 8, and "Later" became 9; it is not a history of releases and reads as a list of stages, which is why it was not written as a sentence inside "Later".

**Checked** against `node bin/receipt-printer-renderer.js --help` of the built command, option by option, and against `src/cli.js` for the exit codes and the wording of the messages, `receipt-printer-renderer: ` and a usage error ending in `, see --help`. Node 18 is named as the floor at the end of the section. Nothing was committed.
