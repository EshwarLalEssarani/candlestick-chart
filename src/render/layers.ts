/** Eshwar Lal — https://github.com/EshwarLalEssarani */
export const LAYER_BG = 1;
export const LAYER_SERIES = 2;
export const LAYER_DRAW = 4;
export const LAYER_OVERLAY = 8;
export const LAYER_ALL = 15;

/**
 * A live tick that does not move the viewport or the price scale repaints the
 * series and the overlay only. Gridlines and drawings stay as they were.
 * An off-screen tick also skips the series bitmap.
 */
export function resolveDirty(
  dirty: number,
  dataPaint: boolean,
  dataIndex: number,
  viewChanged: boolean,
  scaleChanged: boolean,
  visibleFrom: number,
  visibleTo: number,
): number {
  if (!dataPaint || viewChanged || scaleChanged) return dirty;
  let next = dirty & ~(LAYER_BG | LAYER_DRAW);
  if (dataIndex < visibleFrom || dataIndex > visibleTo) next &= ~LAYER_SERIES;
  return next;
}
