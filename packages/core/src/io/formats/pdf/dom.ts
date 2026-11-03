import type * as HappyDOM from 'happy-dom'
import { isValid, toUint8Array } from 'js-base64'

import { imageSize } from '@open-pencil/scene-graph/images'
import type { Size } from '@open-pencil/scene-graph/primitives'

import { IS_BROWSER } from '#core/constants'

/** A page's SVG markup as the element svg2pdf draws, or null when it does not parse. */
export type SVGPageParser = (svg: string) => Element | null

interface SVGParser {
  parseFromString(
    svg: string,
    type: 'image/svg+xml'
  ): {
    querySelector(selectors: string): unknown
    documentElement: unknown
  }
}

/**
 * The globals svg2pdf reads: it parses a page's stylesheets in a document it makes, keeps the
 * rules that are instances of the CSSOM classes, and loads each image to learn its size.
 */
interface SVG2PDFGlobals {
  document?: unknown
  CSSStyleSheet?: unknown
  CSSStyleRule?: unknown
  Image?: unknown
}

const SVG2PDF_GLOBALS = ['document', 'CSSStyleSheet', 'CSSStyleRule', 'Image'] as const

type SVG2PDFGlobal = (typeof SVG2PDF_GLOBALS)[number]

function removeGlobal(scope: SVG2PDFGlobals, name: SVG2PDFGlobal): void {
  if (name === 'document') delete scope.document
  else if (name === 'CSSStyleSheet') delete scope.CSSStyleSheet
  else if (name === 'CSSStyleRule') delete scope.CSSStyleRule
  else delete scope.Image
}

/**
 * The pixel size of an image svg2pdf passes as a base64 data URL, read from the file's header;
 * null for anything else.
 */
function dataURLImageSize(src: string): Size | null {
  const comma = src.indexOf(',')
  if (!src.startsWith('data:') || !src.slice(0, comma).endsWith(';base64')) return null
  const base64 = src.slice(comma + 1)
  return isValid(base64) ? imageSize(toUint8Array(base64)) : null
}

/**
 * An `Image` that reads its data URL's size instead of decoding it, all svg2pdf loads one for: an
 * image it draws is embedded by jsPDF, which reads the file itself. happy-dom loads no images.
 */
class MeasuringImage {
  width = 0
  height = 0
  onload: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  #src = ''

  get src(): string {
    return this.#src
  }

  set src(value: string) {
    this.#src = value
    queueMicrotask(() => {
      const size = dataURLImageSize(value)
      if (!size) {
        this.onerror?.(new Error('Unreadable image'))
        return
      }
      this.width = size.width
      this.height = size.height
      this.onload?.()
    })
  }
}

/**
 * Kept out of the browser bundle: a browser has a DOM of its own, and happy-dom is only loaded
 * where there is none.
 */
const HAPPY_DOM = 'happy-dom'

let exporting: Promise<unknown> = Promise.resolve()

function isElement(value: unknown): value is Element {
  return typeof value === 'object' && value !== null && 'tagName' in value
}

function parseSVGPage(parser: SVGParser): SVGPageParser {
  return (svg) => {
    const parsed = parser.parseFromString(svg, 'image/svg+xml')
    if (parsed.querySelector('parsererror')) return null
    return isElement(parsed.documentElement) ? parsed.documentElement : null
  }
}

/**
 * Runs `draw` with a parser for page SVG and the DOM svg2pdf draws it through. A browser has both.
 * Elsewhere, as in the CLI, happy-dom stands in: svg2pdf reads its DOM as globals, so they are set
 * only while `draw` runs, one export at a time, and restored after.
 */
export function withPDFDOM<T>(draw: (parse: SVGPageParser) => Promise<T>): Promise<T> {
  if (IS_BROWSER) return draw(parseSVGPage(new DOMParser()))
  const run = exporting.then(() => withHappyDOM(draw))
  exporting = run.catch(() => undefined)
  return run
}

async function withHappyDOM<T>(draw: (parse: SVGPageParser) => Promise<T>): Promise<T> {
  const { Window } = (await import(/* @vite-ignore */ HAPPY_DOM)) as typeof HappyDOM
  const dom = new Window()
  const scope: SVG2PDFGlobals = globalThis
  const values: Required<SVG2PDFGlobals> = {
    document: dom.document,
    CSSStyleSheet: dom.CSSStyleSheet,
    CSSStyleRule: dom.CSSStyleRule,
    Image: MeasuringImage
  }
  // Each global replaced, with its descriptor before, so an accessor a host defines comes back as
  // one and a global that could not be replaced is left as it was.
  const replaced: Array<[SVG2PDFGlobal, PropertyDescriptor | undefined]> = []
  try {
    for (const name of SVG2PDF_GLOBALS) {
      const previous = Object.getOwnPropertyDescriptor(globalThis, name)
      Object.defineProperty(globalThis, name, {
        value: values[name],
        configurable: true,
        writable: true
      })
      replaced.push([name, previous])
    }
    return await draw(parseSVGPage(new dom.DOMParser()))
  } finally {
    // What is replaced is configurable, so putting it back does not throw.
    for (const [name, previous] of replaced) {
      if (previous) Object.defineProperty(globalThis, name, previous)
      else removeGlobal(scope, name)
    }
    await dom.happyDOM.close()
  }
}
