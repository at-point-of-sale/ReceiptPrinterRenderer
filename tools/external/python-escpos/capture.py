#!/usr/bin/env python3

"""Capture the byte streams of the python-escpos examples, section 16.

python-escpos has a ``Dummy`` printer that collects the bytes a script writes
without a device, so an example runs without hardware.  This script fetches the
examples of its repository at a pinned commit, runs each of them against a
``Dummy`` and writes what came out to
``test/fixtures/external/python-escpos/<example>.bin``.

The examples that construct a ``Usb`` printer are run with a ``Dummy`` of the
same profile instead; nothing else about them is changed.  The examples that
need a network service are not captured, see SKIPPED below.

Run it in a throwaway virtual environment with the library installed from the
same commit as the examples, so that the two match; the provenance records the
version that reports:

    python3 -m venv build/external/python-escpos/venv
    build/external/python-escpos/venv/bin/pip install \
        "git+https://github.com/python-escpos/python-escpos@f5ed42f2dcd1c19cfedb2e186a616701fa41ece8"
    build/external/python-escpos/venv/bin/python tools/external/python-escpos/capture.py

Then render what it wrote, which is what freezes the fixtures:

    node tools/external/python-escpos/capture.js

Nothing here runs during npm test.
"""

import json
import pathlib
import runpy
import sys
import urllib.request

import escpos.printer
from escpos.version import version as escpos_version

# The commit of the repository the examples are taken from

COMMIT = "f5ed42f2dcd1c19cfedb2e186a616701fa41ece8"

SOURCE = "https://github.com/python-escpos/python-escpos"

RAW = "https://raw.githubusercontent.com/python-escpos/python-escpos"

# Where this script lives, and the two directories it uses

ROOT = pathlib.Path(__file__).resolve().parents[3]

FIXTURES = ROOT / "test" / "fixtures" / "external" / "python-escpos"

# The examples are downloaded here, outside the repository, and not committed

DOWNLOADS = ROOT / "build" / "external" / "python-escpos"

# The virtual environment this script runs in, as the provenance records it: the
# interpreter of `command`, and the two steps of `setup` that build it

VENV = "build/external/python-escpos/venv"

PYTHON = f"{VENV}/bin/python"

SETUP = (
    f"python3 -m venv {VENV} && "
    f'{VENV}/bin/pip install "git+{SOURCE}@{COMMIT}"'
)

# The examples that run against a Dummy printer without hardware or network.
# `argv` is what the example is given on the command line, `assets` are the
# files it reads next to itself, and `features` is what it exercises, which the
# provenance records.

EXAMPLES = {
    "barcodes": {
        "file": "examples/barcodes.py",
        "features": ["hardware barcodes", "software barcodes", "GS k Code 39"],
    },
    "block_text": {
        "file": "examples/block_text.py",
        "features": ["ESC ! print modes", "custom size", "underline", "block text", "partial cut"],
    },
    "font_variations": {
        "file": "examples/font_variations.py",
        "features": ["ESC ! print modes", "GS ! sizes", "bold", "underline", "alignment", "partial cut"],
    },
    "qr_code": {
        "file": "examples/qr_code.py",
        "argv": ["https://github.com/python-escpos/python-escpos"],
        "features": ["GS ( k native QR code", "centring"],
    },
    "receipt": {
        "file": "examples/receipt.py",
        "assets": ["examples/graphics/receipt/hocus-pocus.gif", "examples/graphics/receipt/creature5.gif"],
        "features": ["images", "line spacing", "GS ! sizes", "bold", "underline",
                     "alignment", "software columns", "partial cut"],
    },
    "software_barcode": {
        "file": "examples/software_barcode.py",
        "features": ["software barcodes as bitImageRaster", "software barcodes as the default image implementation"],
    },
    "software_columns": {
        "file": "examples/software_columns.py",
        "features": ["software columns", "font A"],
    },
}

# The examples of the directory that are not captured, with the reason

