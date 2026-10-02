/** Eshwar Lal — https://github.com/EshwarLalEssarani */
import type { DrawingTool } from '../types';

const ONE_POINT = new Set<DrawingTool>([
  'horizontal-line',
  'horizontal-ray',
  'vertical-line',
  'cross-line',
  'text',
  'price-label',
  'note',
]);

const THREE_POINT = new Set<DrawingTool>([
  'parallel-channel',
  'fib-extension',
  'pitchfork',
  'triangle',
]);

/** Clicks required to finish a drawing. Brush is dragged instead. */
export function pointsFor(type: DrawingTool): number {
  if (ONE_POINT.has(type)) return 1;
  if (THREE_POINT.has(type)) return 3;
  return 2;
}
