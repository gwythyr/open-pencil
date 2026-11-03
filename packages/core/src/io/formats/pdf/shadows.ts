import { groupBy } from 'es-toolkit'
import { fromUint8Array } from 'js-base64'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { hasVisibleShadows, type ShadowType } from '#core/canvas/shadows'
import { IS_BROWSER } from '#core/constants'
import { preparedHeadlessRenderer, type HeadlessRenderer } from '#core/io/formats/raster/headless'
import { renderShadowImage, type ShadowImage } from '#core/io/formats/raster/shadows'
import type {
  SVGFontAlias,
  SVGShadowImage,
  SVGShadowImageLookup,
  SVGShadowImages
} from '#core/io/formats/svg'
import { textFaceAliased } from '#core/io/formats/svg/text/export'
import type { IOContext } from '#core/io/types'

import type { PDFPageSpec } from './plan'

/** Pixels per PDF point shadows are drawn at: 144 per inch. */
const PDF_SHADOW_SCALE = 2

/** The visible layers of these nodes that cast shadows, as the SVG of a page draws them. */
function shadowCasters(graph: SceneGraph, nodeIds: readonly string[]): SceneNode[] {
  const casters: SceneNode[] = []
  const visit = (node: SceneNode): void => {
    if (!node.visible) return
    if (hasVisibleShadows(node)) casters.push(node)
    for (const child of graph.getChildren(node.id)) visit(child)
  }
  for (const id of nodeIds) {
    const node = graph.getNode(id)
    if (node) visit(node)
  }
  return casters
}

/** Whether the layer or one around it fades as a whole, which a PDF does to each part apart. */
function fadedAsWhole(graph: SceneGraph, node: SceneNode): boolean {
  return graph.closest(node.id, (layer) => layer.opacity < 1) !== undefined
}

function svgShadowImage(image: ShadowImage | null): SVGShadowImage | undefined {
  if (!image) return undefined
  return { href: `data:image/png;base64,${fromUint8Array(image.data)}`, ...image.box }
}

/**
 * The layer's shadow images. Text casts from the glyphs CanvasKit draws, which only line up with
 * the PDF's own glyphs from the outside: an inner shadow is left out. A failure leaves the layer's
 * shadows out rather than the whole PDF.
 */
function shadowImages(
  { ck, renderer }: HeadlessRenderer,
  graph: SceneGraph,
  node: SceneNode
): SVGShadowImages {
  const cutOut = fadedAsWhole(graph, node)
  const draw = (type: ShadowType) => {
    try {
      return svgShadowImage(
        renderShadowImage(ck, renderer, graph, node, type, { scale: PDF_SHADOW_SCALE, cutOut })
      )
    } catch {
      return undefined
    }
  }
  return {
    drop: draw('DROP_SHADOW'),
    inner: node.type === 'TEXT' ? undefined : draw('INNER_SHADOW')
  }
}

/**
 * The renderer that draws a design page: the editor's own, which already has the document loaded,
 * or the headless one prepared for these nodes. Null where CanvasKit cannot load, and in a browser
 * without the editor's, where the headless one would lay out the live document and load its own.
 */
async function pageRenderer(
  graph: SceneGraph,
  pageId: string,
  nodeIds: string[],
  context: IOContext | undefined
): Promise<HeadlessRenderer | null> {
  if (context?.canvasKit && context.renderer) {
    return { ck: context.canvasKit, renderer: context.renderer }
  }
  if (IS_BROWSER) return null
  return preparedHeadlessRenderer(graph, pageId, nodeIds).catch(() => null)
}

/**
 * The shadows of the pages' layers drawn as the canvas draws them, since PDF cannot blur and
 * svg2pdf.js leaves SVG filters out; the layers themselves stay vectors. Text keeps its drop
 * shadow only where the PDF writes it in its own face, as `fontAlias` names the faces it embeds;
 * in another font the shadow would not follow the glyphs. Undefined when no layer casts a shadow,
 * so CanvasKit only loads for pages that need it, and when it cannot load.
 */
export async function renderPDFShadows(
  graph: SceneGraph,
  specs: readonly PDFPageSpec[],
  context?: IOContext,
  fontAlias?: SVGFontAlias
): Promise<SVGShadowImageLookup | undefined> {
  const images = new Map<string, SVGShadowImages>()
  // Each design page is prepared once, however many PDF pages its layers make.
  for (const [pageId, pageSpecs] of Object.entries(groupBy(specs, (spec) => spec.pageId))) {
    const nodeIds = pageSpecs.flatMap((spec) => spec.nodeIds)
    const casters = shadowCasters(graph, nodeIds)
    if (casters.length === 0) continue
    const renderer = await pageRenderer(graph, pageId, nodeIds, context)
    if (!renderer) break
    for (const node of casters) images.set(node.id, shadowImages(renderer, graph, node))
  }
  if (images.size === 0) return undefined
  return (node) => {
    const found = images.get(node.id)
    if (node.type !== 'TEXT' || !found) return found
    return fontAlias && textFaceAliased(node, fontAlias) ? found : null
  }
}
