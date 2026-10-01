import type { CSSProperties, Dispatch, FormEvent, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Filter,
  FolderOpen,
  Image,
  LayoutGrid,
  List,
  Lock,
  Search,
  Trash2,
  X
} from "lucide-react";
import { formatBytes, formatDuration } from "@videocat/shared";
import { CatalogCard } from "../components/CatalogCard";
import { CategoryBadges } from "../components/CategoryBadges";
import { FileDetail } from "../components/FileDetail";
import { SortHeader } from "../components/SortHeader";
import { catalogSortOptions, pageSizeOptions } from "../lib/app-config";
import { categoryStyle, dateLabel, mainThumbnail, resolution, tagHue } from "../lib/app-helpers";
import type {
  CatalogLayout,
  CurationCategory,
  CurationStatus,
  FacetResponse,
  ProfileSecurityResponse,
  SortBy,
  SortDirection,
  VisibleFolder
} from "../lib/app-types";
import type { VideoFile } from "../types";

export type CatalogViewProps = {
  activeCatalogFilters: Array<{ key: string; label: string; onRemove: () => void }>;
  allVisibleSelected: boolean;
  applyBulkCategory: (categoryKey: string, enabled: boolean) => Promise<void>;
  beginFilterResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  bulkBusy: boolean;
  bulkCategoryKey: string;
  bulkMessage: string;
  canOpenNext: boolean;
  canOpenPrevious: boolean;
  catalogView: CatalogLayout;
  categoryError: string;
  categorySubmitting: boolean;
  changeSort: (field: SortBy) => void;
  clearCatalogFilters: () => void;
  clearFileSelection: () => void;
  compactLayout: boolean;
  companionLocalOnline: boolean;
  companionMountedDiskIds: string[];
  companionOnline: boolean;
  createCategory: (event: FormEvent) => Promise<void>;
  curationStatus: CurationStatus | "";
  deleteCategory: (category: CurationCategory) => Promise<void>;
  duplicateOnly: boolean;
  duplicates: VideoFile[];
  extension: string;
  extensions: string[];
  facets: FacetResponse;
  files: VideoFile[];
  filterWidth: number;
  folderSearch: string;
  handlePageInput: (value: string) => void;
  handlePageSizeChange: (value: string) => void;
  loading: boolean;
  locale: string;
  maxTagCount: number;
  newCategoryColor: string;
  newCategoryLabel: string;
  openAdjacentDetail: (offset: -1 | 1) => Promise<void>;
  openDetail: (file: Pick<VideoFile, "id">) => Promise<void>;
  openRandomConnectedDetail: (excludeId: string) => Promise<void>;
  page: number;
  pageCount: number;
  pageSize: number;
  profileSecurity: ProfileSecurityResponse | null;
  queueSelectedDownloads: () => Promise<void>;
  regenerateSelectedThumbnails: () => Promise<void>;
  removeDeletedFile: (fileId: string) => void;
  selected: VideoFile | null;
  selectedFileIdSet: Set<string>;
  selectedFileIds: string[];
  selectedFolders: string[];
  selectedTags: string[];
  setBulkCategoryKey: Dispatch<SetStateAction<string>>;
  setCatalogView: Dispatch<SetStateAction<CatalogLayout>>;
  setCurationStatus: Dispatch<SetStateAction<CurationStatus | "">>;
  setDuplicateOnly: Dispatch<SetStateAction<boolean>>;
  setExtension: Dispatch<SetStateAction<string>>;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;
  setFolderSearch: Dispatch<SetStateAction<string>>;
  setNewCategoryColor: Dispatch<SetStateAction<string>>;
  setNewCategoryLabel: Dispatch<SetStateAction<string>>;
  setPage: Dispatch<SetStateAction<number>>;
  setSelected: Dispatch<SetStateAction<VideoFile | null>>;
  setSortBy: Dispatch<SetStateAction<SortBy>>;
  setSortDirection: Dispatch<SetStateAction<SortDirection>>;
  showCatalogFilters: boolean;
  sortBy: SortBy;
  sortDirection: SortDirection;
  toggleFileCategory: (file: VideoFile, categoryKey: string, enabled: boolean) => Promise<void>;
  toggleFileSelection: (fileId: string) => void;
  toggleFolder: (folder: string) => void;
  toggleFolderExpansion: (folder: string) => void;
  toggleTag: (tag: string) => void;
  toggleVisibleSelection: (checked: boolean) => void;
  total: number;
  visibleFolders: VisibleFolder[];
  visibleSelectedCount: number;
};

