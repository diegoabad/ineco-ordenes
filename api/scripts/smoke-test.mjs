import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const API = process.env.API_URL ?? "http://localhost:3001";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const testImage = path.join(root, "test-firma.png");

async function api(pathname, options = {}) {
  const res = await fetch(`${API}${pathname}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${options.method ?? "GET"} ${pathname} → ${res.status}: ${data.message ?? res.statusText}`);
  }
  return data;
}

async function main() {
  console.log("1. Health...");
  const health = await api("/health");
  if (!health.ok) throw new Error("Health check falló");

  console.log("2. Crear médico...");
  const medicoRes = await api("/api/medicos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre: "Dr. Prueba Smoke",
      especialidad: "Médico de prueba",
      matricula: "999999",
    }),
  });
  const medico = medicoRes.data;
  if (!medico?.id) throw new Error("No se devolvió id de médico");
  console.log(`   OK → ${medico.id}`);

  console.log("3. Crear paciente...");
  const pacienteRes = await api("/api/pacientes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paciente: "Paciente Prueba Smoke",
      obraSocial: "OSDE",
      afiliado: "123456",
      prestacion: "Consulta neurología",
      diagnostico: "TDAH",
      medicoId: medico.id,
    }),
  });
  const paciente = pacienteRes.data;
  if (!paciente?.id) throw new Error("No se devolvió id de paciente");
  console.log(`   OK → ${paciente.id}`);

  console.log("4. Subir firma...");
  await sharp({
    create: { width: 240, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toFile(testImage);

  const form = new FormData();
  form.append("firma", new Blob([fs.readFileSync(testImage)], { type: "image/png" }), "firma.png");

  const firmaRes = await api(`/api/medicos/${medico.id}/firma`, {
    method: "POST",
    body: form,
  });
  if (!firmaRes.data?.firmaUrl) throw new Error("No se guardó firmaUrl");
  console.log(`   OK → ${firmaRes.data.firmaUrl} (${firmaRes.meta?.sizeBytes ?? "?"} bytes)`);

  console.log("5. Verificar imagen accesible...");
  const imgRes = await fetch(`${API}${firmaRes.data.firmaUrl}`);
  if (!imgRes.ok) throw new Error(`Imagen no accesible: ${imgRes.status}`);
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  if (imgBuf.length < 50) throw new Error("Imagen demasiado chica");
  console.log(`   OK → ${imgBuf.length} bytes servidos`);

  console.log("6. Verificar en /api/db...");
  const db = await api("/api/db");
  const medicoDb = db.data.medicos.find((m) => m.id === medico.id);
  const pacienteDb = db.data.pacientes.find((p) => p.id === paciente.id);
  if (!medicoDb?.firmaUrl) throw new Error("Médico sin firma en DB");
  if (!pacienteDb) throw new Error("Paciente no está en DB");
  console.log("   OK → datos persistidos");

  console.log("7. Limpiar datos de prueba...");
  await api(`/api/pacientes/${paciente.id}`, { method: "DELETE" });
  await api(`/api/medicos/${medico.id}`, { method: "DELETE" });
  fs.unlinkSync(testImage);
  console.log("   OK → eliminados");

  console.log("\n✓ Todos los tests pasaron");
}

main().catch((err) => {
  console.error("\n✗", err.message);
  process.exit(1);
});
