// Browsers do not show HEIC (the photos of an iPhone with "Keep Originals"). The viewer turns such an original into a JPEG in
// memory when it is opened; the file in the declaration is never changed. The decoder (libheif in WebAssembly, about 3 MB) is
// loaded only then, from the same CDN as pdf.js. heic-to 1.6.5 (libheif 1.23.5), the build without unsafe-eval.
const HEIC_TO_URL = "https://cdn.jsdelivr.net/npm/heic-to@1.6.5/dist/csp/heic-to.js";
const JPEG_QUALITY = 0.9;

export const isHeic = (name, blob = null) => /\.hei[cf]$/i.test(name || "") || /^image\/hei[cf]$/i.test(blob?.type || "");

// Resolves with a blob the browser can show: the same blob, or a JPEG made from a HEIC one.
export async function viewableImage(blob, name, { loadLibrary = () => import(HEIC_TO_URL) } = {}) {
  if (!isHeic(name, blob)) return blob;
  const { heicTo } = await loadLibrary();
  return heicTo({ blob, type: "image/jpeg", quality: JPEG_QUALITY });
}
