import fs from 'node:fs';
import path from 'node:path';

import ReceiptPrinterRenderer from '../src/receipt-printer-renderer.js';
import {stitch} from '../src/formats/stitch.js';
import {commands} from './helpers/items.js';
import {diff} from './helpers/ascii.js';
import {
  libraries, fixtures, external, options, directory,
  PROVENANCE_FIELDS, LICENCES,
} from './helpers/external.js';
import {assert} from 'chai';

/*
    The fixtures from the wild, section 16.

    Every fixture in test/fixtures/external is a byte stream another library
    produced, captured by the scripts in tools/external and frozen with the
    render this package makes of it. This file walks all of them and makes the
    three checks the implementation plan asks for:

      - the paper equals the golden PBM,
      - the items that are not images equal items.json,
      - the `unknown` count of the provenance equals the number of unknown items
        in items.json, so that the two files cannot drift apart.

    A newly supported command therefore changes the recorded count and shows up
    as a fixture change that is reviewed like any other, and a command that is
    not supported is visible from the first capture.

    Every fixture is rendered with the unified renderer, with the language, the
    width and the codepage mapping of its own provenance and with every command
    type in the output. Nothing here runs a capture script, the streams are what
    the repository carries.

    The receiptline fixtures carry the same document in five command sets and
    two languages, so they also make the parity check at the bottom of this
    file.
*/

/**
 * @typedef {import('./helpers/external.js').Provenance} Provenance
 */

/**
 * The dots of a bitmap, as a string, so that two renders can be compared
 *
 * @param  {object}   bitmap   The bitmap
 * @return {string}            The dots
 */
function dots(bitmap) {
  return `${bitmap.width}x${bitmap.height}:${Array.from(bitmap.data).join(',')}`;
}

/**
 * Render a fixture the way its provenance says
 *
 * @param  {object}   entry   What external() returned
 * @return {object[]}         The items
 */
function render(entry) {
  return new ReceiptPrinterRenderer(options(entry.provenance)).render(entry.bytes);
}

describe('external fixtures', function() {
  it('should have at least the receiptline, the python-escpos and the playground set', function() {
    assert.includeMembers(libraries(), ['receiptline', 'python-escpos', 'playground']);
  });

  for (const library of libraries()) {
    describe(library, function() {
      it('should keep the licence text of the library', function() {
        const licence = path.join(directory, library, 'LICENSE');

        assert.isTrue(fs.existsSync(licence), `${library} has no LICENSE file`);
        assert.isAbove(fs.readFileSync(licence, 'utf8').length, 0);
      });

      it('should have fixtures', function() {
        assert.isAbove(fixtures(library).length, 0);
      });

      for (const name of fixtures(library)) {
        describe(name, function() {
          /* Loading and rendering happens inside the tests, so that a fixture
             that fails does not take the rest of the file down with it */

          it('should have a provenance with the documented fields', function() {
            const provenance = external(library, name).provenance;

            assert.deepEqual(Object.keys(provenance), PROVENANCE_FIELDS);
            assert.isAbove(provenance.setup.length, 0);
            assert.isAbove(provenance.command.length, 0);
            assert.include(LICENCES, provenance.licence);
            assert.include(ReceiptPrinterRenderer.languages, provenance.language);
            assert.match(provenance.captured, /^\d{4}-\d{2}-\d{2}$/);
            assert.equal(provenance.width % 8, 0);
          });

          it('should render the paper of the fixture', function() {
            const expected = external(library, name);
            const paper = stitch(render(expected), {width: expected.provenance.width});

            if (dots(paper) !== dots(expected.paper)) {
              assert.fail(`${library}/${name} does not match its fixture\n${diff(paper, expected.paper)}`);
            }
          });

          it('should emit the commands of the fixture', function() {
            const expected = external(library, name);

            assert.deepEqual(commands(render(expected)), expected.commands);
          });

          it('should emit the number of unknown items the provenance records', function() {
            const expected = external(library, name);
            const unknown = expected.commands.filter((item) => item.type === 'unknown');

            assert.equal(unknown.length, expected.provenance.unknown);
          });
        });
      }
    });
  }
});

/*
    Parity over the receiptline fixtures.

    One ReceiptLine document is turned into ESC/POS, StarPRNT and Star Line mode
    by receiptline's command sets, so the same receipt has to come out of the
    renderers as the same paper. It is the parity test of test/parity.js over
    streams this package did not produce, and it is the reason the receiptline
    fixtures are captured in more than one language at all.

    Both renders use the same profile, the way test/parity.js does it, so that
    only the languages differ and not the printer family defaults.

    What receiptline itself writes differently per language is listed below,
    each entry with its reason. They are properties of receiptline's command
    sets, not of the renderers.
*/

