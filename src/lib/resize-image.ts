import type { ResizeOptions } from "@/src/contracts/high-level/component-props";

export async function resizeImage(
  file: File,
  options: ResizeOptions,
): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const { width, height, format } = options;

  const cappedWidth = width !== undefined
    ? Math.min(width, bitmap.width)
    : undefined;
  const cappedHeight = height !== undefined
    ? Math.min(height, bitmap.height)
    : undefined;

  const targetWidth = cappedWidth ??
    Math.round((cappedHeight! / bitmap.height) * bitmap.width);
  const targetHeight = cappedHeight ??
    Math.round((cappedWidth! / bitmap.width) * bitmap.height);

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to acquire 2D context");

  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: format });
  return new Uint8Array(await blob.arrayBuffer());
}
