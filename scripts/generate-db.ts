import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeployDb } from "../src/data/buildSeed";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src", "data", "db.json");

const db = buildDeployDb();
writeFileSync(out, `${JSON.stringify(db, null, 2)}\n`, "utf8");
console.log(`OK → ${out}`);
console.log(`  médicos: ${db.medicos.length}, pacientes: ${db.pacientes.length}`);