const PARITY_OPTIONS = {profile: 'epson'};

/*
    The command sets of the fixture names, with the group a set belongs to for
    the comparison: the two ESC/POS sets have to agree with each other, the two
    Star text sets as well, and the groups have to agree with each other unless
    the document is an exception.
*/

const SETS = {
  'escpos': 'esc-pos',
  'generic': 'esc-pos',
  'starsbcs': 'star',
  'starlinesbcs': 'star',
  'stargraphic': 'raster',
};

/*
    The documents whose two groups differ, with the reason receiptline writes
    them differently.

    - The corners of a box. receiptline draws the ruled lines of ESC/POS out of
      the Epson katakana page, where the four corners are the rounded ╭ ╮ ╰ ╯,
      and the ones of StarPRNT out of cp437, where they are the square ┌ ┐ └ ┘.
      Every document with a `{border:line}` or a column border is therefore two
      dots different per corner.

    - The underline. receiptline asks ESC/POS for the two dot underline with
      ESC - 2 and StarPRNT for its only one with ESC - 1.

    Code 128 used to be a third difference: receiptline writes the data of a
    Code 128 for ESC/POS as the code set selection {C followed by the value of
    every digit pair, and for StarPRNT as the digits themselves, which the
    printer encodes itself. Both come out as the same symbol since the renderer
    reads {C the way the specification describes, see the notes of section 16.
*/

const EXCEPTIONS = {
  'receipt': 'the corners of the box are rounded in ESC/POS and square in StarPRNT',
  'receipt2': 'the corners of the box are rounded in ESC/POS and square in StarPRNT, ' +
    'and the underline is two dots thick in ESC/POS and one in StarPRNT',
  'guest': 'the corners of the boxes are rounded in ESC/POS and square in StarPRNT',
  'kitchen': 'the corners of the boxes are rounded in ESC/POS and square in StarPRNT',
  'column-border1': null,
  'column-border2': 'the corners of the box are rounded in ESC/POS and square in StarPRNT',
  'line-align': 'the corners of the boxes are rounded in ESC/POS and square in StarPRNT',
  'text-decoration': 'the corners of the box are rounded in ESC/POS and square in StarPRNT, ' +
    'and the underline is two dots thick in ESC/POS and one in StarPRNT',
  'text-wrap1': 'the corners of the box are rounded in ESC/POS and square in StarPRNT',
  'text-wrap2': 'the corners of the box are rounded in ESC/POS and square in StarPRNT',
  'text-wrap3': 'the corners of the box are rounded in ESC/POS and square in StarPRNT',
  'text-wrap4': 'the corners of the box are rounded in ESC/POS and square in StarPRNT',
};

/**
 * The document, the width and the encoding of a fixture name, which is what the
 * renders of a document have in common, and the command set, which is what
 * makes them differ
 *
 * @param  {string}   name   Name of the fixture
 * @return {object}          The document, the set, the columns and the key of the document
 */
function parse(name) {
  const match = name.match(/^(.+)-(escpos|generic|starsbcs|starlinesbcs|stargraphic)-(\d+)(-\w+)?$/);

  return match ?
    {
      document: match[1],
      set: match[2],
      columns: match[3],
      encoding: match[4] || '',
      key: `${match[1]}-${match[3]}${match[4] || ''}`,
    } :
    null;
}

