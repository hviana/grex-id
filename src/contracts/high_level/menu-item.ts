import type { MenuItem } from "../menu";

/**
 * Display-oriented menu item — API response shape consumed by MenuTreeEditor.
 * Extends the base DB-mirror MenuItem, adding systemId and adjusting
 * nullability for JSON-serialized fields (null vs undefined).
 */
export interface MenuItemView
  extends Omit<MenuItem, "tenantIds" | "parentId" | "emoji"> {
  systemId: string;
  parentId: string | null;
  emoji: string | null;
}

/**
 * Menu item with resolved tree structure for UI rendering.
 * Extends the base DB-mirror MenuItem with optional children.
 */
export interface MenuItemTree extends MenuItem {
  children?: MenuItemTree[];
}