export function CatalogView({ activeCatalogFilters, allVisibleSelected, applyBulkCategory, beginFilterResize, bulkBusy, bulkCategoryKey, bulkMessage, canOpenNext, canOpenPrevious, catalogView, categoryError, categorySubmitting, changeSort, clearCatalogFilters, clearFileSelection, compactLayout, companionLocalOnline, companionMountedDiskIds, companionOnline, createCategory, curationStatus, deleteCategory, duplicateOnly, duplicates, extension, extensions, facets, files, filterWidth, folderSearch, handlePageInput, handlePageSizeChange, loading, locale, maxTagCount, newCategoryColor, newCategoryLabel, openAdjacentDetail, openDetail, openRandomConnectedDetail, page, pageCount, pageSize, profileSecurity, queueSelectedDownloads, regenerateSelectedThumbnails, removeDeletedFile, selected, selectedFileIdSet, selectedFileIds, selectedFolders, selectedTags, setBulkCategoryKey, setCatalogView, setCurationStatus, setDuplicateOnly, setExtension, setFiltersOpen, setFolderSearch, setNewCategoryColor, setNewCategoryLabel, setPage, setSelected, setSortBy, setSortDirection, showCatalogFilters, sortBy, sortDirection, toggleFileCategory, toggleFileSelection, toggleFolder, toggleFolderExpansion, toggleTag, toggleVisibleSelection, total, visibleFolders, visibleSelectedCount }: CatalogViewProps) {
  return (
    <section
      className={`vc-catalog ${showCatalogFilters ? "has-filters" : ""} ${selected ? "has-detail" : ""}`}
      style={{ "--filter-width": `${filterWidth}px` } as CSSProperties}
    >
      {showCatalogFilters && compactLayout ? (
        <button className="vc-sheet-scrim" type="button" aria-label="Cerrar filtros" onClick={() => setFiltersOpen(false)} />
      ) : null}
      {showCatalogFilters ? (
        <aside
          className={`filters vc-filters ${compactLayout ? "is-sheet" : ""}`}
          aria-label="Filtros"
          role={compactLayout ? "dialog" : undefined}
          aria-modal={compactLayout ? true : undefined}
        >
          {compactLayout ? <span className="vc-sheet-handle" aria-hidden="true" /> : (
            <button
              className="filter-resize-handle"
              onPointerDown={beginFilterResize}
              type="button"
              title="Arrastrar para cambiar ancho"
              aria-label="Cambiar ancho de filtros"
            />
          )}
          <div className="section-title">
            <Filter size={17} />
            Filtros
            {compactLayout ? (
              <button className="vc-icon-button is-ghost is-small vc-sheet-close" onClick={() => setFiltersOpen(false)} type="button" aria-label="Cerrar filtros">
                <X size={18} />
              </button>
            ) : null}
          </div>
          <label>
            Extension
            <select value={extension} onChange={(event) => { setExtension(event.target.value); setPage(1); }}>
              <option value="">Todas</option>
              {extensions.map((item) => {
                const count = facets.extensions.find((extensionItem) => extensionItem.extension === item)?.count ?? 0;
                return (
                <option key={item} value={item}>
                  {item} ({count})
                </option>
                );
              })}
            </select>
          </label>
          <div className="facet-block">
            <div className="facet-title">Carpetas</div>
            <div className="folder-search">
              <Search size={15} />
              <input
                value={folderSearch}
                onChange={(event) => setFolderSearch(event.target.value)}
                placeholder="Buscar carpeta"
              />
              {folderSearch ? (
                <button onClick={() => setFolderSearch("")} type="button" title="Limpiar busqueda de carpetas">
                  <X size={14} />
                </button>
              ) : null}
            </div>
            <div className="folder-list">
              {visibleFolders.length > 0 ? (
                visibleFolders.map((folder) => (
                  <div
                    key={folder.path}
                    className={`folder-option ${selectedFolders.includes(folder.path) ? "is-active" : ""}`}
                    style={{ "--folder-depth": folder.depth } as CSSProperties}
                    title={folder.path}
                  >
                    <button
                      className="folder-expander"
                      onClick={() => toggleFolderExpansion(folder.path)}
                      disabled={!folder.hasChildren}
                      type="button"
                      title={folder.isExpanded ? "Colapsar carpeta" : "Expandir carpeta"}
                    >
                      {folder.hasChildren ? (
                        folder.isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />
                      ) : null}
                    </button>
                    <button className="folder-select" onClick={() => toggleFolder(folder.path)} type="button">
                      {folder.locked ? <Lock size={15} /> : <FolderOpen size={15} />}
                      <span>{folder.label}</span>
                      <small>{folder.count}</small>
                    </button>
                  </div>
                ))
              ) : (
                <div className="facet-empty">{folderSearch ? "Sin coincidencias de carpeta." : "Sin carpetas para estos discos."}</div>
              )}
            </div>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={duplicateOnly}
              onChange={(event) => { setDuplicateOnly(event.target.checked); setPage(1); }}
            />
            Duplicados probables
          </label>
          <div className="facet-block">
            <div className="facet-title">Categorias</div>
            <div className="curation-filter-list">
              <button
                className={`curation-filter is-none ${curationStatus === "" ? "is-active" : ""}`}
                onClick={() => { setCurationStatus(""); setPage(1); }}
                type="button"
              >
                <span>Todas</span>
              </button>
              {facets.curationStatuses.map((item) => (
                <div className="curation-filter-row" key={item.key}>
                  <button
                    className={`curation-filter ${curationStatus === item.key ? "is-active" : ""}`}
                    style={categoryStyle(item.key, facets.curationStatuses)}
                    onClick={() => { setCurationStatus(item.key); setPage(1); }}
                    type="button"
                  >
                    <span>{item.label}</span>
                    <small>{item.count}</small>
                  </button>
                  {!item.builtIn ? (
                    <button
                      className="category-delete-button"
                      onClick={() => deleteCategory(item)}
                      type="button"
                      title={`Eliminar ${item.label}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <form className="category-create-form" onSubmit={createCategory}>
              <input
                value={newCategoryLabel}
                onChange={(event) => setNewCategoryLabel(event.target.value)}
                maxLength={32}
                placeholder="Nueva categoria"
              />
              <input
                className="category-color-input"
                value={newCategoryColor}
                onChange={(event) => setNewCategoryColor(event.target.value)}
                type="color"
                title="Color"
              />
              <button disabled={categorySubmitting || !newCategoryLabel.trim()} type="submit">
                Crear
              </button>
            </form>
            {categoryError ? <div className="form-error compact-error">{categoryError}</div> : null}
          </div>
          <div className="facet-block tags-block">
            <div className="facet-title">Etiquetas</div>
            <div className="tag-list">
              {facets.tags.length > 0 ? (
                facets.tags.map((item) => {
                  const hue = tagHue(item.tag);
                  const relevance = 0.88 + Math.min(0.28, item.count / maxTagCount / 3);
                  return (
                    <button
                      key={item.tag}
                      className={`tag-chip ${selectedTags.includes(item.tag) ? "is-active" : ""}`}
                      style={{
                        "--tag-hue": hue,
                        "--tag-scale": relevance
                      } as CSSProperties}
                      onClick={() => toggleTag(item.tag)}
                      type="button"
                    >
                      <span>{item.tag}</span>
                      <small>{item.count}</small>
                    </button>
                  );
                })
              ) : (
                <div className="facet-empty">Sin etiquetas repetidas.</div>
              )}
            </div>
          </div>
          {compactLayout ? (
            <div className="vc-sheet-footer">
              {activeCatalogFilters.length > 0 ? (
                <button className="vc-button" onClick={clearCatalogFilters} type="button">Limpiar filtros</button>
              ) : null}
              <button className="vc-button is-primary" onClick={() => setFiltersOpen(false)} type="button">
                {`Ver ${total.toLocaleString(locale)} ${total === 1 ? "video" : "videos"}`}
              </button>
            </div>
          ) : null}
        </aside>
      ) : null}

      <section className="vc-results" aria-label="Resultados">
        <div className="vc-results-toolbar">
          <span className="vc-results-count">
            <strong>{`${total.toLocaleString(locale)} ${total === 1 ? "video" : "videos"}`}</strong>
          </span>
          {activeCatalogFilters.map((filter) => (
            <button key={filter.key} className="vc-filter-chip" onClick={filter.onRemove} type="button" title="Quitar filtro">
              <span>{filter.label}</span>
              <X size={13} aria-hidden="true" />
            </button>
          ))}
          {activeCatalogFilters.length > 1 ? (
            <button className="vc-link-button" onClick={clearCatalogFilters} type="button">Limpiar filtros</button>
          ) : null}
          <div className="vc-toolbar-spacer" />
          <label className="vc-inline-field">
            <span>Ordenar</span>
            <select
              value={`${sortBy}:${sortDirection}`}
              onChange={(event) => {
                const [field, direction] = event.target.value.split(":") as [SortBy, SortDirection];
                setSortBy(field);
                setSortDirection(direction);
                setPage(1);
              }}
            >
              {catalogSortOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="vc-inline-field">
            <span>Por página</span>
            <select value={pageSize} onChange={(event) => handlePageSizeChange(event.target.value)}>
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <div className="vc-segmented is-icons" role="group" aria-label="Vista">
            <button type="button" aria-pressed={catalogView === "grid"} onClick={() => setCatalogView("grid")} title="Cuadrícula" aria-label="Cuadrícula">
              <LayoutGrid size={16} />
            </button>
            <button type="button" aria-pressed={catalogView === "list"} onClick={() => setCatalogView("list")} title="Lista" aria-label="Lista">
              <List size={16} />
            </button>
          </div>
        </div>

        {selectedFileIds.length > 0 ? (
          <div className="bulk-actions">
            <strong>{`${selectedFileIds.length.toLocaleString(locale)} ${selectedFileIds.length === 1 ? "seleccionado" : "seleccionados"}`}</strong>
            <span>{`${visibleSelectedCount} en esta página`}</span>
            <select value={bulkCategoryKey} onChange={(event) => setBulkCategoryKey(event.target.value)}>
              <option value="">Elegir etiqueta</option>
              {facets.curationStatuses.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              disabled={!bulkCategoryKey || bulkBusy}
              onClick={() => void applyBulkCategory(bulkCategoryKey, true)}
              type="button"
            >
              Añadir
            </button>
            <button
              className="secondary-button"
              disabled={!bulkCategoryKey || bulkBusy}
              onClick={() => void applyBulkCategory(bulkCategoryKey, false)}
              type="button"
            >
              Quitar
            </button>
            <button
              className="danger-button"
              disabled={bulkBusy}
              onClick={() => void applyBulkCategory("delete", true)}
              type="button"
            >
              Marcar para borrar
            </button>
            <button
              className="secondary-button is-download"
              disabled={bulkBusy}
              onClick={() => void queueSelectedDownloads()}
              type="button"
            >
              <Download size={16} />
              A descargar
            </button>
            <button
              className="secondary-button"
              disabled={bulkBusy}
              onClick={() => void regenerateSelectedThumbnails()}
              type="button"
            >
              <Image size={16} />
              Regenerar miniaturas
            </button>
            <button className="ghost-button" disabled={bulkBusy} onClick={clearFileSelection} type="button">
              Limpiar
            </button>
          </div>
        ) : null}
        {bulkMessage ? <div className="bulk-message">{bulkMessage}</div> : null}


        {catalogView === "grid" ? (
          <div className="vc-grid-frame">
            {files.length > 0 ? (
              <div className={`vc-grid ${selectedFileIds.length > 0 ? "has-selection" : ""}`}>
                {files.map((file) => (
                  <CatalogCard
                    key={file.id}
                    file={file}
                    categories={facets.curationStatuses}
                    active={selected?.id === file.id}
                    checked={selectedFileIdSet.has(file.id)}
                    availability={!companionOnline ? "unknown" : companionMountedDiskIds.includes(file.diskId) ? "mounted" : "offline"}
                    onOpen={() => void openDetail(file)}
                    onToggleSelect={() => toggleFileSelection(file.id)}
                  />
                ))}
              </div>
            ) : null}
            {loading ? <div className="loading">Cargando...</div> : null}
            {!loading && files.length === 0 ? <div className="empty">No hay archivos para estos filtros.</div> : null}
          </div>
        ) : (
          <div className="table-frame catalog-table-frame">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th className="select-column">
                    <input
                      aria-label="Seleccionar página"
                      checked={allVisibleSelected}
                      disabled={files.length === 0}
                      onChange={(event) => toggleVisibleSelection(event.target.checked)}
                      type="checkbox"
                    />
                  </th>
                  <th><SortHeader label="Archivo" field="filename" sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /></th>
                  <th>Disco</th>
                  <th>Ruta</th>
                  <th><SortHeader label="Tamaño" field="sizeBytes" sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /></th>
                  <th><SortHeader label="Duración" field="durationSeconds" sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /></th>
                  <th>Resolución</th>
                  <th>Códec</th>
                  <th><SortHeader label="Modificado" field="modifiedAt" sortBy={sortBy} sortDirection={sortDirection} onSort={changeSort} /></th>
                  <th>Indexado</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr
                    key={file.id}
                    className={[
                      file.isProbableDuplicate ? "duplicate-highlight" : "",
                      file.curationStatus !== "none" ? `curation-row is-${file.curationStatus}` : "",
                      selectedFileIdSet.has(file.id) ? "is-selected" : "",
                      selected?.id === file.id ? "is-open" : ""
                    ].filter(Boolean).join(" ")}
                    style={categoryStyle(file.curationStatus, facets.curationStatuses)}
                    onClick={() => void openDetail(file)}
                  >
                    <td className="select-column" onClick={(event) => event.stopPropagation()}>
                      <input
                        aria-label={`Seleccionar ${file.filename}`}
                        checked={selectedFileIdSet.has(file.id)}
                        onChange={() => toggleFileSelection(file.id)}
                        type="checkbox"
                      />
                    </td>
                    <td data-label="Archivo">
                      <div className="file-cell">
                        <div className="thumb">
                          {mainThumbnail(file) ? <img src={mainThumbnail(file)} alt="" /> : <Image size={22} />}
                        </div>
                        <div>
                          <strong>{file.filename}</strong>
                          <span>
                            {file.extension} {file.isProbableDuplicate ? "Duplicado probable" : ""}
                          </span>
                          <CategoryBadges file={file} categories={facets.curationStatuses} />
                        </div>
                      </div>
                    </td>
                    <td data-label="Disco">{file.disk?.name ?? "-"}</td>
                    <td className="path-cell" data-label="Ruta">{file.relativePath}</td>
                    <td data-label="Tamaño">{formatBytes(file.sizeBytes)}</td>
                    <td data-label="Duración">{formatDuration(file.durationSeconds)}</td>
                    <td data-label="Resolución">{resolution(file)}</td>
                    <td data-label="Codec">{file.videoCodec ?? "-"}</td>
                    <td data-label="Modificado">{dateLabel(file.modifiedAt, locale)}</td>
                    <td data-label="Indexado">{dateLabel(file.lastIndexedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading ? <div className="loading">Cargando...</div> : null}
            {!loading && files.length === 0 ? <div className="empty">No hay archivos para estos filtros.</div> : null}
          </div>

        )}

        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
            Anterior
          </button>
          <label className="page-jump">
            <span>Pagina</span>
            <input
              value={page}
              min={1}
              max={pageCount}
              onChange={(event) => handlePageInput(event.target.value)}
              type="number"
            />
            <span>{`de ${pageCount} · ${total} archivos`}</span>
          </label>
          <button disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
            Siguiente
          </button>
        </div>
      </section>

      {selected ? (
        <>
          <button className="vc-detail-scrim" type="button" aria-label="Cerrar detalle" onClick={() => setSelected(null)} />
          <FileDetail
            variant="panel"
            file={selected}
            duplicates={duplicates}
            locale={locale}
            canOpenPrevious={canOpenPrevious}
            canOpenNext={canOpenNext}
            onPrevious={() => openAdjacentDetail(-1)}
            onNext={() => openAdjacentDetail(1)}
            onRandom={(excludeId) => openRandomConnectedDetail(excludeId)}
            onClose={() => setSelected(null)}
            categories={facets.curationStatuses}
            companionOnline={companionOnline}
            companionLocalOnline={companionLocalOnline}
            companionMountedDiskIds={companionMountedDiskIds}
            chromecastEnabled={profileSecurity?.chromecastEnabled ?? false}
            onToggleCategory={(categoryKey, enabled) => toggleFileCategory(selected, categoryKey, enabled)}
            onDeleted={removeDeletedFile}
          />
        </>
      ) : null}
    </section>
  );
}
