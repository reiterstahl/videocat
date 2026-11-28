import { androidApp } from "../lib/android-app";

// Inside the Android app, data that is still on its way shows as grey shapes in place of what is
// coming (cards, rows, numbers), as native apps do. In a browser the page keeps its "Cargando..."
// text.
export function showsSkeletons(): boolean {
  return androidApp() !== null;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`vc-skel ${className}`} aria-hidden="true" />;
}

// The general case: a few lines where a list or a panel is about to appear.
export function LoadingState({ label = "Cargando...", rows = 4 }: { label?: string; rows?: number }) {
  if (!showsSkeletons()) return <div className="loading">{label}</div>;
  return (
    <div className="vc-skel-rows" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="vc-skel vc-skel-row" aria-hidden="true" />
      ))}
    </div>
  );
}

// The catalog's first page: cards shaped like the ones on their way.
export function CatalogSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="vc-grid" role="status" aria-label="Cargando...">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="vc-card vc-card-skeleton" aria-hidden="true">
          <span className="vc-card-thumb vc-skel" />
          <span className="vc-card-body">
            <span className="vc-skel vc-skel-line" />
            <span className="vc-skel vc-skel-line is-short" />
          </span>
        </div>
      ))}
    </div>
  );
}
