import type { Fill, SceneNode, Stroke } from '@open-pencil/scene-graph'
import { hasRegionFills } from '@open-pencil/scene-graph/vector-network'

import {
  formatSolidColor,
  resolveFill,
  solidFillOpacity,
  SVG_STROKE_CAP,
  SVG_STROKE_JOIN,
  type SVGExportContext
} from './defs'
import { round } from './paths'

export type SVGAttrs = Record<string, string | number | undefined>

/** A paint's SVG color, and the `fill-opacity` an sRGB solid keeps beside it. */
interface SVGFillPaint {
  color: string | null
  opacity: number | undefined
}

/** How a shape paints itself: its fills and their SVG paint, and its strokes. */
export interface ShapePaint {
  visibleFills: Fill[]
  fillAttr: string | null
  fillOpacity: number | undefined
  strokeAttrs: SVGAttrs
  visibleStrokes: Stroke[]
}

/** The paint CSS `color` sets, for a tinted icon path. */
const CURRENT_COLOR = 'currentColor'

export function hasPathLevelFills(node: SceneNode): boolean {
  return node.type === 'VECTOR' && hasRegionFills(node.vectorNetwork)
}

function buildSVGStrokeAttrs(
  visibleStrokes: Stroke[],
  colorSpace: 'srgb' | 'display-p3',
  nodeCap: SceneNode['strokeCap']
): SVGAttrs {
  if (visibleStrokes.length === 0) return {}
  const stroke = visibleStrokes[0]
  const cap = stroke.cap ?? nodeCap
  const attrs: SVGAttrs = {
    // Opacity 1 keeps the color opaque. Display P3 must not also keep color alpha here, or a
    // viewer multiplies it by stroke-opacity; the canvas paints stroke.opacity alone.
    stroke: formatSolidColor(stroke.color, 1, colorSpace),
    'stroke-width': round(stroke.weight)
  }
  if (stroke.opacity < 1) attrs['stroke-opacity'] = round(stroke.opacity)
  if (cap !== 'NONE') attrs['stroke-linecap'] = SVG_STROKE_CAP[cap] ?? 'butt'
  if (stroke.join && stroke.join !== 'MITER') {
    attrs['stroke-linejoin'] = SVG_STROKE_JOIN[stroke.join] ?? 'miter'
  }
  if (stroke.dashPattern && stroke.dashPattern.length > 0) {
    attrs['stroke-dasharray'] = stroke.dashPattern.map((n) => round(n)).join(' ')
  }
  return attrs
}

/** A paint's SVG color and, for an sRGB solid, the `fill-opacity` beside it. */
export function exportedFill(
  fill: Fill | undefined,
  node: SceneNode,
  ctx: SVGExportContext
): SVGFillPaint {
  if (!fill) return { color: null, opacity: undefined }
  return {
    color: resolveFill(fill, node, ctx),
    opacity: solidFillOpacity(fill, ctx.colorSpace)
  }
}

/** The paint of a layer's own fills and strokes, tinted where `ctx.tint` asks. */
export function shapePaint(node: SceneNode, ctx: SVGExportContext): ShapePaint {
  const visibleFills = node.fills.filter((f) => f.visible)
  const visibleStrokes = node.strokes.filter((s) => s.visible)
  const tint = ctx.tint?.(node) ?? []
  const ownFill = visibleFills.length > 0 && !hasPathLevelFills(node) ? visibleFills[0] : undefined
  const fill = exportedFill(ownFill, node, ctx)
  const tintedFill = fill.color !== null && tint.includes('fill')
  const fillAttr = tintedFill ? CURRENT_COLOR : fill.color
  // `currentColor` has no alpha. Display P3 normally bakes solid opacity into the color, which a
  // tint throws away, so a tinted solid keeps `fill-opacity` in every color space.
  const fillOpacity = ownFill ? solidFillOpacity(ownFill, ctx.colorSpace, tintedFill) : fill.opacity
  const ownStrokes = buildSVGStrokeAttrs(visibleStrokes, ctx.colorSpace, node.strokeCap)
  const strokeAttrs =
    ownStrokes.stroke && tint.includes('stroke')
      ? { ...ownStrokes, stroke: CURRENT_COLOR }
      : ownStrokes
  return { visibleFills, fillAttr, fillOpacity, strokeAttrs, visibleStrokes }
}
