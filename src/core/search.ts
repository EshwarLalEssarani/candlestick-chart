/** Eshwar Lal — https://github.com/EshwarLalEssarani */
/** First index in `[0, length)` whose value is >= `target`. Returns `length` when every value is smaller. */
export function lowerBound(values: ArrayLike<number>, length: number, target: number): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
