import type { SortBy, SortDirection, ViewMode } from "./app-types";

export const viewPaths: Record<ViewMode, string> = {
  catalog: "/catalogo",
  review: "/review",
  downloads: "/a-descargar",
  duplicates: "/duplicados",
  usage: "/esquema-de-uso",
  audit: "/auditoria",
  admin: "/administracion",
  profile: "/perfil"
};

export const pathViews: Record<string, ViewMode> = {
  "/": "catalog",
  "/catalogo": "catalog",
  "/catalog": "catalog",
  "/review": "review",
  "/a-descargar": "downloads",
  "/downloads": "downloads",
  "/duplicados": "duplicates",
  "/duplicates": "duplicates",
  "/esquema-de-uso": "usage",
  "/usage": "usage",
  "/auditoria": "audit",
  "/audit": "audit",
  "/administracion": "admin",
  "/admin": "admin",
  "/perfil": "profile",
  "/profile": "profile"
};

export const logoUrl = "/logo.png";

export const logoWhiteUrl = "/logo_white.png";

export const webVersion = import.meta.env.VITE_VIDEOCAT_VERSION || "0.2.0";

export const githubProfileUrl = "https://github.com/reiterstahl";

export const githubSponsorsUrl = "https://github.com/sponsors/reiterstahl";

export const paypalDonateUrl = "https://www.paypal.com/donate/?hosted_button_id=2A4K45LJRACCY";

export const pageSizeOptions = [15, 30, 60, 100] as const;

export const defaultPageSize = 30;

export const minFilterWidth = 250;

export const maxFilterWidth = 560;

export const defaultCategoryColor = "#2A9FD6";

export const catalogSortOptions: Array<{ value: `${SortBy}:${SortDirection}`; label: string }> = [
  { value: "modifiedAt:desc", label: "Modificados recientes" },
  { value: "modifiedAt:asc", label: "Modificados antiguos" },
  { value: "createdAt:desc", label: "Indexados recientes" },
  { value: "filename:asc", label: "Nombre A–Z" },
  { value: "filename:desc", label: "Nombre Z–A" },
  { value: "sizeBytes:desc", label: "Más grandes" },
  { value: "sizeBytes:asc", label: "Más pequeños" },
  { value: "durationSeconds:desc", label: "Más largos" },
  { value: "durationSeconds:asc", label: "Más cortos" }
];
