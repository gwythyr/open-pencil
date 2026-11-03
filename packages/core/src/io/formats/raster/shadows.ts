import type { CanvasKit } from 'canvaskit-wasm'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { SkiaRenderer } from '#core/canvas'
import { drawForExport } from '#core/canvas/renderer/pipeline'
import {
  cutOutSilhouette,
  renderShadowsAlone,
  shadowsBounds,
  type ShadowType
} from '#core/canvas/shadows'

/** Most pixels one shadow image holds, and its longest side; a larger one is drawn smaller. */
const MAX_SHADOW_PIXELS = 4096 * 4096
const MAX_SHADOW_SIDE = 16384

export interface ShadowImageOptions {
  /** Pixels per unit of the layer. */
  scale: number
  /** Erase what the layer covers from its drop shadows, for a layer faded as a whole. */
  cutOut?: boolean
}

export interface ShadowImage {
  /** A PNG of the shadows alone, transparent elsewhere. */
  data: Uint8Array
  /** Where the image goes, in the layer's own coordinates. */
  box: Rect
}

/**
 * The layer's shadows of a type as the canvas draws them, without the layer itself, for outputs
 * that keep the layer as vectors but cannot blur, such as PDF. Null when it casts none. Drawn
 * alone, a shadow with a blend mode loses what it blends with and draws as normal.
 */
export function renderShadowImage(
  ck: CanvasKit,
  renderer: SkiaRenderer,
  graph: SceneGraph,
  node: SceneNode,
  type: ShadowType,
  { scale, cutOut = false }: ShadowImageOptions
): ShadowImage | null {
  const bounds = shadowsBounds(graph, node, type)
  if (!bounds) return null
  const x = Math.floor(bounds.x)
  const y = Math.floor(bounds.y)
  const width = Math.ceil(bounds.x + bounds.width) - x
  const height = Math.ceil(bounds.y + bounds.height) - y
  if (width <= 0 || height <= 0) return null

  const fitted = Math.min(
    scale,
    Math.sqrt(MAX_SHADOW_PIXELS / (width * height)),
    MAX_SHADOW_SIDE / Math.max(width, height)
  )
  const pixelWidth = Math.max(1, Math.ceil(width * fitted))
  const pixelHeight = Math.max(1, Math.ceil(height * fitted))
  const surface = ck.MakeSurface(pixelWidth, pixelHeight)
  if (!surface) return null
  try {
    const canvas = surface.getCanvas()
    canvas.clear(ck.TRANSPARENT)
    canvas.scale(pixelWidth / width, pixelHeight / height)
    canvas.translate(-x, -y)
    drawForExport(renderer, () => {
      renderShadowsAlone(renderer, canvas, graph, node, type)
      if (cutOut && type === 'DROP_SHADOW') cutOutSilhouette(renderer, canvas, graph, node)
    })
    surface.flush()
    const image = surface.makeImageSnapshot()
    try {
      const data = image.encodeToBytes(ck.ImageFormat.PNG, 100)
      return data ? { data, box: { x, y, width, height } } : null
    } finally {
      image.delete()
    }
  } finally {
    surface.delete()
  }
}
