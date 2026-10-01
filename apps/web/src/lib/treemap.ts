export type TreemapRect<T> = {
  item: T;
  x: number;
  y: number;
  width: number;
  height: number;
};

type Weighted<T> = { item: T; area: number };

function worstAspectRatio<T>(row: Array<Weighted<T>>, side: number): number {
  const total = row.reduce((sum, entry) => sum + entry.area, 0);
  if (total <= 0 || side <= 0) return Number.POSITIVE_INFINITY;
  let worst = 0;
  for (const entry of row) {
    const ratio = Math.max((side * side * entry.area) / (total * total), (total * total) / (side * side * entry.area));
    worst = Math.max(worst, ratio);
  }
  return worst;
}

// Squarified treemap (Bruls, Huijzing and van Wijk) laid out in percentages of a width × height box.
export function squarify<T>(items: T[], valueOf: (item: T) => number, width = 100, height = 100): Array<TreemapRect<T>> {
  const positive = items.filter((item) => valueOf(item) > 0);
  const total = positive.reduce((sum, item) => sum + valueOf(item), 0);
  if (total <= 0 || width <= 0 || height <= 0) return [];
  const scale = (width * height) / total;
  const queue: Array<Weighted<T>> = positive
    .map((item) => ({ item, area: valueOf(item) * scale }))
    .sort((left, right) => right.area - left.area);

  const rects: Array<TreemapRect<T>> = [];
  let x = 0;
  let y = 0;
  let remainingWidth = width;
  let remainingHeight = height;
  let row: Array<Weighted<T>> = [];

  function layoutRow() {
    const rowArea = row.reduce((sum, entry) => sum + entry.area, 0);
    if (remainingWidth >= remainingHeight) {
      const rowWidth = rowArea / remainingHeight;
      let offset = y;
      for (const entry of row) {
        const entryHeight = entry.area / rowWidth;
        rects.push({ item: entry.item, x, y: offset, width: rowWidth, height: entryHeight });
        offset += entryHeight;
      }
      x += rowWidth;
      remainingWidth -= rowWidth;
    } else {
      const rowHeight = rowArea / remainingWidth;
      let offset = x;
      for (const entry of row) {
        const entryWidth = entry.area / rowHeight;
        rects.push({ item: entry.item, x: offset, y, width: entryWidth, height: rowHeight });
        offset += entryWidth;
      }
      y += rowHeight;
      remainingHeight -= rowHeight;
    }
    row = [];
  }

  for (const entry of queue) {
    const side = Math.min(remainingWidth, remainingHeight);
    if (row.length === 0 || worstAspectRatio([...row, entry], side) <= worstAspectRatio(row, side)) {
      row.push(entry);
    } else {
      layoutRow();
      row.push(entry);
    }
  }
  if (row.length > 0) layoutRow();
  return rects;
}