describe('parity over the receiptline fixtures', function() {
  const documents = new Map();

  for (const name of fixtures('receiptline')) {
    const parsed = parse(name);

    if (!parsed) {
      continue;
    }

    if (!documents.has(parsed.key)) {
      documents.set(parsed.key, []);
    }

    documents.get(parsed.key).push(Object.assign({name}, parsed));
  }

  it('should recognise every fixture name', function() {
    assert.deepEqual(fixtures('receiptline').filter((name) => !parse(name)), []);
  });

  /* A key that names no document is a leftover of a fixture that was renamed or
     dropped, and it would silently stop checking anything */

  it('should have a fixture for every document the exception list names', function() {
    const known = new Set(
        [...documents.values()].map((list) => list[0].document),
    );

    assert.deepEqual(Object.keys(EXCEPTIONS).filter((document) => !known.has(document)), []);
  });

  for (const [key, list] of documents) {
    describe(key, function() {
      /* The stargraphic fixtures are the rasterized job receiptio sends, see
         section 16f: the receipt is one image drawn with the font of a browser,
         so it can never be dot for dot the paper the text command sets make of
         the same document. They are out of this comparison, where they have
         been since section 16, and they are checked structurally below */

      const groups = new Map();

      for (const entry of list) {
        const group = SETS[entry.set];

        if (group === 'raster') {
          continue;
        }

        if (!groups.has(group)) {
          groups.set(group, []);
        }

        groups.get(group).push(entry);
      }

      for (const [group, entries] of groups) {
        if (entries.length < 2) {
          continue;
        }

        it(`should render the same paper in every ${group} command set`, function() {
          const papers = entries.map((entry) => {
            const fixture = external('receiptline', entry.name);
            const items = new ReceiptPrinterRenderer(
                Object.assign(options(fixture.provenance), PARITY_OPTIONS),
            ).render(fixture.bytes);

            return {name: entry.name, paper: stitch(items, {width: fixture.provenance.width})};
          });

          for (const other of papers.slice(1)) {
            if (dots(other.paper) !== dots(papers[0].paper)) {
              assert.fail(
                  `${other.name} and ${papers[0].name} are not the same paper\n` +
                diff(other.paper, papers[0].paper),
              );
            }
          }
        });
      }

      if (groups.has('esc-pos') && groups.has('star')) {
        const document = list[0].document;
        const reason = EXCEPTIONS[document];

        it(reason ?
          `should differ between the languages, because ${reason}` :
          'should render the same paper in both languages', function() {
          const papers = ['esc-pos', 'star'].map((group) => {
            const entry = groups.get(group)[0];
            const fixture = external('receiptline', entry.name);
            const items = new ReceiptPrinterRenderer(
                Object.assign(options(fixture.provenance), PARITY_OPTIONS),
            ).render(fixture.bytes);

            return {name: entry.name, paper: stitch(items, {width: fixture.provenance.width})};
          });

          if (reason) {
            assert.notEqual(dots(papers[0].paper), dots(papers[1].paper));
            return;
          }

          if (dots(papers[0].paper) !== dots(papers[1].paper)) {
            assert.fail(
                `${papers[0].name} and ${papers[1].name} are not the same paper\n` +
              diff(papers[1].paper, papers[0].paper),
            );
          }
        });
      }
    });
  }
});

/*
    The rasterized stargraphic fixtures, section 16f.

    The ten stargraphic fixtures are not receiptline's library any more, they
    are the job receiptio sends a TSP100: receiptio rasterizes the whole receipt
    into one image and hands that image to the same command set, so the paper
    carries the receipt and not the blank paper the library alone emits.

    That paper cannot be compared dot for dot with the escpos and the starsbcs
    renders of the same document. receiptio draws the receipt with receiptline's
    SVG in a browser and this renderer draws it with Iosevka in a 12 by 24 cell,
    so every glyph differs and no exception list could hold that. What can be
    checked is that the receipt is there, that it is cut where the document cuts
    it and that it is about as long as the same document set in cells:

      - the same number of cut items as the escpos fixture of the same document
        and the same width,
      - a paper height within TOLERANCE of that fixture's height.

    The height of receiptio's image is receiptline's own SVG height, which comes
    out of the line count and not out of the font, so the tolerance carries the
    difference between a rasterized receipt and a typeset one and not the
    difference between two browsers. The ratios the ten fixtures have are in the
    notes of section 16f; the widest is a quarter.

    Both fixtures are rendered the way their provenance says, without the
    profile normalisation of the parity test above: the rasterized job is images
    and feeds, where a profile changes nothing at all.
*/

const TOLERANCE = 0.3;

describe('the rasterized receiptio fixtures', function() {
  const rasterized = fixtures('receiptline')
      .map((name) => Object.assign({name}, parse(name)))
      .filter((entry) => entry.set === 'stargraphic');

  it('should have the rasterized fixtures', function() {
    assert.isAbove(rasterized.length, 0);
  });

  for (const entry of rasterized) {
    describe(entry.name, function() {
      const counterpart = `${entry.document}-escpos-${entry.columns}${entry.encoding}`;

      it('should be the job of receiptio', function() {
        const provenance = external('receiptline', entry.name).provenance;

        assert.equal(provenance.source, 'https://github.com/receiptline/receiptio');
        assert.equal(provenance.language, 'star-graphics');
      });

      it(`should cut where ${counterpart} cuts`, function() {
        const ours = external('receiptline', entry.name);
        const theirs = external('receiptline', counterpart);

        assert.equal(
            ours.commands.filter((item) => item.type === 'cut').length,
            theirs.commands.filter((item) => item.type === 'cut').length,
        );
      });

      it(`should be as long as ${counterpart}, within ${TOLERANCE * 100} per cent`, function() {
        const ours = external('receiptline', entry.name);
        const theirs = external('receiptline', counterpart);

        const ratio = ours.paper.height / theirs.paper.height;

        assert.isTrue(
            Math.abs(ratio - 1) <= TOLERANCE,
            `${entry.name} is ${ours.paper.height} rows and ${counterpart} is ${theirs.paper.height}, ` +
            `a ratio of ${ratio.toFixed(3)}`,
        );
      });
    });
  }
});

