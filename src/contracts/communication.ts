export interface TemplateResult {
  body: string;
  title?: string;
}

export type TemplateFunction = (
  locale: string,
  data: Record<string, string>,
) => TemplateResult;
