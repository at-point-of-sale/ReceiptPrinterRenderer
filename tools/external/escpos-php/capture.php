<?php
/**
 * Capture the byte streams of the escpos-php examples, section 16.
 *
 * The examples of escpos-php print to a FilePrintConnector on php://stdout, so
 * running one with the output captured gives the stream a printer would get.
 * This script runs every example that works without hardware or an extension
 * this machine does not have, and writes what came out to
 * test/fixtures/external/escpos-php/<example>.bin.
 *
 * The examples are not copied into this repository: they ship with the package,
 * and the provenance names the repository, the file and the commit of the tag.
 *
 * Install the package where this script looks for it, then run it:
 *
 *     composer require mike42/escpos-php:v2.2 -d build/external/escpos-php
 *     php tools/external/escpos-php/capture.php
 *
 * Then render what it wrote, which is what freezes the fixtures:
 *
 *     node tools/external/escpos-php/capture.js
 *
 * Nothing here runs during npm test.
 *
 * @author The ReceiptPrinterRenderer authors
 */

/* The commit of the v2.2 tag, which is the version composer installs above */

const COMMIT = 'e5496cf819b048b11877117bd14a9cea4fb17c03';

const SOURCE = 'https://github.com/mike42/escpos-php';

const VERSION = 'v2.2';

/* What has to be installed before this script runs, as the provenance records
   it next to the command */

const SETUP = 'composer require mike42/escpos-php:v2.2 -d build/external/escpos-php';

$root = dirname(__DIR__, 3);

$package = $root . '/build/external/escpos-php/vendor/mike42/escpos-php';

$fixtures = $root . '/test/fixtures/external/escpos-php';

$downloads = $root . '/build/external/escpos-php';

/*
    The examples that run without hardware, without a network service and
    without an extension beyond gd, with what each of them exercises.
*/

$examples = [
    'demo' => ['text', 'fonts', 'justification', 'underline', 'emphasis', 'sizes', 'cut', 'pulse', 'barcodes'],
    'barcode' => ['GS k barcodes of every symbology', 'barcode height, width and text position'],
    'character-encodings' => ['ESC t codepage switching through its own encoding'],
    'character-tables' => ['ESC t codepage switching', 'every byte of the first codepages'],
    'margins-and-spacing' => ['GS L left margin', 'GS W print area width', 'ESC 3 line spacing'],
    'pdf417-code' => ['GS ( k PDF417, every option'],
    'qr-code' => ['GS ( k QR codes, every model, size and correction level'],
    'text-size' => ['GS ! character sizes'],
];

/* What the review of the first golden image found, per example */

$reviews = [
    'character-encodings' => 'The Latin, Greek, Cyrillic and Vietnamese lines all print with their accents, '
        . 'which is the codepage switching working end to end. The half width Katakana line and the Thai line '
        . 'print the fallback box: there is no CJK or Thai font here, as the reference pages say. The Hiragana, '
        . 'full width Katakana, Arabic and Hebrew lines are question marks and boxes in the stream itself, '
        . 'escpos-php could not encode them either.',
    'demo' => 'The reverse feed of ESC e is reported and not performed, so the second line sits three lines '
        . 'lower than it would on paper. The two "Failed to load image" lines are the example\'s own output, '
        . 'its image loader returns an empty image on this PHP.',
    'barcode' => 'Every symbology, height, module width and text position of the example prints. The Code 128 '
        . 'row of code set C sends the value of every digit pair behind {C, one byte each, which is the reading '
        . 'the renderer took from this capture and from receiptline, see the notes of section 16.',
];

/* The examples of the directory that are not captured, with the reason */

$skipped = [
    'customer-display' => 'opens /dev/ttyACM0, a serial display',
    'print-from-pdf' => 'needs the imagick extension',
    'rawbt-receipt' => 'uses an undefined variable and stops',
    'receipt-with-logo' => 'needs a class the example directory does not carry',
    'bit-image' => 'its images load as empty, see the note below',
    'graphics' => 'its images load as empty, see the note below',
    'character-encodings-with-images' => 'its images load as empty, see the note below',
    'print-from-html' => 'its images load as empty, see the note below',
];

/*
    The four image examples are skipped because the EscposImage loader of
    escpos-php 2.2 returns a zero by zero image on PHP 8.4 with the gd of this
    machine, so they print an error and no image: there is nothing to capture.
    They are the examples that would exercise ESC *, GS v 0 and GS ( L, which
    the python-escpos fixtures cover instead.
*/

if (!is_dir($package)) {
    fwrite(STDERR, "No escpos-php in $package, run the composer command in the comment at the top\n");
    exit(1);
}

if (!is_dir($fixtures)) {
    mkdir($fixtures, 0777, true);
}

$only = array_slice($argv, 1);
$index = [];

echo "escpos-php " . VERSION . "\n";

foreach ($examples as $name => $features) {
    if ($only && !in_array($name, $only, true)) {
        continue;
    }

    $script = "$package/example/$name.php";

    /* The example writes to php://stdout, so the stream is what a subprocess
       prints. PHP writes its own notices there as well, and escpos-php 2.2 has
       deprecations on PHP 8.4, so the subprocess is told to send them to stderr
       instead; otherwise they land in the middle of the byte stream. */

    $descriptors = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $command = [PHP_BINARY, '-d', 'display_errors=stderr', $script];
    $process = proc_open($command, $descriptors, $pipes, dirname($script));

    $output = stream_get_contents($pipes[1]);
    $errors = stream_get_contents($pipes[2]);

    fclose($pipes[1]);
    fclose($pipes[2]);

    $status = proc_close($process);

    if ($status !== 0) {
        fwrite(STDERR, "  $name failed: " . substr($errors, 0, 200) . "\n");
        continue;
    }

    file_put_contents("$fixtures/$name.bin", $output);

    $index[$name] = [
        'file' => "example/$name.php",
        'commit' => COMMIT,
        'source' => SOURCE,
        'version' => VERSION,
        'features' => $features,
        'review' => $reviews[$name] ?? null,
        'setup' => SETUP,
    ];

    printf("  %-34s %7d bytes\n", $name, strlen($output));
}

/* The entries are merged into what is there, so that capturing one example
   again does not throw the index of the others away */

$path = "$downloads/index.json";
$merged = file_exists($path) ? json_decode(file_get_contents($path), true) : [];

file_put_contents($path, json_encode(array_merge($merged, $index), JSON_PRETTY_PRINT) . "\n");

echo "\nskipped: ";
echo implode(', ', array_map(fn($name, $reason) => "$name ($reason)", array_keys($skipped), $skipped));
echo "\n";
