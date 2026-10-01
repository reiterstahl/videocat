import { ArrowUpDown } from "lucide-react";
import { sortLabel } from "../lib/app-helpers";
import type { SortBy, SortDirection } from "../lib/app-types";

export function SortHeader({
  label,
  field,
  sortBy,
  sortDirection,
  onSort
}: {
  label: string;
  field: SortBy;
  sortBy: SortBy;
  sortDirection: SortDirection;
  onSort: (field: SortBy) => void;
}) {
  const active = sortBy === field;
  return (
    <button
      className={`sort-header ${active ? "is-active" : ""}`}
      onClick={() => onSort(field)}
      type="button"
      title={`Ordenar por ${label}`}
    >
      <span>{label}</span>
      <ArrowUpDown size={14} />
      {active ? <small>{sortLabel(sortBy, sortDirection, field)}</small> : null}
    </button>
  );
}
