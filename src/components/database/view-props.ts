import type { PropertyValue, SelectOption } from "@/lib/db-properties";
import type { ViewConfig } from "@/lib/db-views";
import type { EditorUploadConfig } from "@/components/editor/rich-editor";
import type { Person, PropertyDef, Row, ViewDef } from "./types";

/** What every view (table, board, list) gets from the database screen. */
export interface ViewProps {
  view: ViewDef;
  /** Visible properties for this view, in display order (Title first). */
  props: PropertyDef[];
  allProps: PropertyDef[];
  rows: Row[];
  total: number;
  people: Person[];
  uploads: EditorUploadConfig;
  selection: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
  onUpdateRow: (id: string, patch: { title?: string; values?: Record<string, PropertyValue> }) => void;
  onCreateRow: (init?: { title?: string; values?: Record<string, PropertyValue>; afterId?: string | null }) => Promise<Row | null>;
  onOpenRow: (id: string) => void;
  onMoveRow: (id: string, input: { beforeId?: string | null; afterId?: string | null; set?: Record<string, PropertyValue> }) => void;
  onUpdateOptions: (propertyId: string, options: SelectOption[]) => Promise<SelectOption[] | null>;
  onUpdateView: (patch: Partial<ViewConfig>) => void;
  onPropertyMenu: (def: PropertyDef, anchor: HTMLElement) => void;
  onAddProperty: (anchor: HTMLElement) => void;
  onLoadMore: () => void;
  loading: boolean;
  /** Manual ordering is off while the view has sorts. */
  canReorder: boolean;
  /** Table: start editing this row's title (a row just created from the toolbar). */
  autoEditRowId?: string | null;
}
