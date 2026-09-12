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
  toPbm,
  toPng,
  toImageData,
  stitch,
} from '@point-of-sale/receipt-printer-renderer';

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
};

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
