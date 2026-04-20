type ResizeOptions =
  & { format: string }
  & (
    | { width: number; height: number }
    | { width: number; height?: undefined }
    | { width?: undefined; height: number }
  );

export async function resizeImage(
  file: File,
  options: ResizeOptions,
): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const { width, height, format } = options;

  const targetWidth = width ??
    Math.round((height! / bitmap.height) * bitmap.width);
  const targetHeight = height ??
    Math.round((width! / bitmap.width) * bitmap.height);

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to acquire 2D context");

  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: format });
  return new Uint8Array(await blob.arrayBuffer());
}