/*
    Parity over the playground fixtures, section 16g.

    The sample scripts of the playground are encoded in both languages at both
    widths, so the same sample and the same width has to come out of the two
    renderers as the same paper. It is the parity test above over the encoder's
    own samples rather than another library's documents, and it is the check
    that a printer of either language prints the same receipt from the contact
    sheet.

    Both renders use the same profile, the way the receiptline parity does it,
    so that only the languages differ and not the printer family defaults: the
    two fixtures of a sample are not the same height without it, because the
    line spacing of the Star profile is not the Epson one.

    What the encoder itself writes differently per language is listed below,
    each entry with its reason. They are properties of the encoder's languages
    and of what the two printer families can be asked for, not of the renderers.
*/

const PLAYGROUND_EXCEPTIONS = {
  'text': 'the Arabic line is two characters different: the Star Arabic page has no ي, so the encoder ' +
    'writes a question mark for it, where the cp864 of ESC/POS carries the letter',
  'tables': null,
  'images': null,
  'barcodes': 'five barcodes of the sample are a different symbol in the two languages, all of them because ' +
    'the encoder asks the two printer families for the symbology in their own way: a Code 128 of digits ' +
    'only carries the {B code set selection on ESC/POS and none on StarPRNT, where the printer picks the ' +
    'paired code set C itself; an ITF is drawn with a wider module by the ESC/POS printer than by the Star ' +
    'one at the same width; a GS1-128 is the native symbology on ESC/POS and a Code 128 of the same data ' +
    'on StarPRNT, which is wider, and wider again when the application writes the AI in parentheses; and ' +
    'the GS1 DataBar omni, truncated and limited symbols have a larger module and a taller symbol on ' +
    'StarPRNT than on ESC/POS',
  'qrcode': null,
  'pdf417': null,
};

/**
 * The sample, the language and the columns of a playground fixture name
 *
 * @param  {string}   name   Name of the fixture
 * @return {object}          The sample, the language, the columns and the key of the pair
 */
function playground(name) {
  const match = name.match(/^(.+)-(esc-pos|star-prnt)-(\d+)$/);

  return match ?
    {
      sample: match[1],
      language: match[2],
      columns: match[3],
      key: `${match[1]}-${match[3]}`,
    } :
    null;
}

describe('parity over the playground fixtures', function() {
  const samples = new Map();

  for (const name of fixtures('playground')) {
    const parsed = playground(name);

    if (!parsed) {
      continue;
    }

    if (!samples.has(parsed.key)) {
      samples.set(parsed.key, []);
    }

    samples.get(parsed.key).push(Object.assign({name}, parsed));
  }

  it('should recognise every fixture name', function() {
    assert.deepEqual(fixtures('playground').filter((name) => !playground(name)), []);
  });

  it('should have a fixture for every sample the exception list names', function() {
    const known = new Set([...samples.values()].map((list) => list[0].sample));

    assert.deepEqual(Object.keys(PLAYGROUND_EXCEPTIONS).filter((sample) => !known.has(sample)), []);
  });

  it('should list every sample in the exception list, with or without a reason', function() {
    const known = [...new Set([...samples.values()].map((list) => list[0].sample))];

    assert.deepEqual(known.filter((sample) => !(sample in PLAYGROUND_EXCEPTIONS)), []);
  });

  for (const [key, list] of samples) {
    const languages = new Map(list.map((entry) => [entry.language, entry]));

    /* A sample that was captured in one language only has nothing to compare,
       which is a capture that was not finished rather than a failure */

    if (!languages.has('esc-pos') || !languages.has('star-prnt')) {
      continue;
    }

    describe(key, function() {
      const reason = PLAYGROUND_EXCEPTIONS[list[0].sample];

      it(reason ?
        `should differ between the languages, because ${reason}` :
        'should render the same paper in both languages', function() {
        const papers = ['esc-pos', 'star-prnt'].map((language) => {
          const entry = languages.get(language);
          const fixture = external('playground', entry.name);
          const items = new ReceiptPrinterRenderer(
              Object.assign(options(fixture.provenance), PARITY_OPTIONS),
          ).render(fixture.bytes);

          return {name: entry.name, paper: stitch(items, {width: fixture.provenance.width})};
        });

        if (reason) {
          assert.notEqual(dots(papers[0].paper), dots(papers[1].paper));
          return;
        }

        if (dots(papers[0].paper) !== dots(papers[1].paper)) {
          assert.fail(
              `${papers[0].name} and ${papers[1].name} are not the same paper\n` +
            diff(papers[1].paper, papers[0].paper),
          );
        }
      });
    });
  }
});
