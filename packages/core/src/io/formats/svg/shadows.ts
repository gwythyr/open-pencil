import type { Effect, SceneNode } from '@open-pencil/scene-graph'

import { svg, type SVGNode } from './node'
import { round } from './paths'

/** An image drawn in place of a shadow filter, placed in the layer's own coordinates. */
export interface SVGShadowImage {
  href: string
  x: number
  y: number
  width: number
  height: number
}

/** A layer's drop shadows, drawn behind it, and inner shadows, drawn over it, as images. */
export interface SVGShadowImages {
  drop?: SVGShadowImage
  inner?: SVGShadowImage
}

/** The shadow images of a layer, or nothing to keep its shadows as SVG filters. */
export type SVGShadowImageLookup = (node: SceneNode) => SVGShadowImages | null | undefined

/** The layer's effects that still go in its SVG filter: those no image draws. */
export function filteredEffects(node: SceneNode, images: SVGShadowImages | null): Effect[] {
  if (!images) return node.effects
  return node.effects.filter(
    (effect) =>
      !(effect.type === 'DROP_SHADOW' && images.drop) &&
      !(effect.type === 'INNER_SHADOW' && images.inner)
  )
}

/** A layer's shadow images, and the elements that draw them behind and over it. */
export interface SVGShadowElements {
  images: SVGShadowImages | null
  drop: SVGNode | null
  inner: SVGNode | null
}

export function shadowElements(
  node: SceneNode,
  lookup: SVGShadowImageLookup | undefined
): SVGShadowElements {
  const images = lookup?.(node) ?? null
  return { images, drop: imageElement(images?.drop), inner: imageElement(images?.inner) }
}

function imageElement(image: SVGShadowImage | undefined): SVGNode | null {
  if (!image) return null
  return svg('image', {
    href: image.href,
    x: round(image.x),
    y: round(image.y),
    width: round(image.width),
    height: round(image.height),
    preserveAspectRatio: 'none'
  })
}
