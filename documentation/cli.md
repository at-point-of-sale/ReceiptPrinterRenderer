# ReceiptPrinterRenderer

<br>

Render the raw data sent to a receipt printer, ESC/POS, StarPRNT, Star Line or Star Graphics, to an image of the paper, and export it as PNG or SVG.

- [About ReceiptPrinterRenderer](../README.md)
- [Usage and installation](usage.md)
- [Command line interface](cli.md)
  - [Running it](#running-it)
  - [The input](#the-input)
  - [The output and its format](#the-output-and-its-format)
  - [The printer](#the-printer)
  - [Pieces of paper and cut markers](#pieces-of-paper-and-cut-markers)
  - [Commands the printer performs](#commands-the-printer-performs)
  - [SVG options](#svg-options)
  - [Exit codes and errors](#exit-codes-and-errors)
  - [All options](#all-options)
  - [Recipes](#recipes)

<br>

## Command line interface

The package ships with a command of its own: printer commands in, an image out, without writing a script for it. It is the renderer and the helpers of [Usage and installation](usage.md) with arguments in front of them and nothing else, which makes it the quickest way to look at a stream someone sent you, and a usable step in a build or a test script.

<br>

### Running it

The command is `receipt-printer-renderer`. It runs without installing anything through `npx`, because the package has one executable and it carries the name of the package:

```
npx @point-of-sale/receipt-printer-renderer receipt.bin -o receipt.png
```

Installed, globally or as a dependency of a project, the same command is on the path:

```
npm install --global @point-of-sale/receipt-printer-renderer
receipt-printer-renderer receipt.bin -o receipt.png
```

It needs Node 18 or later, as the package does. The defaults are the common case, an ESC/POS receipt for an Epson printer on an 80 mm roll, so that the invocation above needs no option at all; everything below is for the cases where the receipt is something else, or the output is.

<br>

### The input

The one positional argument is the file of printer commands, the bytes an application sent or would send to the printer, whatever produced them. It is read as it is: there is no text form of a stream to parse, so a file that holds anything but the raw bytes renders as garbage or as nothing.

```
receipt-printer-renderer receipt.bin -o receipt.png
```

Left out, or given as `-`, the input is standard input, read to the end, so the command sits at the end of a pipe:

```
cat receipt.bin | receipt-printer-renderer > receipt.png
some-capture-tool | receipt-printer-renderer -o capture.svg
```

A bare invocation at a terminal, one with no file and nothing piped in, writes the usage to standard error and exits with 1 rather than waiting for a stream nobody is typing.

<br>

### The output and its format

`-o` or `--output` names the file the image goes to. Without it, or with `-` as the name, the image goes to standard output, which is binary safe: a PNG arrives byte for byte.

```
receipt-printer-renderer receipt.bin -o receipt.png
receipt-printer-renderer receipt.bin > receipt.png
receipt-printer-renderer receipt.bin -o - | open -f -a Preview
```

There are four formats, and the command takes the format from the extension of the output file, so the three lines below write three different things without a further option:

```
receipt-printer-renderer receipt.bin -o receipt.png
receipt-printer-renderer receipt.bin -o receipt.svg
receipt-printer-renderer receipt.bin -o receipt.pbm
```

| Format | What it is |
|---|---|
| `png` | The paper as the printer prints it, one bit per dot, as a PNG. This is the format of standard output when nothing says otherwise. |
| `pbm` | The same dots as a portable bitmap, the binary P4 variant, for tools that read that and for diffs. |
| `svg` | The receipt as a vector document, the text as the outlines of the face the bitmap font was made from, so it scales and prints at the resolution of whatever renders it. See [SVG output](usage.md#svg-output). |
| `json` | Not an image: the display list of the stream, what is printed and where, indented, for looking at what a stream lays out or feeding a writer of your own. |

`-f` or `--format` names the format when the extension cannot, or should not: an output name without an extension or with one the command does not know needs it, standard output takes it to get anything but PNG, and given together with an extension it wins.

```
receipt-printer-renderer receipt.bin -f svg > receipt.svg
receipt-printer-renderer receipt.bin -f json | jq '.entries | length'
receipt-printer-renderer receipt.bin -o receipt.out -f pbm
```

<br>

### The printer

A stream only makes sense for the printer it was made for, and four options describe that printer. `-l` or `--language` names the command language: `esc-pos` for ESC/POS, which is the default, `star-prnt` for StarPRNT, `star-line` for Star Line Mode, and `star-graphics` for the raster protocol of a Star TSP100, which is a StarPRNT job wrapped in the raster commands of that family.

```
receipt-printer-renderer -l star-prnt receipt.bin -o receipt.png
```

`-w` or `--width` is the width of the paper in dots, a positive multiple of 8, and the default is 576, the 80 mm roll at 203 dots per inch. `-c` or `--columns` says the same as a number of characters of font A, which is 12 dots wide in every profile, so `-c 48` is 576 dots and `-c 32` the 384 of a 58 mm roll; the two are exclusive. The width has to be the one the application encoded for, or text wraps in the wrong place: the encoder's `columns` times 12 is the number to give.

```
receipt-printer-renderer -c 32 receipt.bin -o receipt.png
receipt-printer-renderer -w 384 receipt.bin -o receipt.png
```

`-m` or `--codepage-mapping` names the mapping the commands were encoded with, so that a codepage selection in the stream can be turned back into a codepage; the names are the encoder's, `epson`, `star`, `citizen`, `bixolon` and so on, and the default is the renderer's own, `epson` for ESC/POS and `star` for the Star languages. `-p` or `--profile` names the printer family whose defaults apply, the line spacing, the cell of font B, the motion unit and the resolution: `epson` or `star`, with the same defaults. A name the package does not have is refused with the names it does have.

```
receipt-printer-renderer -m citizen receipt.bin -o receipt.png
```

`--line-spacing` sets the default line spacing in dots, for a printer whose default is not the profile's, and is otherwise the profile's own, 30 dots for Epson and 32 for Star.

<br>

### Pieces of paper and cut markers

A receipt with cuts in it is several pieces of paper, and the command can write it either way. Without an option the whole roll is one image and the cuts are invisible, which is what the paper looks like before it is torn. `--cut-marker` draws a dashed line across the image where the paper is cut, in a PNG or PBM as two rows of alternating dots and in an SVG as a dashed line, so that one image still shows where the pieces are.

```
receipt-printer-renderer --cut-marker receipt.bin -o receipt.png
```

`--pieces` writes one image per piece of paper instead, the stream split at its cuts. The files are named after `--output`: the first piece keeps the name and the rest are numbered from 2 before the extension.

```
receipt-printer-renderer --pieces receipt.bin -o receipt.png
```

```
receipt.png
receipt.2.png
receipt.3.png
```

A stream without a cut in it writes one file under the plain name, so `--pieces` is safe to use on every stream. A piece with no rows on it, which is what a cut at the very end of a receipt leaves, is skipped and takes no number. Because the names are the point, `--pieces` needs `--output` and is refused with standard output. The two options do not combine: a piece has no cut inside it to mark, so `--cut-marker` does nothing with `--pieces`.

Both options need the printer to perform the cut, see the next section, and both see to that themselves.

<br>

### Commands the printer performs

Most of a stream draws on the paper. A few commands do something else: cut the paper, open the cash drawer, feed. The renderer keeps those out of the picture unless it is told the printer performs them, because that is what decides where the paper is cut and, after a reverse feed, where the paper still is. `--commands` lists them, comma separated, from `cut`, `pulse`, `feed` and `unknown`, and the default is none.

```
receipt-printer-renderer --commands cut,pulse receipt.bin -o receipt.png
```

For an image the one that matters is `cut`: a stream that pulls the paper back and prints over it prints on paper that is still there when the cut is not performed, and on the next piece when it is. `--pieces` and `--cut-marker` both add `cut` to the list whether or not `--commands` names it, since neither has anything to do without one, and the PNG and the SVG of one stream then agree about where the pieces are. `pulse`, `feed` and `unknown` change nothing in an image; they are here so that the command renders exactly what a driver with the same list renders.

<br>

### SVG options

Three options belong to the SVG format and are ignored by the others. `--units` is the unit of the width and the height of the document: `dots`, which is the default, `mm`, `pt` or `px`, worked out from the resolution of the printer, so a receipt of 576 dots at 203 dots per inch is 72.07 mm wide; everything inside the document stays in dots whatever this says, because the view box is the paper. `--background` is the colour of the paper, `#fff` by default, and `none` leaves it out for a transparent document. `--ink` is the colour everything is drawn in, `#000` by default. A colour is written into the document as it is given, so anything CSS accepts is fine.

```
receipt-printer-renderer receipt.bin -o receipt.svg --units mm
receipt-printer-renderer receipt.bin -o receipt.svg --background none --ink '#333'
```

An image in the stream is a PNG of the dots as they land on the paper, black on white, so it takes neither the ink colour nor a transparent background.

<br>

### Exit codes and errors

The exit code says what went wrong, so that a script can tell a mistake in the command from a stream the renderer could not handle.

| Code | Meaning |
|---|---|
| 0 | The image was written. |
| 1 | A usage error: an option the command does not know, a language, a format, a profile or a codepage mapping the package does not have, a width that is not a positive multiple of 8, `--pieces` without `--output`, or a file that cannot be read or written. |
| 2 | The renderer or the writer could not handle the stream. The command was called correctly, the commands in the file were the problem. |

Every error is one line on standard error, `receipt-printer-renderer: ` and the message, and a usage error ends in `, see --help`. The messages name the names: an unknown language lists the four, an unknown profile or codepage mapping lists the ones that language has, an unknown format or unit lists the ones there are.

```
$ receipt-printer-renderer -l escpos receipt.bin
receipt-printer-renderer: Unknown language escpos, must be one of esc-pos, star-prnt, star-line, star-graphics, see --help
```

A pipe that closes before the image is through, `| head` on a PNG, is not an error: the command ends quietly.

<br>

### All options

| Option | Default | Meaning |
|---|---|---|
| `-l, --language <name>` | `esc-pos` | The language the commands are in: `esc-pos`, `star-prnt`, `star-line` or `star-graphics`. |
| `-w, --width <dots>` | `576` | Width of the paper in dots, a positive multiple of 8. 576 is the 80 mm roll at 203 dpi. |
| `-c, --columns <n>` | | Width as a number of font A columns, 12 dots each: `-c 48` is 576 dots, `-c 32` is 384. Exclusive with `--width`. |
| `-m, --codepage-mapping <name>` | `epson` for ESC/POS, `star` for the Star languages | The mapping the commands were encoded with. |
| `-p, --profile <name>` | `epson` for ESC/POS, `star` for the Star languages | The printer family the defaults come from. |
| `-o, --output <path>` | standard output | Where the image goes. `-` is standard output. With `--pieces` the path is the pattern the names are made from. |
| `-f, --format <name>` | the extension of `--output`, `png` for standard output | `png`, `svg`, `pbm` or `json`, which is the display list. |
| `--pieces` | off | One image per piece of paper, the stream split at its cuts. Needs `--output`. |
| `--cut-marker` | off | A dashed line where the paper is cut, in one image of the whole roll. Nothing with `--pieces`. |
| `--commands <list>` | none | Comma separated `cut`, `pulse`, `feed` and `unknown`, the commands the printer performs. A cut is added when `--pieces` or `--cut-marker` needs one. |
| `--line-spacing <dots>` | the profile's | Default line spacing in dots. |
| `--units <name>` | `dots` | SVG only: `dots`, `mm`, `pt` or `px`, the units of the width and the height of the document. |
| `--background <colour>` | `#fff` | SVG only: the colour of the paper, `none` for a transparent one. |
| `--ink <colour>` | `#000` | SVG only: the colour of the ink. |
| `-h, --help` | | The usage, on standard output, exit 0. |
| `-v, --version` | | The version of the package, exit 0. |

<br>

### Recipes

Look at a stream someone sent you:

```
npx @point-of-sale/receipt-printer-renderer their-receipt.bin -o look.png
```

Turn the receipt of a 58 mm Star printer into an SVG for a web page, transparent, in millimetres:

```
receipt-printer-renderer -l star-prnt -c 32 receipt.bin -o receipt.svg --units mm --background none
```

Split a print job into the pieces the printer would cut, with the cut performed the way the driver does it:

```
receipt-printer-renderer --pieces job.bin -o job.png
```

Compare what two versions of an application send, as text:

```
receipt-printer-renderer old.bin -f json > old.json
receipt-printer-renderer new.bin -f json > new.json
diff old.json new.json
```

Render every capture in a folder:

```
for f in captures/*.bin; do receipt-printer-renderer "$f" -o "${f%.bin}.png"; done
```

Everything the command does is a few lines of the API: [Image format helpers](usage.md#image-format-helpers) for the PNG, the PBM and the stitched paper, [The display list](usage.md#the-display-list) for the JSON and the pieces, and [SVG output](usage.md#svg-output) for the SVG and its options.
