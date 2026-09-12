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
  - [Graphics](#graphics)
  - [Cut and drawer](#cut-and-drawer)
  - [Printer state and status](#printer-state-and-status)
  - [Not supported yet](#not-supported-yet)
- [StarPRNT commands](commands-star-prnt.md)
- [Design document](design.md)

<br>

## ESC/POS commands

This page lists every ESC/POS command `EscPosRenderer` recognises, what it does to the paper, and the exact values it accepts. It is a reference for the compatibility of the renderer: what a stream from ReceiptPrinterEncoder relies on, and what a stream from other software can expect.

The renderer emulates an Epson ESC/POS printer. It interprets the bytes the way the firmware does, including the cases where the firmware prints nothing at all: a barcode with invalid data, a symbol wider than the paper, an argument outside the range of its command. It does not improve on the printer, so `ESC 4` italic is ignored exactly as an Epson ignores it.

It deliberately differs from the hardware in a few places, each of them because the behaviour is not on the wire and no hardware check settled it. They are marked in the notes below, and these are all of them: the four dot gap between the bars of a barcode and its human readable text, the approximations of `ESC J` and `ESC d`, the default horizontal motion unit of `GS P`, a QR model 1 drawn as a model 2 symbol, the basic 43 character set of Code 93, the minimum of three data codewords of a PDF417 symbol, the placeholder cells of the Kanji group, the initial code system of `FS C`, `FS ( C` and with it UTF-8 not being decoded, sets 16 and 17 of `ESC R` replacing nothing, the feed order of `ESC { n`, the argument lengths of `DLE DC4 3` and `DLE DC4 7`, the images of the graphics print buffer drawn under each other, the download graphics and the downloaded bit image of `GS *` surviving an `ESC @`, a multiple tone image drawn as its first colour, the reference dot density of function `49`, which is consumed and not honoured, and the heights of the GS1 DataBar family, which are a reading of the specification pending a hardware check.

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
| `HT` | horizontal tab | Rendered | Moves the cursor to the next tab stop, see [Alignment and position](#alignment-and-position). |
| `DLE` | real time prefix | Reported | `DLE EOT`, `DLE ENQ` and `DLE DC4` are consumed with their own lengths, see [Printer state and status](#printer-state-and-status). |
| `FS &` | select Kanji mode | Rendered | The bytes that follow are read as multibyte characters, see [Codepages and character sets](#codepages-and-character-sets). |
| `FS .` | cancel Kanji mode | Rendered | Back to one byte per character. The encoder sends it right behind `ESC @`, where there is no Kanji mode to leave. |
| other bytes below `0x20` | — | Skipped | Everything that is not `HT`, `LF`, `CR`, `DLE`, `ESC`, `GS` or `FS` is ignored, the way a printer ignores it. |

<br>

### Styles and sizes

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC E n` | bold | Rendered | Bit 0 of `n`, so every odd value switches it on. Drawn as overstrike, the glyph twice with a one dot horizontal offset, which is what the print head does. Emphasis and the double strike of `ESC G` are two settings of the printer, and a cell is drawn bold while either of them is on, so `ESC G 0` does not undo an `ESC E 1`. |
| `ESC - n` | underline | Rendered | `0` off, `1` one dot thick, `2` two dots thick, along the bottom of the cell and across the spaces between characters. The ASCII digits `48`, `49` and `50` are accepted for the same three. Any other value leaves the underline as it was, instead of throwing. |
| `ESC 4 n` | italic | Parsed | Ignored, as Epson hardware ignores it. The encoder emits it for `italic()`, so a receipt that asks for italic prints upright, on paper and here. |
| `GS B n` | invert | Rendered | Bit 0 of `n`. The cell is drawn white on black; the gap the line spacing leaves below the line stays white. |
| `GS ! n` | character size | Rendered | Width multiplier in the high nibble plus one, height multiplier in the low nibble plus one, both 1 to 8. Bits 3 and 7 are masked off, so there is no value this command refuses. Glyphs are scaled by repeating dots, as a printer scales them. |
| `ESC M n` | font | Rendered | `0` or `48` font A, 12 by 24 dots, `1` or `49` font B, 9 by 17 dots in the Epson profile and 9 by 24 in the Star profile. Font C, `2` or `50`, has no glyphs here and leaves the font as it was. |
| `ESC ! n` | print mode | Rendered | Font, emphasis, double height, double width and underline in one byte: bit 0 font B, bit 3 emphasis, bit 4 double height, bit 5 double width, bit 7 underline. It sets the same state as the individual commands and clears what it does not set, so `ESC ! 0` is plain font A text, with the double strike of `ESC G` as the one exception: that is a setting of its own and bit 3 does not clear it. A `GS !` behind it decides the size, and an `ESC !` behind a `GS !` overrides that size with its two bits. |
| `ESC G n` | double strike | Rendered | Bit 0 of `n`, drawn as bold. A print head strikes the same dots twice, which is not visible on a thermal printer; the overstrike of bold is the closest thing on paper and it is what the firmware of a thermal printer does with the command. It is a setting of its own next to the emphasis of `ESC E` and bit 3 of `ESC !`, and the cell is bold while either of them is on. |
| `ESC { n` | upside down printing | Rendered | Bit 0 of `n`. Every line that is committed while it is on, blocks included, is rotated by 180 degrees over the full width of the paper, so a left aligned line comes out at the right edge upside down. **The order in which the lines are fed does not change, which is a simplification: a printer holds the whole page and prints it bottom up, which needs the page mode this renderer does not have.** |
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
| `GS P x y` | motion units | Rendered | The vertical unit is what `ESC 3` and `ESC J` are counted in, and it is tracked as the number of units in one dot: `GS P 0 0` returns to the profile default, two units per dot on Epson and one on Star, and any other `y` is read as one unit per dot, because the renderer does not know the resolution of the printer it emulates and setting the unit to that resolution is the only thing the encoder ever does with this command. The horizontal unit is what `ESC SP`, `ESC $`, `ESC \\`, `GS L` and `GS W` are counted in, and it is the other way round, the number of dots in one unit: one dot until the command sets it, and `dpi / x` dots afterwards, with the `dpi` of the profile, 203 for both built in profiles. `GS P 0 0` returns to one dot per unit. **One dot per unit is a simplification: an Epson starts at 1/180 inch horizontally, which is 1.13 dots.** |
| `ESC SP n` | right side character spacing | Rendered | `n` horizontal motion units of white behind every character, scaled with the width multiplier, as the printer scales it. The space is not part of the width the alignment centres, so a centred line is centred on its characters, and it is part of the width of a character for the tab stops of `ESC D` and for the default stops. |
| `ESC $ nL nH` | absolute print position | Rendered | `nL + nH * 256` horizontal motion units from the left margin. A position beyond the print area is ignored. Cells that were already placed stay where they are, so moving back and printing again overprints, the way a printer overprints. |
| `ESC \ nL nH` | relative print position | Rendered | The same, relative to the cursor and signed: a value above 32767 is the negative distance below it, which moves back towards the left margin. A distance that lands outside the print area is ignored. |
| `HT` | horizontal tab | Rendered | Moves the cursor to the first tab stop beyond it. A tab with no stop behind it does nothing, and neither does one when every stop was cancelled. A stop that lies outside the print area puts the cursor one dot beyond the area instead, so that the character behind the tab wraps to a new line, which is what the reference of this command describes. |
| `ESC D n1..nk NUL` | horizontal tab positions | Rendered | Up to 32 stops, each `n` times the width of a character of the font that is current when the command arrives, so a stop is a number of dots from then on. A character is as wide as its cell plus the right side spacing of `ESC SP`, which is the unit of the reference. The stops have to ascend, one that does not ends the list. `ESC D NUL` cancels every stop, after which `HT` does nothing at all; `ESC @` puts the default back, a stop every eight characters of font A. |
| `GS L nL nH` | left margin | Rendered | `nL + nH * 256` horizontal motion units from the left edge of the paper. The command is only effective at the beginning of a line, as the reference says: a line that already holds characters, or whose cursor was moved, makes the printer drop the command, and this renderer drops it too. |
| `GS W nL nH` | print area width | Rendered | The width of the print area in horizontal motion units, only effective at the beginning of a line like `GS L`. A width that does not fit next to the left margin is clamped to the paper. Wrapping, the alignment and the tab stops all work inside the print area, so a centred line is centred between the margins. |
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
| `ESC R n` | international character set | Rendered | Sets 0 to 17: USA, France, Germany, United Kingdom, Denmark I, Sweden, Italy, Spain I, Japan, Norway, Denmark II, Spain II, Latin America, Korea, Slovenia and Croatia, China, Vietnam and Arabia. The set replaces the twelve code points `0x23`, `0x24`, `0x40`, `0x5B`, `0x5C`, `0x5D`, `0x5E`, `0x60`, `0x7B`, `0x7C`, `0x7D` and `0x7E`, after the codepage decoding and only for those twelve bytes, so the rest of the codepage is untouched. A number the command does not define leaves the set as it was, and `ESC @` goes back to the USA set, which replaces nothing. **Sets 16 and 17 are in the table of the reference but their replacements are not in any specification text that was available here, so both print the characters of set 0.** The won sign of the Korean set has no glyph in the built in font and prints as the fallback box. |
| `ESC % n` | select user defined character set | Reported | |
| `ESC ? n` | cancel user defined character | Reported | |
| `FS &` | select Kanji mode | Rendered | The bytes that follow are read as multibyte characters: a lead byte and the byte behind it are one character, which is drawn as two cells of the fallback glyph. There is no CJK font here, so the placeholder is what keeps the layout right; **two fallback cells is a choice of this renderer, a printer draws the glyph in the same 24 dots.** A lead byte at the very end of the stream is not a pair and prints as a character of its own. |
| `FS C n` | Kanji code system | Rendered | `0` or `48` JIS, where every pair of bytes from `0x21` to `0x7E` is one character, `1` or `49` Shift JIS, where a lead byte is `0x81` to `0x9F` or `0xE0` to `0xFC`. A value the command does not define leaves the code system as it was. **The printer starts in Shift JIS here, and the initial value differs per model in the reference, so a stream that relies on the model's default and sends no `FS C` may be read in the other system.** |
| `FS ! n` | multi byte print mode | Parsed | The size and the underline of the multibyte characters. This renderer draws them as placeholder cells in the style of the single byte text, so the command changes nothing on paper. |
| `FS - n` | multi byte underline | Parsed | The same. |
| `FS S n1 n2` | Kanji character spacing | Parsed | The left and the right space of a multibyte character, in horizontal motion units. |
| `FS W n` | quadruple size Kanji | Parsed | |
| `FS ( C pL pH fn ..` | character encode system | Reported | The group that selects UTF-8 on the models that have it. Consumed with the length it carries, so the stream stays in sync. **Its layout is not settled by a specification text that was available here, so nothing is rendered for it and a stream in UTF-8 prints the bytes through the current codepage.** |
| `FS 2 c1 c2 d1..dk` | define user defined Kanji | Reported | The number of data bytes depends on the Kanji font of the printer, which the stream does not say, so the table assumes the 32 bytes of the 16 by 16 font. The encoder never sends this command. |
| `FS ? c1 c2` | cancel user defined Kanji | Reported | |

`FS .` leaves Kanji mode again, see [Text and control](#text-and-control).

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

The GS1 DataBar family is the one family whose height is not only the height of `GS h`. ISO/IEC 24724 gives all four variants a height: thirteen modules for Truncated, ten for Limited, thirty three for Omnidirectional and thirty four for Expanded, in modules, so they follow the width of a module of `GS w`. **The specification words all four as minimums, and what an Epson does with a `GS h` below them is remembered as having no effect on this family at all, which no hardware check settled here. This renderer reads the heights of Truncated and Limited as fixed, so that a `GS h` of two hundred dots does not turn a Truncated symbol back into the Omnidirectional one it has the bars of, and the heights of Omnidirectional and Expanded as minimums, so that a taller `GS h` still makes those symbols taller.** The human readable text of these symbols is the element string with its application identifiers in parentheses.

Omnidirectional is ninety six modules wide, of which ninety five are printed, and Limited is seventy nine, of which seventy three are printed: the module in front of the left guard bar, and the five module space behind the right guard bar of Limited, are quiet zone and a printer does not print them either. The parenthesised notation of Expanded has no escape for a parenthesis inside a value, so an `(` in the data always starts the next application identifier, which is what BWIPP and the reference encoders do with it as well.

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
| `75` | GS1 DataBar Omnidirectional | Rendered | Thirteen digits, or fourteen with the check digit, which is validated; a wrong one prints nothing. The symbol is the RSS-14 of ISO/IEC 24724, ninety six modules of four data characters and two finder patterns. The height is at least thirty three modules, whatever `GS h` says. |
| `76` | GS1 DataBar Truncated | Rendered | The same data and the same bars as Omnidirectional, thirteen modules tall, which is the height the specification gives it and which `GS h` does not change. |
| `77` | GS1 DataBar Limited | Rendered | Thirteen or fourteen digits of a GTIN that starts with a zero or a one, seventy nine modules of two data characters with a check character between them. Ten modules tall, whatever `GS h` says. |
| `78` | GS1 DataBar Expanded | Rendered | A GS1 element string with its application identifiers in parentheses, `(01)90614141000015(3103)000123`, in four to twenty two symbol characters. The compressed encodation methods of AI `(01)` are used where the element string allows them: a weight in AI `(3103)`, `(3202)` or `(3203)`, a weight in AI `(3100)` to `(3109)` or `(3200)` to `(3209)` with an optional date in AI `(11)`, `(13)`, `(15)` or `(17)`, and a price or a rate in AI `(392x)` or `(393x)`. Every other identifier of the 31xx and 32xx blocks, `(3123)` and `(3210)` among them, has no compressed method and goes through the general purpose field, as does everything else, with the numeric, alphanumeric and ISO 646 compaction of the specification. The height is at least thirty four modules. Data that is not an element string, or that holds a character no compaction method has, prints nothing. |
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
| `GS ( L pL pH 48 fn ..` | graphics | Rendered | The graphics group, whose functions are listed under [Graphics](#graphics). `pL + pH * 256` counts everything behind the two length bytes, so a function the renderer does not know is still consumed whole. An `m` that is not `48` is not this group and is reported. |
| `GS 8 L p1 p2 p3 p4 48 fn ..` | graphics, long form | Rendered | The same group under a four byte length, which is the form a definition of more than 65535 bytes has to use. The functions and their parameters are the same, only the length is longer. **The reference reserves this form for the functions that carry data, `67`, `68`, `83`, `84`, `112` and `113`; this renderer accepts every function of the group under it, which costs nothing and keeps a stream that uses it in sync.** |
| `GS * x y d..` | define the downloaded bit image | Rendered | `x` bytes of eight dots wide and `y` bytes of eight dots tall, `x * y * 8` data bytes in column format: one column after another, `y` bytes per column, the most significant bit of the first byte at the top. There is one downloaded bit image, so a definition replaces the one before it. `x` runs from 1 to 255, `y` from 1 to 48, and `x * y` is at most the 1536 bytes the memory of the printer holds; a size outside those ranges makes the printer ignore the command, so the image that was downloaded before it stays where it is. |
| `GS / m` | print the downloaded bit image | Rendered | `m` of `0` normal, `1` double width, `2` double height and `3` both, and `48` to `51` for the same four, exactly as `GS v 0` scales its image. A mode the command does not define makes the printer ignore it, unlike `GS v 0`, which carries its image in the same command and prints it unscaled. Drawn as a block of its own, aligned the way `ESC a` says. A printer that was never given a definition prints nothing at all and the command is reported. |
| `FS q n [xL xH yL yH d..]..` | define NV bit images | Rendered | `n` images, each `x` bytes of eight dots wide and `y` bytes of eight dots tall, `x * y * 8` data bytes in the column format of `GS *`. The command replaces every NV bit image the printer held, so the images of an earlier definition are gone; an `n` of `0` is outside the range of the command and is ignored, which deletes nothing. The images are numbered 1 to `n`, which is what `FS p` addresses them with. The encoder never sends it. |
| `FS p n m` | print an NV bit image | Rendered | Image `n` in the four modes of `GS /`, a mode outside them ignored the same way. An image the stream never defined prints nothing and the command is reported: a printer holds NV bit images that were put there by a utility, and the renderer has never seen them. |
| `ESC / n` | print downloaded bitmap | Reported | |

An image that is wider than the paper is drawn at the left of the print area and clipped at the right edge of the paper, the way a printer clips it. The barcode rule, which prints nothing at all when the symbol does not fit, is not applied to images: an image that is a few dots too wide still carries its message.

<br>

### Graphics

The functions of the `GS ( L` and `GS 8 L` group, by their function code. Every function carries `m` of `48` in front of the function code.

| Function | Name | Status | Notes |
|---|---|---|---|
| `112` | store raster graphics in the print buffer | Rendered | `a bx by c xL xH yL yH d..`. `a` of `48` is a monochrome image and `52` a multiple tone one, which is drawn as its first colour; any other value is reported. `bx` and `by` of `2` double the width and the height of the image by repeating its dots, exactly as `GS v 0` doubles, and any other value is read as `1`. `c` of `49` is colour 1, the black of a single colour printer; the data of another colour is consumed and nothing is drawn for it. `x` and `y` are the size of the image in dots, 1 to 8192 in the direction the data runs in and 1 to 2047 across it, so a raster image is at most 8192 dots wide and 2047 dots tall. The data is one row after another, `int((x + 7) / 8)` bytes per row, eight dots per byte. A `bx`, `by` or size outside its range makes the printer ignore the command, so nothing is stored and nothing is printed, and a command that carries fewer dots than its size asks for stores only the rows that are there. |
| `113` | store column graphics in the print buffer | Rendered | The same parameters, with the dots one column after another, `int((y + 7) / 8)` bytes per column, the most significant bit of the first byte at the top, so the image is at most 2047 dots wide and 8192 dots tall. The same picture through `112` and `113` prints the same dots. |
| `50` | print the graphics of the print buffer | Rendered | Draws what the store functions gathered as a block of its own, aligned the way `ESC a` says, and empties the buffer. **Images that were stored one after another are drawn under each other, which is a choice of this renderer: the reference does not say where a second store lands.** An empty buffer prints nothing and does not advance the paper. `ESC @` throws the buffer away, as it throws away the print buffer it is part of. |
| `67`, `68` | define NV graphics, raster and column format | Rendered | `a kc1 kc2 b xL xH yL yH [c d..]1..[c d..]b`. The image is kept under the key code `kc1 kc2`, `b` is the number of colour blocks that follow the size, and each block is its colour byte and the dots of the image in the format of the function. Colour 1 is kept, the other blocks are consumed. The sizes are the ones of `112` and `113`, and a size outside its range, or a definition whose dots are missing, makes the command do nothing at all: the image that is under that key code stays where it is. The plan of section 13 had `68` and `84` parsed and skipped; they are rendered here, because the column format is the one of function `113` and the definition costs nothing extra. |
| `83`, `84` | define download graphics, raster and column format | Rendered | The same parameters, in the download memory instead of the NV memory. The two memories have key codes of their own, so the same key code can hold a different image in each. |
| `69` | print NV graphics | Rendered | `kc1 kc2 x y`, where `x` and `y` are `1` or `2`, the `2` doubling the width and the height by repeating dots. A parameter that is missing or outside that range makes the printer ignore the command. Drawn as a block of its own, aligned the way `ESC a` says. A key code the renderer never got a definition for prints nothing at all, does not advance the paper, does not commit the line that is being composed, and the command is reported. |
| `85` | print download graphics | Rendered | The same, from the download memory. |
| `65`, `81` | delete all NV, all download graphics | Rendered | Both take `d1 d2 d3` of `CLR`, the bytes `67 76 82`, and every image of that memory is forgotten. Any other parameter makes the printer ignore the command, so nothing is deleted by accident. |
| `66`, `82` | delete one NV, one download image | Rendered | `kc1 kc2`. A key code that holds no image deletes nothing, as it does on a printer. |
| `48`, `51`, `52` | transmit the memory capacities | Reported | The renderer has no channel back to the host, and the capacities do not change the paper, so the command is reported the way every other request for a status is. |
| `49` | set the reference dot density | Parsed | `x y`, both `50` for 180 dpi and `51` for 360 dpi, which is the density the sizes of the graphics functions are counted in. Consumed and not honoured: this renderer draws one dot of an image on one dot of the paper, at the 203 dpi of both profiles, so a stream that asks for another density prints its image at the size its dots have. |
| `64`, `80` | transmit the key code lists | Reported | The same, they answer the host. |
| anything else | | Reported | Consumed with the length of the group. |

An image a definition function stored stays in the painter for the life of the renderer: an `ESC @` does not delete it, and neither does the end of a stream, so a receipt that defines a logo once and prints it in every job after that renders the way it prints. **That is the NV memory of a printer exactly, and a deviation for the download memory and for the downloaded bit image of `GS *`, which a printer keeps in RAM and clears on `ESC @`.** A second renderer instance starts with nothing, the way a second printer does.


### Cut and drawer

| Command | Name | Status | Notes |
|---|---|---|---|
| `GS V n` | cut | Rendered | `1`, `49`, `66` and `104` are a partial cut, every other value a full one. `65`, `66`, `103` and `104` carry a second argument, the paper to feed before cutting, which is consumed and ignored: the blank lines the encoder feeds before a cut are already on the image. Emits a `cut` item, and the lines that are finished become an image item in front of it. |
| `ESC p m t1 t2` | pulse | Rendered | Drawer `m & 1`, `t1 * 2` milliseconds on and `t2 * 2` off. Emits a `pulse` item, which flushes the same way a cut does. The encoder writes its default of 100 and 500 ms as `ESC p 0 50 250`. |
| `ESC i` | full cut, legacy | Rendered | The legacy command without arguments. Emits a `cut` item with the value `full`. |
| `ESC m` | partial cut, legacy | Rendered | The same, with the value `partial`. |

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
| `DLE EOT n` | transmit real time status | Reported | One argument byte, and two for `DLE EOT 7 n` and `DLE EOT 8 n`. |
| `DLE ENQ n` | real time request | Reported | |
| `DLE DC4 fn ..` | real time request | Reported | `fn 1 m t` generates a pulse, `fn 2 a b` runs the power off sequence, `fn 8` carries the seven fixed bytes of the clear buffer request, and `fn 3` and `fn 7` one parameter byte each. Anything else is read as the function byte alone. **The lengths of `fn 3` and `fn 7` are the common ones, they are not settled by a specification text that was available here.** The pulse of `fn 1` is reported rather than rendered: it is a real time command the printer performs at once, next to the receipt rather than in it. |

<br>

### Not supported yet

These are the ESC/POS commands the renderer parses but does not render. Every command the [implementation plan](implementation-plan.md) planned for is rendered now; what is left is the list below, and none of it is planned.

- Page mode, `ESC L`, `ESC S`, `ESC T`, `ESC W`, `GS $` and `GS \`: the printer composes a page in memory and prints it in one go, which is a second layout engine next to the line one.
- CJK fonts. The Kanji group draws placeholder cells, not glyphs; a receipt that needs real CJK text needs a printer with the font. UTF-8 through `FS ( C` is not decoded either, for the same reason and because the layout of that group is not settled here.
- User defined characters, `ESC %`, `ESC ?`, `FS 2` and `FS ?`: glyphs downloaded into the printer.
- NV logos and graphics that a utility put in the printer before the stream. An image the stream defines itself is drawn, see [Images](#images) and [Graphics](#graphics); a print of a key code or an image number the stream never defined prints nothing and is reported, because the renderer has never seen what the printer holds.
- Status and settings commands, `GS I`, `GS r`, `GS a`, `ESC u`, `ESC v`, `GS j`, `GS z`, `FS g`, the `DLE` real time commands and the rest of [Printer state and status](#printer-state-and-status): there is no channel back to the host, and the settings do not change the paper.
- Maxicode and the composite symbologies, the other selectors of the `GS ( k` group.
