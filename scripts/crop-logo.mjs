import fs from "node:fs";
import sharp from "sharp";

const src = "src/assets/logo-ineco.jpg";
const croppedPath = "src/assets/logo-ineco-cropped.png";

// Bounding box detectado del contenido (con padding mínimo)
const left = 130;
const top = 138;
const width = 772;
const height = 188;

await sharp(src)
  .extract({ left, top, width, height })
  .png()
  .toFile(croppedPath);

const bytes = fs.readFileSync(croppedPath);
const meta = await sharp(croppedPath).metadata();
const b64 = bytes.toString("base64");

const out = `/** Logo Ineco recortado para el PDF (${meta.width}x${meta.height}). */
export const LOGO_INECO_FORMAT = "PNG" as const;
export const LOGO_INECO_WIDTH = ${meta.width};
export const LOGO_INECO_HEIGHT = ${meta.height};
export const LOGO_INECO_DATA_URL =
  "data:image/png;base64,${b64}";
`;

fs.writeFileSync("src/assets/logoIneco.ts", out);
console.log("cropped", meta.width, meta.height, "bytes", bytes.length);
