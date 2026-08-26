import multer from "multer";
import { env } from "../config/env.js";

export const uploadFirma = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxFirmaBytes },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Solo se permiten imágenes"));
      return;
    }
    cb(null, true);
  },
});