SKIPPED = {
    "weather": "fetches a forecast over the network",
    "docker-flask": "a web service, not a receipt",
    "codepage_tables": "passes strings to _raw(), which Dummy.output cannot join in this version",
}

# The printer classes that are replaced with a Dummy while an example runs

PRINTERS = ["Dummy", "Usb", "Network", "Serial", "File", "CupsPrinter", "LP", "Win32Raw"]

# The printer a Usb example is given instead of its device, per example. An
# example that constructs its own Dummy keeps the profile it asks for.

USB_PROFILES = {
    "barcodes": "TM-T88II",
    "qr_code": "POS-5890",
}


def download(path):
    """Fetch a file of the repository at the pinned commit, cached on disk."""
    target = DOWNLOADS / path

    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)

        with urllib.request.urlopen(f"{RAW}/{COMMIT}/{path}") as response:
            target.write_bytes(response.read())

    return target


def capture(name, example):
    """Run one example against a Dummy printer and return what it wrote."""
    script = download(example["file"])

    for asset in example.get("assets", []):
        download(asset)

    created = []

    class Captured(escpos.printer.Dummy):
        """A Dummy that registers itself, so that the bytes can be collected."""

        def __init__(self, *args, **kwargs):
            profile = kwargs.get("profile") or USB_PROFILES.get(name)
            super().__init__(profile=profile)
            created.append(self)

    # Every printer class an example may construct becomes this Dummy, so that
    # the example runs unchanged and without a device. The originals are put
    # back afterwards, so that the next example subclasses the library's own
    # Dummy again instead of the one of the example before it

    patched = [name for name in PRINTERS if hasattr(escpos.printer, name)]
    originals = {name: getattr(escpos.printer, name) for name in patched}

    argv = sys.argv
    sys.argv = [str(script)] + example.get("argv", [])

    try:
        for attribute in patched:
            setattr(escpos.printer, attribute, Captured)

        runpy.run_path(str(script), run_name="__main__")
    finally:
        for attribute, original in originals.items():
            setattr(escpos.printer, attribute, original)

        sys.argv = argv

    if not created:
        raise RuntimeError(f"{name} created no printer")

    output = b"".join(printer.output for printer in created)

    profile = created[0].profile

    return output, profile


def main():
    """Capture every example this script was asked for."""
    only = sys.argv[1:]
    names = [name for name in EXAMPLES if not only or name in only]

    if not names:
        raise SystemExit(f"No such example, one of {', '.join(EXAMPLES)}")

    FIXTURES.mkdir(parents=True, exist_ok=True)

    index = {}

    print(f"python-escpos {escpos_version}")

    for name in names:
        example = EXAMPLES[name]
        output, profile = capture(name, example)

        (FIXTURES / f"{name}.bin").write_bytes(output)

        media = profile.profile_data.get("media", {}).get("width", {}).get("pixels")
        columns = profile.get_columns("a")

        index[name] = {
            "file": example["file"],
            "commit": COMMIT,
            "source": SOURCE,
            "version": escpos_version,
            "profile": profile.profile_data.get("name") or "default",
            "columns": columns,
            "media": media if isinstance(media, int) else None,
            "argv": example.get("argv", []),
            "features": example["features"],
            "usb": name in USB_PROFILES,
            "setup": SETUP,
            "python": PYTHON,
        }

        print(f"  {name:<24} {len(output):>7} bytes  profile {index[name]['profile']}")

    # What the Node side needs to write the provenance, next to the streams. The
    # entries are merged into what is there, so that capturing one example again
    # does not throw the index of the others away

    path = DOWNLOADS / "index.json"
    merged = json.loads(path.read_text()) if path.exists() else {}

    merged.update(index)

    path.write_text(json.dumps(merged, indent=2) + "\n")

    print(f"\nskipped: {', '.join(f'{name} ({reason})' for name, reason in SKIPPED.items())}")


if __name__ == "__main__":
    main()
