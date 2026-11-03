import { expect, setDefaultTimeout, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { toUint8Array } from 'js-base64'

import { SceneGraph, type Effect, type SceneNode } from '@open-pencil/scene-graph'

import { getCanvasKit } from '#core/canvaskit'
import { exportPDFDocument } from '#core/io/formats/pdf'
import { renderPDFShadows } from '#core/io/formats/pdf/shadows'
import { createCanvasKitRasterCodec } from '#core/io/formats/raster'
import type { SVGShadowImage } from '#core/io/formats/svg'

setDefaultTimeout(60_000)

const SHADOW_COLOR = { r: 0, g: 0, b: 0, a: 0.5 }

/** An 80×60 blue card on a page, with these effects. */
function card(effects: Effect[], props: Partial<SceneNode> = {}) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const node = graph.createNode('RECTANGLE', pageId, {
    name: 'Card',
    width: 80,
    height: 60,
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 1, visible: true }],
    effects,
    ...props
  })
  return { graph, node, spec: { pageId, nodeIds: [node.id] } }
}

const DROP: Effect = {
  type: 'DROP_SHADOW',
  color: SHADOW_COLOR,
  offset: { x: 0, y: 10 },
  radius: 4,
  spread: 0,
  visible: true
}

const INNER: Effect = {
  type: 'INNER_SHADOW',
  color: SHADOW_COLOR,
  offset: { x: 0, y: 10 },
  radius: 4,
  spread: 0,
  visible: true
}

/** The alpha of the shadow image at a point in the layer's coordinates. */
async function alphaAt(image: SVGShadowImage, x: number, y: number): Promise<number> {
  const png = toUint8Array(image.href.slice(image.href.indexOf(',') + 1))
  const decoded = expectDefined(createCanvasKitRasterCodec(await getCanvasKit()).decode(png), 'PNG')
  const column = Math.floor(((x - image.x) / image.width) * decoded.width)
  const row = Math.floor(((y - image.y) / image.height) * decoded.height)
  return decoded.data[(row * decoded.width + column) * 4 + 3]
}

/** Whether a PDF embeds an image: an XObject whose dictionary stays uncompressed. */
function embedsImage(pdf: Uint8Array): boolean {
  return new TextDecoder('latin1').decode(pdf).includes('/Subtype /Image')
}

test('draws a drop shadow as the canvas casts it, past the layer and under it', async () => {
  const { graph, node, spec } = card([DROP])
  const lookup = expectDefined(await renderPDFShadows(graph, [spec]), 'shadow images')
  const images = expectDefined(lookup(node), 'card shadows')
  const drop = expectDefined(images.drop, 'drop shadow')
  expect(images.inner).toBeUndefined()
  // The image reaches past the card by the offset and the blur on every side it casts to.
  expect(drop.y + drop.height).toBeGreaterThanOrEqual(node.height + 10)
  expect(drop.x).toBeLessThan(0)
  // Below the card, where the shadow falls, but not above it, where it is offset away from.
  expect(await alphaAt(drop, 40, 64)).toBeGreaterThan(60)
  expect(await alphaAt(drop, 40, -4)).toBe(0)
})

test('draws an inner shadow inside the layer, on the side its offset leaves', async () => {
  const { graph, node, spec } = card([INNER])
  const lookup = expectDefined(await renderPDFShadows(graph, [spec]), 'shadow images')
  const inner = expectDefined(lookup(node)?.inner, 'inner shadow')
  expect(await alphaAt(inner, 40, 2)).toBeGreaterThan(60)
  expect(await alphaAt(inner, 40, 55)).toBe(0)
})

test('cuts a faded layer out of its drop shadow, which the PDF would show through it', async () => {
  const opaque = card([DROP])
  const faded = card([DROP], { opacity: 0.5 })
  const shadowUnder = async ({ graph, node, spec }: ReturnType<typeof card>) => {
    const lookup = expectDefined(await renderPDFShadows(graph, [spec]), 'shadow images')
    return alphaAt(expectDefined(lookup(node)?.drop, 'drop shadow'), 40, 40)
  }
  // Under an opaque layer the shadow is covered; under a faded one it would show.
  expect(await shadowUnder(opaque)).toBeGreaterThan(60)
  expect(await shadowUnder(faded)).toBe(0)
})

test('leaves out shadows of text the PDF writes in another face', async () => {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const text = graph.createNode('TEXT', pageId, {
    text: 'Shadow',
    fontFamily: 'Inter',
    fontSize: 32,
    width: 120,
    height: 40,
    effects: [DROP, INNER]
  })
  const spec = { pageId, nodeIds: [text.id] }
  // Without embedded fonts the PDF writes the text in a standard face.
  const lookup = expectDefined(await renderPDFShadows(graph, [spec]), 'shadow images')
  expect(lookup(text)).toBeNull()
  // In its own face it keeps its drop shadow; an inner one cannot follow the PDF's glyphs.
  const embedded = expectDefined(
    await renderPDFShadows(graph, [spec], undefined, () => 'EmbeddedFont0'),
    'shadow images'
  )
  expect(embedded(text)?.drop).toBeDefined()
  expect(embedded(text)?.inner).toBeUndefined()
})

test('draws no shadow images for pages whose layers cast none', async () => {
  const { graph, spec } = card([])
  expect(await renderPDFShadows(graph, [spec])).toBeUndefined()
})

test('embeds the shadow images in the PDF, without a browser DOM', async () => {
  const shadowed = card([DROP])
  const plain = card([])
  const [withShadow, without] = await Promise.all([
    exportPDFDocument(shadowed.graph, [shadowed.spec], { embedFonts: false }),
    exportPDFDocument(plain.graph, [plain.spec], { embedFonts: false })
  ])
  expect(embedsImage(expectDefined(withShadow, 'PDF').data)).toBe(true)
  expect(embedsImage(expectDefined(without, 'PDF').data)).toBe(false)
  expect('Image' in globalThis).toBe(false)
})
