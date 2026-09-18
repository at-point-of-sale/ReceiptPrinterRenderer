/*
    TypeScript smoke test.

    Compiled with `npm run test:types`, which runs tsc against the bundled
    declarations in dist. It is not run by mocha, it never runs at all: the
    point is that the declaration file describes the package well enough to
    write an application against it.
*/

import ReceiptPrinterRenderer, {
  ReceiptPrinterRenderer as NamedReceiptPrinterRenderer,
  EscPosRenderer,
  StarPrntRenderer,
  rasterize,
  pieces,
  toPbm,
  toPng,
  toImageData,
  stitch,
} from '@point-of-sale/receipt-printer-renderer';

import toSvgDefault, {toSvg} from '@point-of-sale/receipt-printer-renderer/svg';

import type {SvgOptions} from '@point-of-sale/receipt-printer-renderer/svg';

import type {
  Bitmap,
  RenderItem,
  ImageItem,
  CutItem,
  PulseItem,
  FeedItem,
  UnknownItem,
  RenderCommand,
  RenderLanguage,
  RendererOptions,
  ReceiptPrinterRendererOptions,
  StitchOptions,
  Layout,
  LayoutEntry,
  LineEntry,
  PageEntry,
  PageArea,
  FeedEntry,
  CutEntry,
  PulseEntry,
  UnknownEntry,
  UnsupportedEntry,
  PrinterCapabilities,
  LineOperation,
  TextOperation,
  RectOperation,
  ImageOperation,
  TextStyle,
  Source,
  RasterizeOptions,
} from '@point-of-sale/receipt-printer-renderer';

/* The static language property, which drivers report in their connected event */

const languages: string[] = [EscPosRenderer.language, StarPrntRenderer.language];

/* And the languages of the unified renderer */

const supported: RenderLanguage[] = ReceiptPrinterRenderer.languages;

/* Constructing a renderer */

const commands: RenderCommand[] = ['cut', 'pulse', 'feed'];

const options: RendererOptions = {
  width: 576,
  codepageMapping: 'epson',
  commands,
  maxHeight: 1024,
  feedThreshold: 24,
  cutterDistance: 0,
  capabilities: {
    barcodes: {supported: true, symbologies: ['ean13']},
    qrcode: {supported: false, models: []},
    pdf417: {supported: false},
    images: {mode: 'raster'},
    fonts: {A: {size: '12x24', columns: 48}, B: {size: '9x24', columns: 64}},
  },
};

/* The capabilities of a printer, the encoder's object as the renderer takes it */

const capabilities: PrinterCapabilities = {barcodes: {supported: false}};

void capabilities;

const escpos = new EscPosRenderer(options);
const star = new StarPrntRenderer({width: 576, codepageMapping: 'star', commands});

const columns: number = escpos.columns + star.columns;

/* The unified renderer, which takes the same options plus the language, the
   way a driver constructs it */

const rendererOptions: ReceiptPrinterRendererOptions = {
  language: 'star-line',
  width: 576,
  codepageMapping: 'star',
  commands,
};

const renderer: ReceiptPrinterRenderer = new ReceiptPrinterRenderer(rendererOptions);
const fallback = new NamedReceiptPrinterRenderer({width: 384});

/* The raster protocol of a TSP100 is a language of its own, which is what a
   driver resolves from the profile of one */

const graphics: ReceiptPrinterRenderer = new ReceiptPrinterRenderer({
  language: 'star-graphics',
  width: 576,
  codepageMapping: 'star',
  commands,
});

const language: RenderLanguage = renderer.language;
const total: number = renderer.columns + fallback.columns;

/* Rendering, from a Uint8Array and from an array of numbers */

const items: RenderItem[] = escpos.render(new Uint8Array([0x1b, 0x40, 0x41, 0x0a]));
const more: RenderItem[] = star.render([0x1b, 0x40, 0x41, 0x0a]);
const unified: RenderItem[] = renderer.render(new Uint8Array([0x1b, 0x40, 0x41, 0x0a]));

/* The renderers and the helpers are static properties as well, which is how
   the UMD global reaches them */

const attached: typeof EscPosRenderer = ReceiptPrinterRenderer.EscPosRenderer;
const attachedStar: typeof StarPrntRenderer = ReceiptPrinterRenderer.StarPrntRenderer;
const attachedStitch: typeof stitch = ReceiptPrinterRenderer.stitch;

/* Narrowing the items by their type */

const images: ImageItem[] = [];

