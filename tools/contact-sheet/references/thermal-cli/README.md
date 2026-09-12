# thermal-cli

The shim that lets `npm run contact-sheet` show what
[thermal](https://github.com/zachzurn/thermal) makes of the external fixtures,
see section 16b of the implementation plan.

thermal is a library and renders its own samples from a test, so it ships no
binary. This crate is the smallest program that calls its two renderers on a
file: it writes the PNG of `ImageRenderer` and, when a third argument is given,
the HTML of `HtmlRenderer`. The library is pinned by commit in `Cargo.toml`, so
nothing has to be checked out first.

It is not part of this package: no `npm` script builds it, nothing in `npm test`
needs it, and the contact sheet says "not available" when the binary is not
there.

Build it with a Rust toolchain, from this directory:

    CARGO_TARGET_DIR=../../../../build/references/thermal-cli cargo build --release
    cp ../../../../build/references/thermal-cli/release/thermal-cli \
       ../../../../build/references/thermal-bin

`build/` is gitignored, and `tools/contact-sheet/references/thermal.js` looks
for the binary there, or at `$RENDERER_THERMAL`.
