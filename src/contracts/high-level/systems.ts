import type { System } from "../system";

export type PublicSystemInfo = Pick<
  System,
  "name" | "slug" | "logoUri" | "defaultLocale" | "termsOfService"
>;
