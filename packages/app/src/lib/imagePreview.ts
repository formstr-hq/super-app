/**
 * Downscaled webp preview generation for Drive uploads — a port of the
 * standalone formstr-drive `services/Preview/imagePreview.ts` (canvas, max
 * 300px, webp q0.7; HEIC conversion is not supported here). Returns null for
 * non-image files or when rendering fails — previews are best-effort.
 */
export async function generateImagePreview(file: File): Promise<Uint8Array | null> {
  if (!file.type.startsWith("image/")) return null;

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to load image: ${file.name}`));
    });

    const canvas = document.createElement("canvas");
    const maxSize = 300;
    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", 0.7),
    );
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
