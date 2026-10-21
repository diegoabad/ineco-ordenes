/** Guarda nombres en minúsculas; muestra Title Case. */

export function normalizeNombrePersona(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-AR");
}

const NOMBRES_FEMENINOS = new Set(
  [
    "ana", "angela", "agustina", "abril", "ayelen", "ayelén", "belen", "belén", "brenda",
    "carla", "carolina", "catalina", "cecilia", "celeste", "clara", "constanza", "daniela",
    "deborah", "diana", "elena", "elisa", "elsa", "emilse", "emilia", "eva", "florencia",
    "gabriela", "gisela", "graciela", "irina", "irma", "jimena", "josefina", "julia", "juliana",
    "karina", "laura", "leticia", "lola", "lorena", "lucia", "lucía", "luciana", "luisa",
    "magali", "mailen", "manuela", "marcela", "maria", "maría", "mariana", "marina", "marta",
    "melina", "mercedes", "milagros", "miriam", "monica", "mónica", "natalia", "nicole",
    "nilda", "noelia", "nora", "norma", "olga", "paola", "patricia", "paula", "paz", "pilar",
    "ramona", "raquel", "rita", "roca", "romina", "rosa", "roxana", "silvia", "sofia", "sofía",
    "sol", "soledad", "susana", "tamara", "valentina", "valeria", "vanesa", "vanessa", "vera",
    "veronica", "verónica", "victoria", "virginia", "viviana", "ximena", "yamila", "yesica",
    "yésica", "zoe", "zoé",
  ].map((n) => n.normalize("NFD").replace(/\p{M}/gu, "")),
);

const NOMBRES_MASCULINOS = new Set(
  [
    "adrian", "agustin", "agustín", "alejandro", "alfredo", "andres", "andrés", "angel",
    "antonio", "ariel", "bruno", "carlos", "cesar", "césar", "cristian", "daniel", "dante",
    "david", "diego", "eduardo", "emiliano", "emilio", "enrique", "esteban", "ezequiel",
    "facundo", "federico", "felipe", "fernando", "francisco", "franco", "gabriel", "german",
    "germán", "gonzalo", "guillermo", "gustavo", "hector", "héctor", "hernán", "hernan",
    "horacio", "hugo", "ignacio", "ivan", "iván", "javier", "joaquin", "joaquín", "jorge",
    "jose", "josé", "juan", "julian", "julián", "julio", "kevin", "lautaro", "leonardo",
    "lucas", "luis", "manuel", "marcelo", "marco", "mariano", "mario", "martin", "martín",
    "mateo", "matias", "matías", "mauricio", "maximiliano", "miguel", "nahuel", "nicolas",
    "nicolás", "oscar", "óscar", "pablo", "pedro", "rafael", "ramiro", "raul", "raúl",
    "ricardo", "roberto", "rodolfo", "rodrigo", "ruben", "rubén", "samuel", "santiago",
    "sebastian", "sebastián", "sergio", "tomas", "tomás", "vicente", "victor", "víctor",
    "walter",
  ].map((n) => n.normalize("NFD").replace(/\p{M}/gu, "")),
);

/** Infiere masculino/femenino por el primer nombre, si es claro. Vacío si es ambiguo. */
export function sexoDesdeNombre(nombre: string): "" | "masculino" | "femenino" {
  const primero = normalizeNombrePersona(nombre)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(" ")[0]
    ?.replace(/[^a-zñ]/g, "");
  if (!primero || primero.length < 2) return "";
  if (NOMBRES_FEMENINOS.has(primero)) return "femenino";
  if (NOMBRES_MASCULINOS.has(primero)) return "masculino";
  // Terminaciones muy habituales en español (José/Matías ya están en la lista).
  if (/a$/.test(primero) && !/^(joshua|judas|elias|matias|lucas|tomas|nicolas)$/.test(primero)) {
    return "femenino";
  }
  return "";
}

/** Padre/Madre/Hijo/Hija, etc. */
export function sexoDesdeRelacion(relacion: string): "" | "masculino" | "femenino" {
  const t = normalizeNombrePersona(relacion).normalize("NFD").replace(/\p{M}/gu, "");
  if (/^(madre|abuela|hija|tia|sobrina|esposa|novia)$/.test(t)) return "femenino";
  if (/^(padre|abuelo|hijo|tio|sobrino|esposo|novio)$/.test(t)) return "masculino";
  return "";
}

/** Primera letra de cada palabra en mayúscula (para PDF / email). */
export function formatNombrePersona(value: string): string {
  const n = normalizeNombrePersona(value);
  if (!n) return "";
  return n
    .split(" ")
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase("es-AR") + w.slice(1) : w))
    .join(" ");
}