for (const item of items.concat(more).concat(unified)) {
  switch (item.type) {
    case 'image': {
      const image: ImageItem = item;
      const size: number = image.width * image.height + image.data.length;
      images.push(image);
      void size;
      break;
    }

    case 'cut': {
      const cut: CutItem = item;
      const full: boolean = cut.value === 'full';
      void full;
      break;
    }

    case 'pulse': {
      const pulse: PulseItem = item;
      const duration: number = pulse.device + pulse.on + pulse.off;
      void duration;
      break;
    }

    case 'feed': {
      const feed: FeedItem = item;
      const height: number = feed.height;
      void height;
      break;
    }

    case 'unknown': {
      const unknown: UnknownItem = item;
      const bytes: Uint8Array = unknown.data;
      void bytes;
      break;
    }
  }
}

/* An image item is a bitmap, which is what the helpers take */

const first: Bitmap = images[0];

/* Stitching a whole receipt into one bitmap */

const stitchOptions: StitchOptions = {cutMarker: true, feed: true, width: 576};

const paper: Bitmap = stitch(items, stitchOptions);
const plain: Bitmap = stitch(items);

/* The image format helpers */

const pbm: Uint8Array = toPbm(paper);
const png: Promise<Uint8Array> = toPng(paper);
const pixels: ImageData = toImageData(paper);
const withConstructor: ImageData = toImageData(first, ImageData);

void languages;
void supported;
void columns;
void language;
void graphics;
void total;
void attached;
void attachedStar;
void attachedStitch;
void plain;
void pbm;
void png;
void pixels;
void withConstructor;

/* The display list, which layout() returns on all three renderer classes */

const commandBytes = new Uint8Array([0x1b, 0x40, 0x41, 0x0a]);

const list: Layout = renderer.layout(commandBytes);
const escposList: Layout = escpos.layout(commandBytes);
const starList: Layout = star.layout([0x1b, 0x40, 0x41, 0x0a]);

const version: number = list.version;
const listLanguage: RenderLanguage = list.language;
const listWidth: number = list.width;
const listHeight: number = list.height;
const dpi: number = list.dpi;

for (const entry of list.entries) {
  const box: LayoutEntry = entry;

  switch (box.type) {
    case 'line': {
      const line: LineEntry = box;
      const rotation: number = line.rotation;

      for (const operation of line.operations) {
        const one: LineOperation = operation;

        /* Every operation says which bytes of the stream it came from */

        const from: Source = one.source;
        const offset: number = from.offset;
        const length: number = from.length;

        void offset;
        void length;

        if (one.type === 'text') {
          const cell: TextOperation = one;
          const style: TextStyle = cell.style;
          const point: number | undefined = cell.codepoint;
          const dots: Bitmap | undefined = cell.bitmap;
          const baseline: number = cell.baseline;

          void style;
          void point;
          void dots;
          void baseline;
        }

        if (one.type === 'rect') {
          const rectangle: RectOperation = one;
          void rectangle.width;
        }

        if (one.type === 'image') {
          const picture: ImageOperation = one;
          void picture.data;
        }
      }

      void rotation;
      break;
    }

    case 'page': {
      const page: PageEntry = box;

      for (const area of page.areas) {
        const one: PageArea = area;
        const direction: number = one.direction;
        const inside: (LineEntry | FeedEntry)[] = one.entries;

        void direction;
        void inside;
      }

      break;
    }

    case 'feed': {
      const feed: FeedEntry = box;

      /* The blank paper of a cutter distance came from no bytes at all, so a
         feed is the one entry whose source can be null */

      const fed: Source | null = feed.source;
      void feed.height;
      void fed;
      break;
    }

    case 'cut': {
      const cut: CutEntry = box;
      void cut.value;
      break;
    }

    case 'pulse': {
      const pulse: PulseEntry = box;
      void pulse.device;
      break;
    }

    case 'unknown': {
      const unknown: UnknownEntry = box;
      void unknown.data;
      break;
    }

    case 'unsupported': {
      const unsupported: UnsupportedEntry = box;
      const what: string = unsupported.what;
      void what;
      break;
    }
  }
}

/* And the display list drawn again, through the named export and the static */

const rasterizeOptions: RasterizeOptions = {commands, maxHeight: 1024, feedThreshold: 24};

const drawn: RenderItem[] = rasterize(list, rasterizeOptions);
const drawnAgain: RenderItem[] = ReceiptPrinterRenderer.rasterize(list);
const split: Layout[] = pieces(list);
const splitAgain: Layout[] = ReceiptPrinterRenderer.pieces(list);

void escposList;
void starList;
void version;
void listLanguage;
void listWidth;
void listHeight;
void dpi;
void drawn;
void drawnAgain;

/* And the SVG sub-entry, which takes the same list and writes a document */

const svgOptions: SvgOptions = {units: 'mm', cutMarker: true, background: null, ink: '#222'};

const svg: string = toSvg(list, svgOptions);
const svgAgain: string = toSvgDefault(list);
const perPiece: string[] = pieces(list).map((piece: Layout) => toSvg(piece, svgOptions));

void svg;
void svgAgain;
void perPiece;
void split;
void splitAgain;
