export interface TemplateResult {
  body: string;
  title?: string;
}

export type TemplateFunction<T extends Record<string, unknown> = Record<string, unknown>> = (
  locale: string,
  data: T,
) => Promise<TemplateResult>;
