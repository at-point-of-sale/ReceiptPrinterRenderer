# ReceiptPrinterRenderer

<br>

Render the ESC/POS and StarPRNT commands created by [ReceiptPrinterEncoder](https://github.com/NielsLeenheer/ReceiptPrinterEncoder) to 1-bit images, for receipt printers that only support graphics.

- [About ReceiptPrinterRenderer](../README.md)
- [Usage and installation](usage.md)
- [ESC/POS commands](commands-esc-pos.md)
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
- [StarPRNT commands](commands-star-prnt.md)
- [Design document](design.md)

<br>

## ESC/POS commands

This page lists every ESC/POS command `EscPosRenderer` recognises, what it does to the paper, and the exact values it accepts. It is a reference for the compatibility of the renderer: what a stream from ReceiptPrinterEncoder relies on, and what a stream from other software can expect.

The renderer emulates an Epson ESC/POS printer. It interprets the bytes the way the firmware does, including the cases where the firmware prints nothing at all: a barcode with invalid data, a symbol wider than the paper, an argument outside the range of its command. It does not improve on the printer, so `ESC 4` italic is ignored exactly as an Epson ignores it.

It deliberately differs from the hardware in a few places, each of them because the behaviour is not on the wire and no hardware check settled it. They are marked in the notes below, and these are all of them: the four dot gap between the bars of a barcode and its human readable text, the approximations of `ESC J` and `ESC d`, the vertical motion unit of `GS P`, a QR model 1 drawn as a model 2 symbol, the basic 43 character set of Code 93, and the minimum of three data codewords of a PDF417 symbol.

<br>

### Statuses

| Status | Meaning |
|---|---|
| **Rendered** | The command changes the output: dots on the paper, or a `cut`, `pulse` or `feed` item in the item stream. |
| **Parsed** | Recognised and consumed with the right length, but it changes nothing. The notes say why. |
| **Reported** | Consumed with the right length and reported as an `unknown` item that carries all of its bytes, the prefix included. Nothing on paper. |
| **Skipped** | Consumed silently. Nothing on paper, and no item either. |

A `cut`, `pulse`, `feed` or `unknown` item only reaches the output when the driver put that type in the `commands` option, see [Commands the printer supports](usage.md#commands-the-printer-supports). A **Reported** command with `unknown` switched off therefore leaves nothing at all, which is the same paper as **Skipped**.

Every command in the tables below knows how many argument bytes it has, so a command the renderer does not implement never derails the text behind it. A command that is in neither table consumes its two prefix bytes alone, which is the best guess there is, and is reported. A command whose arguments run past the end of the stream stops the parser without an error, and everything before it is still rendered.

<br>

### Text and control

| Command | Name | Status | Notes |
|---|---|---|---|
| `0x20`..`0xFF` | printable byte | Rendered | Decoded with the current codepage, one cell per character in the current style. A byte the codepage does not map becomes U+FFFD, which the font draws as its fallback box. A character that no longer fits on the line wraps to the next one, as a printer wraps; a cell wider than the whole line is drawn and clipped, so nothing is dropped silently. |
| `LF` | line feed | Rendered | Commits the line that is being composed and advances the paper. |
| `CR` | carriage return | Skipped | Does not move the paper. The encoder ends every line with `LF CR`. |
| `ESC @` | initialize | Rendered | Resets style, font, alignment, line spacing, motion units, codepage and the stored barcode, QR code and PDF417 parameters. It also discards a half composed line, because the command initializes the line buffer along with the printer. Rows that were already committed stay on the paper, the command does not flush. |
| `FS .` | cancel Kanji mode | Parsed | No effect on rendering, there is no Kanji mode to leave. The encoder sends it right behind `ESC @`. |
| other bytes below `0x20` | — | Skipped | Everything that is not `LF`, `CR`, `ESC`, `GS` or `FS` is ignored, the way a printer ignores it. `HT` and the `DLE` real time commands fall in here: their bytes are read one by one and ignored, and an argument byte of `0x20` or above would print as a character. |

<br>

### Styles and sizes

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC E n` | bold | Rendered | Bit 0 of `n`, so every odd value switches it on. Drawn as overstrike, the glyph twice with a one dot horizontal offset, which is what the print head does. |
| `ESC - n` | underline | Rendered | `0` off, `1` one dot thick, `2` two dots thick, along the bottom of the cell and across the spaces between characters. The ASCII digits `48`, `49` and `50` are accepted for the same three. Any other value leaves the underline as it was, instead of throwing. |
| `ESC 4 n` | italic | Parsed | Ignored, as Epson hardware ignores it. The encoder emits it for `italic()`, so a receipt that asks for italic prints upright, on paper and here. |
| `GS B n` | invert | Rendered | Bit 0 of `n`. The cell is drawn white on black; the gap the line spacing leaves below the line stays white. |
| `GS ! n` | character size | Rendered | Width multiplier in the high nibble plus one, height multiplier in the low nibble plus one, both 1 to 8. Bits 3 and 7 are masked off, so there is no value this command refuses. Glyphs are scaled by repeating dots, as a printer scales them. |
| `ESC M n` | font | Rendered | `0` or `48` font A, 12 by 24 dots, `1` or `49` font B, 9 by 17 dots in the Epson profile and 9 by 24 in the Star profile. Font C, `2` or `50`, has no glyphs here and leaves the font as it was. |
| `ESC ! n` | print mode | Reported | Font, bold, double height, double width and underline in one byte. [Section 12](#not-supported-yet). |
| `ESC G n` | double strike | Reported | [Section 12](#not-supported-yet). |
| `ESC { n` | upside down printing | Reported | [Section 12](#not-supported-yet). |
| `ESC V n` | rotate 90 degrees | Reported | |
| `ESC r n` | print colour | Reported | The second colour of a two colour paper roll. |

<br>

### Line spacing and feeds

The height of a committed line is the larger of the tallest cell on it and the current line spacing, so a line of double height text is 48 dots and not 60, which is how the firmware behaves as well. The cells sit at the top of the line box and the gap falls below them: with the Epson default of 30 dots and a 24 dot cell that is six dots at every line boundary. An empty line is the line spacing alone. Blocks, which is what barcodes, QR codes, PDF417 symbols and raster images are, advance by their own height and get no line spacing added.

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC 2` | default line spacing | Rendered | Back to the default: 30 dots for the Epson profile, 32 for the Star profile, or the `lineSpacing` option when the driver gave one. |
| `ESC 3 n` | line spacing | Rendered | `n` vertical motion units, rounded to `n / units` dots. With the Epson default of two units per dot `ESC 3 24` is twelve dots; behind the `GS P dpi dpi` the encoder writes in front of a column mode image it is 24 dots. |
| `ESC J n` | print and feed n units | Rendered | Commits the line and advances by `n / units` dot rows, rounded. A line taller than that still advances by its own height, so nothing overlaps. An approximation: the encoder never emits this command and no hardware check settled it. |
| `ESC d n` | print and feed n lines | Rendered | Commits the line and advances by at least `n` line spacings, under the same rule, so `ESC d 1` is exactly `LF` and `ESC d 0` commits the line without a gap below it. The same approximation as `ESC J`. |
| `ESC K n` | print and reverse feed n dots | Reported | Reverse feeds are not modelled, the paper only moves forward here. |
| `ESC e n` | print and reverse feed n lines | Reported | |
| `ESC C n` | page length in lines | Reported | |

Runs of blank rows of at least `feedThreshold` dots become `feed` items and split the image around them, but only when `feed` is in `commands`; otherwise they stay in the image as white rows. The six blank dots below a line of text belong to the run that follows them, so a feed item usually starts a few rows above the empty line that caused it.

<br>

### Alignment and position

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC a n` | alignment | Rendered | `0` or `48` left, `1` or `49` centre, `2` or `50` right. Applied when the line is committed, over the free width of the line, and to blocks when they are drawn. Any other value leaves the alignment as it was. |
| `GS P x y` | motion units | Rendered | Only the vertical unit is tracked, it is what `ESC 3` and `ESC J` are counted in. `GS P 0 0` returns to the profile default, two units per dot on Epson and one on Star. Any other `y` is read as one unit per dot, because the renderer does not know the resolution of the printer it emulates, and setting the unit to that resolution is the only thing the encoder ever does with this command. |
| `ESC SP n` | right side character spacing | Reported | [Section 12](#not-supported-yet). |
| `ESC $ nL nH` | absolute print position | Reported | [Section 12](#not-supported-yet). |
| `ESC \ nL nH` | relative print position | Reported | [Section 12](#not-supported-yet). |
| `ESC D n1..nk NUL` | horizontal tab positions | Reported | Consumed up to the `NUL`. [Section 12](#not-supported-yet). |
| `GS L nL nH` | left margin | Reported | [Section 12](#not-supported-yet). |
| `GS W nL nH` | print area width | Reported | [Section 12](#not-supported-yet). |
| `GS T n` | print position at the top of the line | Reported | |
| `GS A m n` | print position adjustment | Reported | |
| `ESC L` | select page mode | Reported | Page mode is not modelled, see [Not supported yet](#not-supported-yet). |
| `ESC S` | select standard mode | Reported | |
| `ESC T n` | print direction in page mode | Reported | |
| `ESC W n1..n8` | print area in page mode | Reported | |
| `GS $ nL nH` | absolute vertical position in page mode | Reported | |
| `GS \ nL nH` | relative vertical position in page mode | Reported | |

<br>

### Codepages and character sets

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC t n` | select codepage | Rendered | `n` is looked up in the `codepageMapping` the renderer was built with, which has to be the mapping the encoder used. An unknown number falls back to cp437, and so does a codepage the codepage encoder does not implement, `cp885` of the Bixolon mapping for one: a printer without that codepage prints the bytes with the one it has, and a receipt is never lost over one character. The printer starts in cp437 and `ESC @` returns to it. |
| `ESC R n` | international character set | Reported | Replaces twelve code points per set. [Section 12](#not-supported-yet). |
| `ESC % n` | select user defined character set | Reported | |
| `ESC ? n` | cancel user defined character | Reported | |
| `FS &` | select Kanji mode | Reported | The whole `FS` Kanji group is consumed with the lengths of the specification and reported. [Section 12](#not-supported-yet). |
| `FS C n` | Kanji code system | Reported | |
| `FS ! n` | multi byte print mode | Reported | |
| `FS - n` | multi byte underline | Reported | |
| `FS S n1 n2` | Kanji character spacing | Reported | |
| `FS W n` | quadruple size Kanji | Reported | |
| `FS 2 c1 c2 d1..dk` | define user defined Kanji | Reported | The number of data bytes depends on the Kanji font of the printer, which the stream does not say, so the table assumes the 32 bytes of the 16 by 16 font. The encoder never sends this command. |
| `FS ? c1 c2` | cancel user defined Kanji | Reported | |

`FS .`, the command that leaves Kanji mode, is the one command of this group that is parsed rather than reported, see [Text and control](#text-and-control).

<br>

### Barcodes

| Command | Name | Status | Notes |
|---|---|---|---|
| `GS h n` | barcode height | Rendered | The height of the bars in dots, for the barcodes that follow. `0` is refused and leaves the height as it was. The printer starts at 162 dots. |
| `GS w n` | barcode module width | Rendered | The width of the narrowest bar in dots, 1 to 6. The specification defines 2 to 6, but the encoder sends 1 for GS1-128 and the GS1 DataBar family, so 1 is accepted. Any other value leaves it as it was. The printer starts at 3 dots. |
| `GS H n` | HRI position | Rendered | `0` none, `1` above, `2` below, `3` both, and `48` to `51` for the same four. Any other value leaves it as it was. The printer starts at none and the encoder sends `0` or `2`. |
| `GS f n` | HRI font | Rendered | `0` or `48` font A, `1` or `49` font B. The default is font A, which is what the reference of this command says; the encoder never sends it, so the text of a barcode from the encoder is always font A. |
| `GS k m d1..dk NUL` | barcode, function A | Rendered | For `m` below 65. The data runs to the first `NUL` byte and is read as ASCII. |
| `GS k m n d1..dn` | barcode, function B | Rendered | For `m` of 65 and up, with the length in front of the data. The symbologies of both functions render identically. |

The bars are drawn as a block of their own: the pending line is committed first, the block is aligned the way `ESC a` says, and the paper advances by the height of the block. Barcodes carry no quiet zone, a printer does not print one either.

Data that is not valid for the symbology prints nothing at all and does not advance the paper, which is what printer firmware does. The same goes for a barcode whose bars are wider than the print area: an Epson prints nothing rather than a barcode no reader can read. The human readable text is not part of that rule, it is centred under the bars and clipped when it is wider than the paper.

The human readable text is one line of cells in the HRI font, drawn without any style, so it is never affected by the bold, underline, invert or size of the text around it. Between the bars and the text sits a gap of four dots, because the cell of the font has no room of its own above a capital and the text would otherwise touch the bars. **That gap is a legibility choice of this renderer, not a number from a specification, and it has not been compared with what an Epson puts on paper.**

<br>

### Barcode symbologies

`m` of `GS k`, and what the renderer draws for it. The values 65 to 71 are function B and select the same symbologies as 0 to 6.

| Value | Symbology | Status | Notes |
|---|---|---|---|
| `0`, `65` | UPC-A | Rendered | Eleven or twelve digits. The check digit is computed when it is missing and validated when it is there, and a wrong one prints nothing. Drawn as the EAN-13 it is, with the leading zero left out of the text. |
| `1`, `66` | UPC-E | Rendered | Six digits, seven with the number system in front of them, eight with the check digit behind them as well, or the eleven or twelve digits of the UPC-A the symbol stands for, which is compressed when it has a zero suppressed form and refused when it has none. Only the number systems `0` and `1` have such a form. |
| `2`, `67` | EAN-13 | Rendered | Twelve or thirteen digits, the check digit computed or validated. |
| `3`, `68` | EAN-8 | Rendered | Seven or eight digits, the check digit computed or validated. |
| `4`, `69` | Code 39 | Rendered | No check digit, as the firmware computes none. The start and stop character are added by the renderer, so a `*` in the data prints nothing. Lower case is printed as upper case, a character outside the set prints nothing. A wide element is three modules. |
| `5`, `70` | ITF | Rendered | An even number of digits. An odd number prints nothing rather than being padded, because padding would change the number. A wide element is three modules. |
| `6`, `71` | Codabar | Rendered | The start and stop characters are `A` to `D`. Data without them gets an `A` on both sides, data with only one of the two, or with one of those letters in the middle, prints nothing. They are part of the human readable text, as the firmware prints them. A wide element is two modules. |
| `72` | Code 93 | Rendered | Two check characters are computed and drawn. Only the basic 43 character set is encoded, the full ASCII variant is not implemented, as printer firmware does not implement it either; a character outside the set prints nothing. |
| `73` | Code 128 | Rendered | The data carries the code set selection: `{A`, `{B` and `{C` select a set, `{1` to `{4` are the function characters, `{S` is the shift and `{{` is a brace. Data that does not start with a code set, or that holds an escape the table does not have, prints nothing. The encoder puts `{B` in front of a value that does not start with a brace. Inside `{C` a character that is not a digit, or a digit without a partner, switches to code set B. A byte above 127 fits in no code set and prints nothing. The text under the bars is the data without the escapes. |
| `74` | GS1-128 | Rendered | A Code 128 with FNC1 behind the start symbol and the code sets picked for the data. The encoder strips `(`, `)` and `*` from the value before it sends it. |
| `75` to `78` | GS1 DataBar Omnidirectional, Truncated, Limited, Expanded | Reported | Not rendered in this version. The whole `GS k` command is reported, since these symbologies print in one command. [Section 14](#not-supported-yet). |
| `79` | Code 128 auto | Rendered | The renderer picks the code sets, the way a printer does when the data does not say: code set C for a run of four digits or more and for a value that starts with two, code set A only when the value needs the control characters, and never the shift. |
| any other | — | Reported | Including the values the specification leaves open. |

<br>

### QR codes

| Command | Name | Status | Notes |
|---|---|---|---|
| `GS ( k pL pH 49 65 n1 n2` | model | Parsed | `49` is model 1, `50` and everything else model 2. The value is stored but never used: both models are drawn as a model 2 symbol, which is a deviation from the hardware. |
| `GS ( k pL pH 49 67 n` | module size | Rendered | `n` dots per module, clamped to 1 to 16. The encoder sends 1 to 8. The printer starts at 3. |
| `GS ( k pL pH 49 69 n` | error correction | Rendered | `48` L, `49` M, `50` Q, `51` H. Any other value leaves it as it was. The printer starts at L. |
| `GS ( k pL pH 49 80 48 d..` | store data | Rendered | The bytes are stored and encoded in the byte mode of the specification, so any byte survives whatever codepage the reader assumes. The storage survives until the next store, so two print commands print the same symbol twice. `ESC @` empties it. |
| `GS ( k pL pH 49 81 48` | print | Rendered | Draws the symbol as a block, aligned the way `ESC a` says, one dot per module scaled by the module size and without a quiet zone, as a printer prints it. The version is the smallest one the data fits in at the error correction level that was asked for. Nothing is printed, and the paper does not advance, when the storage is empty, when the data does not fit in the largest symbol of that level, or when the symbol would be wider than the print area. |
| `GS ( k pL pH 49 ..` | any other function | Skipped | Consumed with the length of the group, and nothing happens. |
| `GS ( k pL pH ..` | any other selector | Reported | Maxicode, the two dimensional GS1 DataBar and the composite symbologies, and a group that is too short to hold a selector and a function. |

<br>

### PDF417

| Command | Name | Status | Notes |
|---|---|---|---|
| `GS ( k pL pH 48 65 n` | columns | Rendered | The number of data columns, 1 to 30, or `0` for a number the renderer picks. Outside that range the value is left as it was. The printer starts at automatic. |
| `GS ( k pL pH 48 66 n` | rows | Rendered | The number of rows, 3 to 90, or `0` for automatic. |
| `GS ( k pL pH 48 67 n` | module width | Rendered | 2 to 8 dots. The printer starts at 3. |
| `GS ( k pL pH 48 68 n` | row height | Rendered | The height of a row as a multiple of the module width, 2 to 8, so a row is `n` times the module width in dots. The printer starts at 3. |
| `GS ( k pL pH 48 69 m n` | error correction | Rendered | With `m` of `48`, `n` is the level as an ASCII digit, `48` to `56` for level 0 to 8. With `m` of `49`, `n` is a ratio instead, 1 to 40 tenths of the data codewords as check codewords; the level is only known once the data is compacted, so the ratio is passed on and the symbology picks the level whose number of check codewords comes closest to it. Any other combination leaves the setting as it was. The printer starts at the ratio mode at one tenth. |
| `GS ( k pL pH 48 70 n` | options | Rendered | `0` the standard symbol, `1` the truncated one, which drops the right row indicator and the stop pattern. |
| `GS ( k pL pH 48 80 48 d..` | store data | Rendered | Stored until the next store, like the QR code data. |
| `GS ( k pL pH 48 81 48` | print | Rendered | Draws the symbol as a block, aligned, without a quiet zone. Nothing is printed when the storage is empty, when the data does not fit the number of columns and rows that were asked for, when it is more than 925 codewords, or when the symbol would be wider than the print area. |
| `GS ( k pL pH 48 ..` | any other function | Skipped | Consumed with the length of the group, and nothing happens. |

A symbol never holds fewer than three data codewords: one codeword of data and the length descriptor fill the data area exactly, with no room for the padding codeword the examples of the specification always leave, and readers refuse the result. **That minimum is a decision of this renderer, it is not a rule of the specification.** With no columns or rows given, the automatic size is the number of columns whose symbol comes closest to three times as wide as it is tall, which is what makes a small symbol on a receipt scannable, and the automatic error correction level is the recommendation of the specification, level 2 up to 40 data codewords, 3 up to 160, 4 up to 320 and 5 above that.

<br>

### Images

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC * m nL nH d..` | column mode image | Rendered | `nL + nH * 256` columns. `m` of `0` and `1` are the eight dot modes, one byte per column, `32` and `33` the 24 dot modes, three bytes per column, the most significant bit of the first byte at the top. The single density modes, `0` and `32`, print every column twice, so the image keeps its proportions at half the resolution. The strip goes into the line that is being composed, like one wide cell, and the `LF` behind it commits the line; the encoder sets the line spacing to 24 dots around an image so the strips join up. Any other `m` is read as an eight dot mode, doubled unless `m` is `1`, since its length has to be guessed either way. The encoder only emits `ESC * 33`. |
| `GS v 0 m xL xH yL yH d..` | raster image | Rendered | `xL + xH * 256` bytes per row, eight dots per byte, and `yL + yH * 256` rows. `m` of `0` normal, `1` double width, `2` double height and `3` both, by repeating dots, and `48` to `51` for the same four. Any other value prints the image unscaled. Drawn as a block of its own, aligned the way `ESC a` says. |
| `GS v m ..` | anything that is not `GS v 0` | Reported | The command is only defined with a `0` behind it, so the renderer reports it instead of drawing whatever follows. |
| `GS ( L pL pH ..` | graphics | Reported | Raster and column graphics, NV and download graphics. [Section 13](#not-supported-yet). |
| `GS 8 L p1 p2 p3 p4 ..` | graphics, long form | Reported | The same group under its four byte length prefix, consumed with that length. [Section 13](#not-supported-yet). |
| `GS * x y d..` | define downloaded bit image | Reported | Consumed with its `x * y * 8` data bytes. [Section 13](#not-supported-yet). |
| `GS / m` | print downloaded bit image | Reported | [Section 13](#not-supported-yet). |
| `ESC / n` | print downloaded bitmap | Reported | |
| `FS p n m` | print NV bit image | Reported | The image is held in the printer, so there is nothing to draw. [Section 13](#not-supported-yet). |
| `FS q n [xL xH yL yH d..]..` | define NV bit image | Reported | The `n` images with their sizes are consumed, `x` bytes wide and `y` bytes of eight dots tall each, nothing is kept. The encoder never sends it. [Section 13](#not-supported-yet). |

<br>

### Cut and drawer

| Command | Name | Status | Notes |
|---|---|---|---|
| `GS V n` | cut | Rendered | `1`, `49`, `66` and `104` are a partial cut, every other value a full one. `65`, `66`, `103` and `104` carry a second argument, the paper to feed before cutting, which is consumed and ignored: the blank lines the encoder feeds before a cut are already on the image. Emits a `cut` item, and the lines that are finished become an image item in front of it. |
| `ESC p m t1 t2` | pulse | Rendered | Drawer `m & 1`, `t1 * 2` milliseconds on and `t2 * 2` off. Emits a `pulse` item, which flushes the same way a cut does. The encoder writes its default of 100 and 500 ms as `ESC p 0 50 250`. |
| `ESC i` | full cut, legacy | Reported | [Section 12](#not-supported-yet). |
| `ESC m` | partial cut, legacy | Reported | [Section 12](#not-supported-yet). |

A half composed line stays in the painter and continues behind the command, which is what a printer does when it fires the drawer before the pending line prints. The encoder always finishes the line first, so in practice the line is empty.

<br>

### Printer state and status

These commands change nothing about the paper of the receipt that is being rendered. They are consumed with the lengths of the specification and reported, so that a driver can see them and the stream stays in sync.

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC = n` | select peripheral device | Reported | |
| `ESC U n` | unidirectional printing | Reported | |
| `ESC c n` (`ESC c 3`, `ESC c 4`, `ESC c 5`) | paper sensor and panel button settings | Reported | Consumed as two argument bytes, the selector and its value. |
| `ESC u n` | transmit peripheral device status | Reported | The renderer never answers a status request, it has no channel back to the host. |
| `ESC v` | transmit paper sensor status | Reported | |
| `GS I n` | transmit printer id | Reported | |
| `GS a n` | automatic status back | Reported | |
| `GS b n` | smoothing | Reported | |
| `GS c` | print counter | Reported | |
| `GS g m nL nH` | maintenance counter | Reported | Both `GS g 0` and `GS g 2`, consumed as four argument bytes. |
| `GS j n` | transmit remaining paper sensor status | Reported | |
| `GS r n` | transmit status | Reported | |
| `GS z n1 n2` | print density and other settings | Reported | |
| `GS E n` | print control method | Reported | |
| `GS :` | start or end macro definition | Reported | |
| `FS g 1 m a1..a4 nL nH d..` | write to the user memory | Reported | Consumed with the data length it carries. |
| `FS g 2 m a1..a4 nL nH` | read from the user memory | Reported | |

<br>

### Not supported yet

These are the common ESC/POS commands the renderer parses but does not render, and what is planned for them. The sections are the ones of the [implementation plan](implementation-plan.md).

**Section 12, text layout.**

- `ESC ! n` print mode: font, bold, double height, double width and underline in one byte, setting the same state as the individual commands.
- `ESC G n` double strike, which will render as bold.
- `ESC R n` international character set: twelve code points replaced per set, applied after the codepage decoding.
- `ESC { n` upside down printing: every committed line, blocks included, rotated by 180 degrees.
- `ESC SP n` right side character spacing, in horizontal motion units, scaled with the width multiplier.
- `HT` and `ESC D n1..nk NUL` tab stops, in character widths of the current font, by default every eight characters.
- `ESC $ nL nH` absolute and `ESC \ nL nH` relative print position, in horizontal motion units.
- `GS L nL nH` left margin and `GS W nL nH` print area width, applied at the start of the next line.
- `ESC i` and `ESC m`, the legacy full and partial cuts.
- The `FS` Kanji group, `FS &`, `FS .`, `FS C`, `FS !`, `FS -`, `FS S` and `FS W`: a lead byte and its trail byte consumed as one character and drawn as a double width placeholder cell, so that the layout stays right without a CJK font, and UTF-8 decoded properly where `FS C` selects it.
- `DLE EOT n`, `DLE ENQ n` and `DLE DC4 fn ..`, the real time commands, to be consumed with their exact lengths instead of byte by byte.

**Section 13, images.**

- `GS ( L` and `GS 8 L` graphics: raster and column graphics into the print buffer, printed as a block, and NV and download graphics defined and printed by key code.
- `GS * x y d..` and `GS / m`, the downloaded bit image, defined once and printed in the four modes of `GS v 0`.
- `FS q n ..` and `FS p n m`, NV bit images defined in the stream and printed by number.

**Section 14, GS1 DataBar.** The symbologies `75` to `78` of `GS k`, Omnidirectional, Truncated, Limited and Expanded, with the human readable text below them.

**Not planned.**

- Page mode, `ESC L`, `ESC S`, `ESC T`, `ESC W`, `GS $` and `GS \`: the printer composes a page in memory and prints it in one go, which is a second layout engine next to the line one.
- CJK fonts. The Kanji group gets placeholder cells, not glyphs; a receipt that needs real CJK text needs a printer with the font.
- User defined characters, `ESC %`, `ESC ?`, `FS 2` and `FS ?`: glyphs downloaded into the printer.
- NV logos: images stored in the printer, which the renderer has never seen and cannot draw.
- Status and settings commands, `GS I`, `GS r`, `GS a`, `ESC u`, `ESC v`, `GS j`, `GS z`, `FS g` and the rest of [Printer state and status](#printer-state-and-status): there is no channel back to the host, and the settings do not change the paper.
- Maxicode and the composite symbologies, the other selectors of the `GS ( k` group.
