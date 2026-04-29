import type { MenuItem } from "../menu";

/**
 * Menu item with resolved tree structure for UI rendering.
 * Extends the base DB-mirror MenuItem with optional children.
 */
export interface MenuItemTree extends MenuItem {
  children?: MenuItemTree[];
}
