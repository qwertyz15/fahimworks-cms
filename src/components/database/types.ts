import type { PropertyDef, PropertyValue } from "@/lib/db-properties";
import type { ViewConfig, ViewType } from "@/lib/db-views";

export type { PropertyDef, PropertyValue };

export interface DbMeta {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  coverImage: string | null;
  archived: boolean;
}

export interface ViewDef {
  id: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
}

export interface Row {
  id: string;
  title: string;
  icon: string | null;
  values: Record<string, PropertyValue>;
  position: string;
  createdAt: string;
  updatedAt: string;
}

export interface Person {
  id: string;
  name: string;
}
