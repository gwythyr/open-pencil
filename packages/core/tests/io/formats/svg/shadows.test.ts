import { describe, expect, test } from 'bun:test'

import { SceneGraph, type Effect, type SceneNode } from '@open-pencil/scene-graph'

import { renderNodesToSVG, type SVGShadowImageLookup } from '#core/io/formats/svg'

const BLACK = { r: 0, g: 0, b: 0, a: 0.5 }

const EFFECTS: Effect[] = [
  {
    type: 'DROP_SHADOW',
    color: BLACK,
    offset: { x: 4, y: 8 },
    radius: 12,
    spread: 0,
    visible: true
  },
  {
    type: 'INNER_SHADOW',
    color: BLACK,
    offset: { x: 0, y: 4 },
    radius: 8,
    spread: 0,
    visible: true
  },
  { type: 'LAYER_BLUR', color: BLACK, offset: { x: 0, y: 0 }, radius: 2, spread: 0, visible: true }
]

function exportCard(shadowImages?: SVGShadowImageLookup, props: Partial<SceneNode> = {}): string {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const card = graph.createNode('RECTANGLE', pageId, {
    width: 80,
    height: 60,
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 1, visible: true }],
    effects: EFFECTS,
    ...props
  })
  const svg = renderNodesToSVG(graph, pageId, [card.id], { xmlDeclaration: false, shadowImages })
  if (!svg) throw new Error('nothing exported')
  return svg
}

const IMAGES: SVGShadowImageLookup = () => ({
  drop: { href: 'data:image/png;base64,drop', x: -20, y: -16, width: 128, height: 112 },
  inner: { href: 'data:image/png;base64,inner', x: 0, y: 0, width: 80, height: 60 }
})

describe('SVG shadows drawn as images', () => {
  test('draw drop shadows under the layer and inner shadows over it, in its coordinates', () => {
    const svg = exportCard(IMAGES)
    const drop = svg.indexOf('<image href="data:image/png;base64,drop"')
    const shape = svg.indexOf('<rect')
    const inner = svg.indexOf('<image href="data:image/png;base64,inner"')
    expect(drop).toBeGreaterThan(-1)
    expect(drop).toBeLessThan(shape)
    expect(inner).toBeGreaterThan(shape)
    expect(svg).toContain('x="-20" y="-16" width="128" height="112" preserveAspectRatio="none"')
  })

  test('draw a shape’s inner shadow over its fills and under its strokes, as the canvas does', () => {
    const svg = exportCard(IMAGES, {
      strokes: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          weight: 4,
          opacity: 1,
          visible: true,
          align: 'CENTER'
        }
      ]
    })
    const fill = svg.indexOf('<rect width="80" height="60" fill="#0000FF"/>')
    const inner = svg.indexOf('<image href="data:image/png;base64,inner"')
    const stroke = svg.indexOf('<rect width="80" height="60" fill="none" stroke="#FF0000"')
    expect(fill).toBeGreaterThan(-1)
    expect(inner).toBeGreaterThan(fill)
    expect(stroke).toBeGreaterThan(inner)
  })

  test('leave only the effects no image draws in the filter', () => {
    const svg = exportCard(IMAGES)
    expect(svg).not.toContain('feDropShadow')
    expect(svg).not.toContain('feFlood')
    expect(svg).toContain('<feGaussianBlur stdDeviation="1"/>')
  })

  test('keep a layer without images on SVG filters', () => {
    const svg = exportCard(() => null)
    expect(svg).toContain('feDropShadow')
    expect(svg).not.toContain('<image')
    expect(exportCard()).toBe(svg)
  })
})
