# ReceiptPrinterRenderer

<br>

Render the ESC/POS and StarPRNT commands created by [ReceiptPrinterEncoder](https://github.com/NielsLeenheer/ReceiptPrinterEncoder) to 1-bit images, for receipt printers that only support graphics.

- [About ReceiptPrinterRenderer](../README.md)
- [Usage and installation](usage.md)
- [ESC/POS commands](commands-esc-pos.md)
- [StarPRNT commands](commands-star-prnt.md)
  - [Statuses](#statuses)
  - [Text and control](#text-and-control)
  - [Styles and sizes](#styles-and-sizes)
  - [Line spacing and feeds](#line-spacing-and-feeds)
  - [Alignment and position](#alignment-and-position)
  - [Codepages and character sets](#codepages-and-character-sets)
  - [Barcodes](#barcodes)
  - [Barcode symbologies](#barcode-symbologies)
  - [QR codes](#qr-codes)
  - [PDF417](#pdf417)
  - [Images](#images)
  - [Cut and drawer](#cut-and-drawer)
  - [Printer state and status](#printer-state-and-status)
  - [Not supported yet](#not-supported-yet)
- [Design document](design.md)

<br>

## StarPRNT commands

This page lists every command `StarPrntRenderer` recognises, what it does to the paper, and the exact values it accepts. StarPRNT and Star Line Mode are the same set of commands, so this is the reference for both the `star-prnt` and the `star-line` language of the encoder.

The renderer emulates a Star printer. It interprets the bytes the way the firmware does, including the cases where the firmware prints nothing at all: a barcode with invalid data, a symbol wider than the paper, an argument outside the range of its command, which leaves the setting as it was rather than clipping it.

It deliberately differs from the hardware in a few places, each of them because the behaviour is not on the wire and no hardware check settled it. They are marked in the notes below, and these are all of them: the module widths of `ESC b`, the line spacing of an `ESC z n` that is not `0` or `1`, the feeds of `ESC I`, `ESC J` and `ESC a`, the four dot gap between the bars of a barcode and its human readable text, the reading of `ESC GS x S 0`, a QR model 1 drawn as a model 2 symbol, the basic 43 character set of Code 93, and the minimum of three data codewords of a PDF417 symbol.

Two differences are the printer itself rather than the renderer, and both show up when the same receipt is printed in both languages: a pulse to the second drawer is fixed at 200 ms on and 200 ms off, because the width is not on the wire, and the size multipliers of `ESC i` stop at six where `GS ! n` of ESC/POS goes to eight.

<br>

### Statuses

| Status | Meaning |
|---|---|
| **Rendered** | The command changes the output: dots on the paper, or a `cut`, `pulse` or `feed` item in the item stream. |
| **Parsed** | Recognised and consumed with the right length, but it changes nothing. The notes say why. |
| **Reported** | Consumed with the right length and reported as an `unknown` item that carries all of its bytes, the prefix included. Nothing on paper. |
| **Skipped** | Consumed silently. Nothing on paper, and no item either. |

A `cut`, `pulse`, `feed` or `unknown` item only reaches the output when the driver put that type in the `commands` option, see [Commands the printer supports](usage.md#commands-the-printer-supports). A **Reported** command with `unknown` switched off therefore leaves nothing at all, which is the same paper as **Skipped**.

A Star command is `ESC` and a command byte, or `ESC GS` or `ESC RS` and a command byte, so the parser has three tables. Every command in them knows how many argument bytes it has, so a command the renderer does not implement never derails the text behind it. A command that is in none of the tables consumes its prefix alone, two bytes or three, which is the best guess there is, and is reported. A command whose arguments run past the end of the stream stops the parser without an error, and everything before it is still rendered.

<br>

### Text and control

| Command | Name | Status | Notes |
|---|---|---|---|
| `0x20`..`0xFF` | printable byte | Rendered | Decoded with the current codepage, one cell per character in the current style. A byte the codepage does not map becomes U+FFFD, which the font draws as its fallback box. A character that no longer fits on the line wraps to the next one, as a printer wraps; a cell wider than the whole line is drawn and clipped, so nothing is dropped silently. |
| `LF` | line feed | Rendered | Commits the line that is being composed and advances the paper. |
| `CR` | carriage return | Skipped | Does not move the paper. The encoder ends every line with `LF CR`. |
| `CAN` | cancel | Rendered | Throws away the print data of the line that is being composed, without advancing the paper. The encoder sends it right behind `ESC @`, where the line buffer is already empty. |
| `ESC @` | initialize | Rendered | Resets style, font, alignment, line spacing, codepage and the stored QR code and PDF417 parameters, and discards a half composed line. The pulse width of `ESC BEL` survives it, as it does on a Star printer. Rows that were already committed stay on the paper, the command does not flush. |
| `ESC GS P n` | print mode | Parsed | `ESC GS P 0` and `ESC GS P 1` switch the printer between page and line units, which changes when the printer prints and not what it prints. The encoder's flush emits both around a job. |
| `ESC FF n` | print the buffer in mode n | Reported | The mode byte, which is `NUL`, `EOT`, `EM` or `LF`, is consumed with the command, so that it is not executed as a command of its own: `EM` would open a drawer and `LF` would feed a line. |
| other bytes below `0x20` | — | Skipped | Everything that is not `LF`, `CR`, `CAN`, `BEL`, `FS`, `SUB`, `EM` or `ESC` is ignored, the way a printer ignores it. `HT` falls in here. |

<br>

### Styles and sizes

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC E` | bold on | Rendered | Drawn as overstrike, the glyph twice with a one dot horizontal offset, which is what the print head does. |
| `ESC F` | bold off | Rendered | |
| `ESC - n` | underline | Rendered | `0` off, `1` on, and the ASCII digits `48` and `49` for the same two. The Star underline is one dot thick, there is no second thickness. Any other value leaves the underline as it was. |
| `ESC 4` | invert on | Rendered | The cell is drawn white on black; the space the line spacing leaves below the line stays white. |
| `ESC 5` | invert off | Rendered | |
| `ESC i h w` | character size | Rendered | The height multiplier first and the width multiplier second, both the value plus one, so `0` to `5` and the ASCII digits `48` to `53` give a multiplier of 1 to 6. A value outside that range leaves the size as it was, as a Star printer does, rather than clipping to six: the multipliers of seven and eight that `GS ! n` of ESC/POS carries have no value in this command. Glyphs are scaled by repeating dots. |
| `ESC RS F n` | font | Rendered | `0` or `48` font A, 12 by 24 dots, `1` or `49` font B, 9 by 24 dots in the Star profile and 9 by 17 in the Epson profile. Font C, `2`, has no glyphs here and leaves the font as it was. |
| `ESC W n` | character expansion, double width | Reported | [Section 12](#not-supported-yet). |
| `ESC h n` | character height | Reported | [Section 12](#not-supported-yet). |
| `ESC ( n` | select character expansion | Reported | |
| `ESC ) n` | cancel character expansion | Reported | |
| `ESC RS C n` | character style | Reported | |
| `ESC RS E n` | character expansion | Reported | |

The encoder emits nothing for italic in this language, so there is no italic command to ignore.

<br>

### Line spacing and feeds

The height of a committed line is the larger of the tallest cell on it and the current line spacing, so a line of double height text is 48 dots and not 64, which is how the firmware behaves as well. The cells sit at the top of the line box and the gap falls below them: with the Star default of 32 dots and a 24 dot cell that is eight dots at every line boundary. An empty line is the line spacing alone. Blocks, which is what barcodes, QR codes, PDF417 symbols and raster images are, advance by their own height and get no line spacing added.

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC 0` | line spacing, 3 mm | Rendered | 24 dots, at the eight dots per millimetre of a 203 dpi printer. The encoder writes it in front of a column mode image so that the 24 dot strips join up. |
| `ESC z n` | line spacing | Rendered | `1` is the four millimetre default of a Star printer, so it restores the default line spacing: 32 dots for the Star profile, 30 for the Epson profile, or the `lineSpacing` option when the driver gave one. It is not pinned to 32, because the encoder writes `ESC 0` before an image and `ESC z 1` behind it, and a printer with another line spacing has to come back to its own. `0` is the three millimetres of `ESC 0`. Those two are the only values the encoder emits; any other `n` is read as `n` millimetres, eight dots each, which is an approximation. |
| `ESC a n` | print and feed n lines | Rendered | Commits the line and advances by at least `n` line spacings. A line taller than that still advances by its own height, so nothing overlaps. An approximation: the encoder never emits it. |
| `ESC I n` | print and feed n eighths of a millimetre | Rendered | One dot each. The same approximation. |
| `ESC J n` | print and feed n quarters of a millimetre | Rendered | Two dots each. The same approximation. |
| `ESC 1` | line spacing, 1/8 inch | Reported | The legacy command. |

Runs of blank rows of at least `feedThreshold` dots become `feed` items and split the image around them, but only when `feed` is in `commands`; otherwise they stay in the image as white rows. The eight blank dots below a line of text belong to the run that follows them, so a feed item usually starts a few rows above the empty line that caused it.

<br>

### Alignment and position

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC GS a n` | alignment | Rendered | `0` or `48` left, `1` or `49` centre, `2` or `50` right. Applied when the line is committed, over the free width of the line, and to blocks when they are drawn. Any other value leaves the alignment as it was. |
| `ESC D n1..nk NUL` | horizontal tab positions | Reported | Consumed up to the `NUL`. [Section 12](#not-supported-yet). |
| `ESC l n` | left margin | Reported | [Section 12](#not-supported-yet). |
| `ESC Q n` | right margin | Reported | [Section 12](#not-supported-yet). |
| `ESC RS A n` | print area | Reported | |
| `ESC GS \ n1 n2` | vertical position | Reported | |

<br>

### Codepages and character sets

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC GS t n` | select codepage | Rendered | `n` is looked up in the `codepageMapping` the renderer was built with, which has to be the mapping the encoder used. The printer starts in entry `0` of that mapping, the Star specific standard character set, and `ESC @` returns to it; an unknown number lands there as well, and so does a codepage the codepage encoder does not implement. |
| `ESC R n` | international character set | Reported | [Section 12](#not-supported-yet). |
| `ESC c n` | select character set | Reported | |

<br>

### Barcodes

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC b n1 n2 n3 n4 d.. RS` | barcode | Rendered | `n1` is the symbology, see the table below. `n2` is `2` or `50` for the human readable text below the bars, which a Star printer draws in font A, and anything else for a barcode without text. `n3` is the module width, `1`, `2` and `3` for 2, 3 and 4 dots, and any other value is read as `1`. `n4` is the height of the bars in dots, with `0` read as one dot. The data runs to the record separator and is read as ASCII; data that holds a `0x1e` byte itself therefore ends the command early, which is inherent to the framing of the command, and the encoder never sends one. |

**The three module widths are an assumption.** The Star documentation describes them in narrow and wide element widths per symbology rather than in dots; 2, 3 and 4 dots is the reading that makes a Star barcode the same size as the ESC/POS barcode the encoder produces from the same receipt, where the same width option is written as `GS w n` plus one. No hardware check settled it.

The bars are drawn as a block of their own: the pending line is committed first, the block is aligned the way `ESC GS a` says, and the paper advances by the height of the block. Barcodes carry no quiet zone, a printer does not print one either.

Data that is not valid for the symbology prints nothing at all and does not advance the paper, which is what printer firmware does. The same goes for a barcode whose bars are wider than the print area: the printer prints nothing rather than a barcode no reader can read. The human readable text is not part of that rule, it is centred under the bars and clipped when it is wider than the paper.

The human readable text is one line of cells in font A, drawn without any style, so it is never affected by the bold, underline, invert or size of the text around it. Between the bars and the text sits a gap of four dots, because the cell of the font has no room of its own above a capital and the text would otherwise touch the bars. **That gap is a legibility choice of this renderer, not a number from a specification, and it has not been compared with what a Star printer puts on paper.**

<br>

### Barcode symbologies

`n1` of `ESC b`, and what the renderer draws for it. The numbers are Star's own, they are not the ones of `GS k` in ESC/POS, but they map onto the same generators.

| Value | Symbology | Status | Notes |
|---|---|---|---|
| `0` | UPC-E | Rendered | Six digits, seven with the number system in front of them, eight with the check digit behind them as well, or the eleven or twelve digits of the UPC-A the symbol stands for, which is compressed when it has a zero suppressed form and refused when it has none. Only the number systems `0` and `1` have such a form. |
| `1` | UPC-A | Rendered | Eleven or twelve digits. The check digit is computed when it is missing and validated when it is there, and a wrong one prints nothing. Drawn as the EAN-13 it is, with the leading zero left out of the text. |
| `2` | EAN-8 | Rendered | Seven or eight digits, the check digit computed or validated. |
| `3` | EAN-13 | Rendered | Twelve or thirteen digits, the check digit computed or validated. |
| `4` | Code 39 | Rendered | No check digit, as the firmware computes none. The start and stop character are added by the renderer, so a `*` in the data prints nothing. Lower case is printed as upper case, a character outside the set prints nothing. A wide element is three modules. |
| `5` | ITF | Rendered | An even number of digits. An odd number prints nothing rather than being padded, because padding would change the number. A wide element is three modules. |
| `6` | Code 128 | Rendered | StarPRNT has no way to select a code set, and the encoder strips the `{A`, `{B` and `{C` selection it passes through on ESC/POS, so the renderer picks the code sets the way a printer does: code set C for a run of four digits or more and for a value that starts with two, code set A only when the value needs the control characters, and never the shift. This is exactly what symbology `79` of ESC/POS does. A byte above 127 fits in no code set and prints nothing. |
| `7` | Code 93 | Rendered | Two check characters are computed and drawn. Only the basic 43 character set is encoded, the full ASCII variant is not implemented, as printer firmware does not implement it either; a character outside the set prints nothing. |
| `8` | Codabar | Rendered | The start and stop characters are `A` to `D`. Data without them gets an `A` on both sides, data with only one of the two, or with one of those letters in the middle, prints nothing. They are part of the human readable text, as the firmware prints them. A wide element is two modules. |
| `9` | GS1-128 | Rendered | A Code 128 with FNC1 behind the start symbol and the code sets picked for the data. The encoder strips `(`, `)` and `*` from the value before it sends it. |
| `10` to `13` | GS1 DataBar Omnidirectional, Truncated, Limited, Expanded | Reported | Not rendered in this version. The whole `ESC b` command is reported, since these symbologies print in one command. [Section 14](#not-supported-yet). |
| any other | — | Reported | |

<br>

### QR codes

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC GS y S 0 n` | model | Parsed | `1` is model 1, everything else model 2. The value is stored but never used: both models are drawn as a model 2 symbol, which is a deviation from the hardware. |
| `ESC GS y S 1 n` | error correction | Rendered | `0` L, `1` M, `2` Q, `3` H. Any other value leaves it as it was. The printer starts at L. |
| `ESC GS y S 2 n` | module size | Rendered | `n` dots per module, clamped to 1 to 8, which is the range the encoder accepts. The printer starts at 3. |
| `ESC GS y D 1 m nL nH d..` | store data | Rendered | `nL + nH * 256` bytes, stored and encoded in the byte mode of the specification, so any byte survives whatever codepage the reader assumes. The storage survives until the next store, so two print commands print the same symbol twice. `ESC @` empties it. |
| `ESC GS y P` | print | Rendered | Draws the symbol as a block, aligned the way `ESC GS a` says, one dot per module scaled by the module size and without a quiet zone, as a printer prints it. The version is the smallest one the data fits in at the error correction level that was asked for. Nothing is printed, and the paper does not advance, when the storage is empty, when the data does not fit in the largest symbol of that level, or when the symbol would be wider than the print area. |
| `ESC GS y S n ..` | any other parameter | Skipped | An `S` command is always three bytes, so a sub-function other than `0`, `1` and `2` is consumed and changes nothing. |
| `ESC GS y ..` | any other function | Skipped | A function byte that is not `S`, `D` or `P` is consumed as one argument byte, and nothing happens. |

<br>

### PDF417

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC GS x S 0 n n1 n2` | size | Rendered | `n` of `0` leaves both the rows and the columns to the renderer, `1` takes the `n1` rows and the `n2` columns that follow, where a zero is automatic for that one alone. The rows are 3 to 90 and the columns 1 to 30, and a number outside its range leaves that one as it was. Any other `n` leaves the size as it was. The encoder always sends `1`. **This reading is not settled by hardware, it is the one that makes a Star receipt print the symbol the ESC/POS receipt prints.** |
| `ESC GS x S 1 n` | error correction | Rendered | Level `0` to `8`. A higher value leaves it as it was. The printer starts at level 0. |
| `ESC GS x S 2 n` | module width | Rendered | 2 to 8 dots. The printer starts at 2. |
| `ESC GS x S 3 n` | row height | Rendered | The height of a row as a multiple of the module width, 2 to 8, so a row is `n` times the module width in dots. The printer starts at 2. |
| `ESC GS x D nL nH d..` | store data | Rendered | `nL + nH * 256` bytes. There is no function byte between the `D` and the length, unlike the QR code command. Stored until the next store. |
| `ESC GS x P` | print | Rendered | Draws the symbol as a block, aligned, without a quiet zone. Nothing is printed when the storage is empty, when the data does not fit the number of columns and rows that were asked for, when it is more than 925 codewords, or when the symbol would be wider than the print area. |
| `ESC GS x S n ..` | any other parameter | Skipped | An `S 0` command is five bytes and every other `S` command three, so a sub-function other than `0` to `3` is consumed and changes nothing. |
| `ESC GS x ..` | any other function | Skipped | A function byte that is not `S`, `D` or `P` is consumed as one argument byte, and nothing happens. |

The StarPRNT command set has no command for the form of the symbol, so a Star printer always prints the standard symbol and never the truncated one that ESC/POS can ask for.

A symbol never holds fewer than three data codewords: one codeword of data and the length descriptor fill the data area exactly, with no room for the padding codeword the examples of the specification always leave, and readers refuse the result. **That minimum is a decision of this renderer, it is not a rule of the specification.** With no columns or rows given, the automatic size is the number of columns whose symbol comes closest to three times as wide as it is tall, which is what makes a small symbol on a receipt scannable.

<br>

### Images

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC X nL nH d..` | column mode image, 24 dots | Rendered | `nL + nH * 256` columns, three bytes per column, the most significant bit of the first byte at the top. The strip goes into the line that is being composed, like one wide cell, and the `LF CR` behind it commits the line; the encoder writes `ESC 0` in front of an image so that the 24 dot strips join up. This is the only image command the encoder emits. |
| `ESC L nL nH d..` | bit image, fine density | Rendered | A strip of eight rows, one byte per column, with the number of data bytes in the two length bytes. One dot per column. |
| `ESC K nL nH d..` | bit image, normal density | Rendered | The same, but every column is printed twice, so the image keeps its proportions at half the resolution. |
| `ESC k nL nH d..` | bit image, quadruple density | Reported | Consumed with its length. Its horizontal scale has no obvious reading, so it draws nothing. [Section 13](#not-supported-yet). |
| `ESC * r ..` | raster mode group | Reported | The raster commands of the TSP100 family, `ESC * r R`, `A`, `B`, `C`, `a` and `b`, the margins `ESC * r m l n NUL` and `ESC * r m r n NUL`, and the commands that carry their parameter as ASCII digits up to a `NUL`. Each is consumed with its own length. An `ESC *` that is not followed by an `r` is consumed as one argument byte. [Section 12](#not-supported-yet). |

<br>

### Cut and drawer

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC d n` | cut | Rendered | `1` and `3`, and the ASCII digits `49` and `51`, are a partial cut, every other value a full one. The variants that feed the paper to the cutter first cut the same way, the feed is already on the paper. Emits a `cut` item, and the lines that are finished become an image item in front of it. |
| `ESC BEL n1 n2` | pulse width | Rendered | The width of the pulse that `BEL` and `FS` send to the first drawer, in units of ten milliseconds. The setting survives `ESC @`, as it does on a Star printer, and it is reset to 200 ms on and 200 ms off at the start of every stream. |
| `BEL`, `FS` | open the first drawer | Rendered | Emits a `pulse` item for device `0`, with the width `ESC BEL` set, or 200 ms on and 200 ms off when it was never sent. |
| `SUB`, `EM` | open the second drawer | Rendered | Emits a `pulse` item for device `1`, always 200 ms on and 200 ms off, which the specification fixes: the width of the second drawer is not on the wire. A receipt that asks for other times therefore does not survive the round trip through this language, which is the printer and not the renderer. |

A half composed line stays in the painter and continues behind the command, which is what a printer does when it fires the drawer before the pending line prints. The encoder always finishes the line first, so in practice the line is empty.

<br>

### Printer state and status

These commands change nothing about the paper of the receipt that is being rendered. They are consumed with the lengths of the Star Line Mode and Star Graphic Mode specifications and reported, so that a driver can see them and the stream stays in sync.

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC GS ETX s n1 n2` | automatic status | Reported | The renderer never answers a status request, it has no channel back to the host. |
| `ESC GS # n` | print density | Reported | |
| `ESC GS b n` | blackmark and sensor settings | Reported | |
| `ESC GS c n` | colour | Reported | |
| `ESC RS a n` | print start control | Reported | |
| `ESC RS d n` | print density | Reported | |
| `ESC RS r n` | print speed | Reported | |

<br>

### Not supported yet

These are the common StarPRNT and Star Line Mode commands the renderer parses but does not render, and what is planned for them. The sections are the ones of the [implementation plan](implementation-plan.md).

**Section 12, text layout.**

- `ESC W n` double width and `ESC h n` double height, setting the same size state that `ESC i` sets.
- `ESC _ n` upperline, drawn along the top rows of the cell the way the underline is drawn along the bottom.
- `ESC l n` left margin and `ESC Q n` right margin, in characters of the current font.
- `ESC R n` international character set, with Star's own table.
- The raster mode as a renderable input: `ESC * r A` and `ESC * r R` to reset the raster state, `b` and `k` for a row with and without a feed, `ESC * r Y n NUL` to feed rows, `ESC * r E` and `F` to store the modes, `ESC FF NUL` and `ESC FF EOT` to flush and emit a cut item where the stored mode cuts, `ESC * r D n NUL` for a pulse item, and `ESC * r B` to leave raster mode. With this the renderer reproduces what a TSP100 prints from the USB driver's wrapper.
- The buzzer commands `ESC GS BEL`, `ESC GS EM DC1` and `ESC GS EM DC2`, to be consumed with their lengths and reported.

**Section 13, images.**

- `ESC GS S 1 n1 n2 n3 n4 NUL d..`, the StarPRNT raster image command the Star SDKs use, rendered as a block.
- `ESC k n1 n2 d..`, the quadruple density bit image, and any other bit image density the specification defines.
- `ESC FS p n m`, which prints an NV logo the printer holds and the renderer has never seen: an `unknown` item and nothing on paper.

**Section 14, GS1 DataBar.** The symbologies `10` to `13` of `ESC b`, Omnidirectional, Truncated, Limited and Expanded, with the human readable text below them.

**Not planned.**

- Page mode. `ESC GS P` switches the printer between page and line units and is parsed; composing a page in memory is a second layout engine next to the line one and is not modelled.
- CJK fonts. A receipt that needs real CJK text needs a printer with the font.
- User defined characters: glyphs downloaded into the printer.
- NV logos: images stored in the printer, which the renderer cannot draw. `ESC FS p` will report an `unknown` item and print nothing.
- Status and settings commands, `ESC GS ETX`, `ESC GS #`, `ESC GS b`, `ESC GS c`, `ESC RS a`, `ESC RS d`, `ESC RS r` and the rest of [Printer state and status](#printer-state-and-status): there is no channel back to the host, and the settings do not change the paper.
- Maxicode and the composite symbologies, which this command set has no selector for in anything the renderer parses.
