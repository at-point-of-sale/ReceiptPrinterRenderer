/*
    The international character sets of ESC R n.

    A printer that is set to an international character set replaces twelve
    code points of the character table it decodes with, and nothing else: the
    twelve positions ASCII leaves to the national variants. The replacement
    happens after the codepage decoding and only for these twelve bytes, so a
    receipt in cp437 with the German set prints ä for 0x7B and keeps every other
    byte of cp437.

    The table is the one of the Epson ESC/POS reference, sets 0 to 17. Star
    printers have the same command with the same numbers for the sets they share
    with Epson, see the notes in documentation/commands-star-prnt.md.
*/

/* The twelve bytes a set replaces, in the order of the table below */

const POSITIONS = [0x23, 0x24, 0x40, 0x5b, 0x5c, 0x5d, 0x5e, 0x60, 0x7b, 0x7c, 0x7d, 0x7e];

/* The characters of each set, twelve per set, in the order of POSITIONS.

   Sets 16 and 17, Vietnam and Arabia, are listed in the reference but their
   replacements are not in any specification text that was available here, so
   they hold the ASCII characters of set 0 and replace nothing. */

const SETS = [
  '#$@[\\]^`{|}~', /*  0 USA */
  '#$à°ç§^`éùè¨', /*  1 France */
  '#$§ÄÖÜ^`äöüß', /*  2 Germany */
  '£$@[\\]^`{|}~', /*  3 United Kingdom */
  '#$@ÆØÅ^`æøå~', /*  4 Denmark I */
  '#¤ÉÄÖÅÜéäöåü', /*  5 Sweden */
  '#$@°\\é^ùàòèì', /*  6 Italy */
  '₧$@¡Ñ¿^`¨ñ}~', /*  7 Spain I */
  '#$@[¥]^`{|}~', /*  8 Japan */
  '#¤ÉÆØÅÜéæøåü', /*  9 Norway */
  '#$ÉÆØÅÜéæøåü', /* 10 Denmark II */
  '#$á¡Ñ¿é`íñóú', /* 11 Spain II */
  '#$á¡Ñ¿éüíñóú', /* 12 Latin America */
  '#$@[₩]^`{|}~', /* 13 Korea */
  '#$ŽŠĐĆČžšđćč', /* 14 Slovenia and Croatia */
  '#¥@[\\]^`{|}~', /* 15 China */
  '#$@[\\]^`{|}~', /* 16 Vietnam, not settled */
  '#$@[\\]^`{|}~', /* 17 Arabia, not settled */
];

/* The tables, built once, byte to code point. A set only holds the bytes it
   actually changes, so the set of a printer that was never given one, and set 0
   itself, replace nothing at all */

const TABLES = SETS.map((set) => {
  const table = Object.create(null);
  const characters = Array.from(set);

  for (let index = 0; index < POSITIONS.length; index++) {
    const codepoint = characters[index].codePointAt(0);

    if (codepoint !== POSITIONS[index]) {
      table[POSITIONS[index]] = codepoint;
    }
  }

  return table;
});

/* The table of a printer that replaces nothing */

const NONE = Object.create(null);

/**
 * The replacement table of an international character set
 *
 * @param  {number}        value   The argument of ESC R n
 * @param  {number}        [last]  Highest set number this language defines, 17 by default
 * @return {object|null}           Byte to code point, or null when the language has no such set
 */
export function internationalCharacterSet(value, last = SETS.length - 1) {
  if (!Number.isInteger(value) || value < 0 || value > last) {
    return null;
  }

  return TABLES[value];
}

/**
 * The table of a printer that was not given an international character set
 *
 * @return {object}   An empty table
 */
export function noCharacterSet() {
  return NONE;
}

export default internationalCharacterSet;
