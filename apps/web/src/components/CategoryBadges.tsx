import { categoryKeysForFile, categoryLabel, categoryStyle } from "../lib/app-helpers";
import type { CurationCategory } from "../lib/app-types";
import type { VideoFile } from "../types";

export function CategoryBadges({ file, categories }: { file: VideoFile; categories: CurationCategory[] }) {
  const keys = categoryKeysForFile(file);
  if (keys.length === 0) return null;

  return (
    <div className="category-badges">
      {keys.map((key) => (
        <em key={key} className={`status-badge is-${key}`} style={categoryStyle(key, categories)}>
          {categoryLabel(key, categories)}
        </em>
      ))}
    </div>
  );
}
