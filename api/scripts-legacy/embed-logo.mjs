import fs from "node:fs";

const srcPngPath = "src/assets/logo-ineco.png";
const bytes = fs.readFileSync(srcPngPath);

// WhatsApp export may be JPEG despite .png extension
const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
let width = 0;
let height = 0;

if (isJpeg) {
  for (let i = 0; i < bytes.length - 9; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] === 0xc0 || bytes[i + 1] === 0xc2)) {
      height = bytes.readUInt16BE(i + 5);
      width = bytes.readUInt16BE(i + 7);
      break;
    }
  }
  fs.writeFileSync("src/assets/logo-ineco.jpg", bytes);
}

const mime = isJpeg ? "image/jpeg" : "image/png";
const format = isJpeg ? "JPEG" : "PNG";
const b64 = bytes.toString("base64");

const out = `/** Logo Ineco embebido para el PDF (${width}x${height}). */
export const LOGO_INECO_FORMAT = "${format}" as const;
export const LOGO_INECO_WIDTH = ${width || 400};
export const LOGO_INECO_HEIGHT = ${height || 120};
export const LOGO_INECO_DATA_URL =
  "data:${mime};base64,${b64}";
`;

fs.writeFileSync("src/assets/logoIneco.ts", out);
console.log({ isJpeg, width, height, bytes: bytes.length });
