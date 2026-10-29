/**
 * Catálogo clínico de orientación (primera vez / oportunidad).
 * Se usa para clasificar el motivo de consulta y etiquetar la conversación.
 */

export type MotivoCatalogoItem = {
  /** Nombre de etiqueta en el CRM. */
  nombre: string;
  /** adulto | infanto | ambos */
  ambito: "adulto" | "infanto" | "ambos";
  /** Frases / síntomas típicos que el paciente puede decir. */
  sintomas: string[];
  /** Alias cortos del diagnóstico (ACV, DFT, TDAH…). */
  alias?: string[];
};

export const MOTIVOS_CATALOGO: MotivoCatalogoItem[] = [
  {
    nombre: "Afasia / Disartria / Disfagia",
    ambito: "adulto",
    alias: ["afasia", "disartria", "disfagia"],
    sintomas: [
      "problemas del lenguaje",
      "dificultades de comunicacion",
      "perdida del lenguaje",
      "trastorno del lenguaje",
      "problemas para encontrar palabras",
      "secuela de acv",
      "dificultad para hablar",
      "cuesta tragar",
      "no puedo hablar bien",
    ],
  },
  {
    nombre: "Atrofia cortical posterior (ACP)",
    ambito: "adulto",
    alias: ["acp", "atrofia cortical posterior"],
    sintomas: [
      "me cuesta ver pero el oftalmologo",
      "problemas para reconocer lo que estoy viendo",
      "cuesta identificar objetos",
      "dificultad para orientarme",
      "ubicarme en los espacios",
      "calcular distancias",
      "me choco con objetos",
      "problemas para reconocer caras",
      "no registro bien los objetos",
    ],
  },
  {
    nombre: "Degeneración córticobasal",
    ambito: "adulto",
    alias: ["corticobasal", "degeneracion corticobasal"],
    sintomas: [
      "rigidez en una extremidad",
      "dificultad para mover un lado",
      "alteraciones de la coordinacion",
      "dificultades para caminar",
      "mantener el equilibrio",
      "movimientos involuntarios",
      "actividades cotidianas",
    ],
  },
  {
    nombre: "Demencia frontotemporal (DFT)",
    ambito: "adulto",
    alias: ["dft", "demencia frontotemporal", "demencia mixta"],
    sintomas: [
      "cambio de comportamiento",
      "cambió mucho su forma de comportarse",
      "hace cosas que antes no hacia",
      "desinhibido",
      "impulsivo",
      "conductas extranas",
      "conductas inapropiadas",
      "apatico",
      "sin iniciativa",
      "cambios en la personalidad",
      "conductas repetitivas",
      "cada vez habla menos",
      "problemas de conducta",
      "le diagnosticaron dft",
      "demencia frontotemporal",
    ],
  },
  {
    nombre: "Deterioro cognitivo leve (DCL)",
    ambito: "adulto",
    alias: ["dcl", "deterioro cognitivo leve", "deterioro cognitivo vascular"],
    sintomas: [
      "olvidos",
      "dificultades de atencion",
      "concentracion",
      "problemas para encontrar palabras",
      "dificultades de organizacion",
      "planificacion",
      "enlentecimiento cognitivo",
      "me olvido las cosas",
    ],
  },
  {
    nombre: "Enfermedad de Huntington",
    ambito: "adulto",
    alias: ["huntington"],
    sintomas: [
      "movimientos involuntarios",
      "dificultades de coordinacion",
      "equilibrio",
      "cambios en la conducta",
      "estado de animo",
      "dificultades cognitivas progresivas",
    ],
  },
  {
    nombre: "Enfermedad de Alzheimer",
    ambito: "adulto",
    alias: ["alzheimer"],
    sintomas: [
      "dificultades progresivas de memoria",
      "desorientacion",
      "problemas para encontrar palabras",
      "actividades habituales",
      "funcionamiento cognitivo",
      "alzheimer",
    ],
  },
  {
    nombre: "Enfermedad de Parkinson",
    ambito: "adulto",
    alias: ["parkinson"],
    sintomas: [
      "temblor en reposo",
      "rigidez muscular",
      "lentitud de movimientos",
      "dificultades para caminar",
      "iniciar movimientos",
      "alteraciones del equilibrio",
      "cambios en la marcha",
    ],
  },
  {
    nombre: "Epilepsia",
    ambito: "ambos",
    alias: ["epilepsia", "convulsiones"],
    sintomas: [
      "perdida de conciencia",
      "desconexion",
      "convulsiones",
      "periodos de confusion",
      "falta de recuerdo del episodio",
      "crisis epileptica",
    ],
  },
  {
    nombre: "Parálisis supranuclear progresiva (PSP)",
    ambito: "adulto",
    alias: ["psp", "paralisis supranuclear"],
    sintomas: [
      "dificultades para caminar",
      "mantener el equilibrio",
      "caidas frecuentes",
      "rigidez",
      "lentitud de movimientos",
      "movimientos oculares",
      "dificultades para hablar o tragar",
    ],
  },
  {
    nombre: "Traumatismo de cráneo (TEC)",
    ambito: "ambos",
    alias: ["tec", "traumatismo de craneo", "golpe en la cabeza"],
    sintomas: [
      "golpe fuerte en la cabeza",
      "sacudida brusca",
      "lesion en la cabeza",
      "traumatismo craneal",
      "tec",
    ],
  },
  {
    nombre: "Tumor cerebral / columna",
    ambito: "ambos",
    alias: ["tumor cerebral", "tumor de columna", "tumor"],
    sintomas: ["tumor cerebral", "tumor de columna", "tumor en la cabeza"],
  },
  {
    nombre: "Problemas de memoria",
    ambito: "adulto",
    alias: ["memoria"],
    sintomas: [
      "repite la misma pregunta",
      "repite la misma historia",
      "confunde las fechas",
      "dias de la semana",
      "se desoriento",
      "problemas de memoria",
      "olvidos frecuentes",
    ],
  },
  {
    nombre: "Déficit en habilidades sociales",
    ambito: "ambos",
    alias: ["habilidades sociales"],
    sintomas: [
      "dificultades para iniciar conversaciones",
      "mantener conversaciones",
      "relacionarse con otras personas",
      "interpretar senales sociales",
      "normas sociales",
    ],
  },
  {
    nombre: "Discapacidad intelectual en adultos",
    ambito: "adulto",
    alias: ["discapacidad intelectual"],
    sintomas: [
      "dificultades en el aprendizaje",
      "comprension",
      "resolucion de problemas",
      "autonomia",
      "actividades de la vida cotidiana",
    ],
  },
  {
    nombre: "Depresión",
    ambito: "ambos",
    alias: ["depresion", "deprimido"],
    sintomas: [
      "tristeza persistente",
      "perdida de interes",
      "falta de energia",
      "motivacion",
      "alteraciones del sueno",
      "apetito",
      "irritabilidad",
      "estoy deprimido",
    ],
  },
  {
    nombre: "Duelo patológico",
    ambito: "adulto",
    alias: ["duelo"],
    sintomas: [
      "persona fallecida",
      "no puede avanzar despues de la perdida",
      "pensamientos recurrentes sobre la persona fallecida",
      "duelo",
    ],
  },
  {
    nombre: "Estrés postraumático",
    ambito: "ambos",
    alias: ["tept", "estres postraumatico", "trauma"],
    sintomas: [
      "pesadillas",
      "acontecimiento traumatico",
      "evitacion",
      "estado de alerta",
      "sobresalto",
      "estres postraumatico",
    ],
  },
  {
    nombre: "Esquizofrenia",
    ambito: "adulto",
    alias: ["esquizofrenia"],
    sintomas: [
      "alucinaciones",
      "ideas delirantes",
      "persecucion",
      "desconfianza marcada",
      "alteraciones del pensamiento",
      "esquizofrenia",
    ],
  },
  {
    nombre: "Fobias",
    ambito: "ambos",
    alias: ["fobia", "fobia social"],
    sintomas: [
      "ansiedad intensa ante situaciones sociales",
      "miedo a ser observado",
      "evaluado negativamente",
      "evitacion de situaciones sociales",
      "fobia",
    ],
  },
  {
    nombre: "Pérdida del control de impulsos",
    ambito: "adulto",
    alias: ["impulsos", "control de impulsos"],
    sintomas: [
      "conductas impulsivas",
      "actuar sin pensar",
      "dificultad para controlar reacciones",
      "dificultad para inhibir conductas",
    ],
  },
  {
    nombre: "Trastorno de ansiedad generalizada (TAG)",
    ambito: "ambos",
    alias: ["tag", "ansiedad generalizada"],
    sintomas: [
      "preocupacion excesiva",
      "dificil de controlar",
      "tension",
      "nerviosismo",
      "dificultad para relajarse",
      "ansiedad generalizada",
    ],
  },
  {
    nombre: "Trastorno de pánico",
    ambito: "ambos",
    alias: ["panico", "ataque de panico"],
    sintomas: [
      "episodios repentinos de miedo",
      "palpitaciones",
      "falta de aire",
      "sensacion de perdida de control",
      "ataque de panico",
      "crisis de panico",
      "trastorno de panico",
      "ataques de panico",
    ],
  },
  {
    nombre: "Trastorno obsesivo compulsivo (TOC)",
    ambito: "ambos",
    alias: ["toc"],
    sintomas: [
      "pensamientos recurrentes",
      "rituales",
      "comprobaciones repetitivas",
      "limpieza excesiva",
      "obsesiones",
      "compulsiones",
      "toc",
    ],
  },
  {
    nombre: "Trastornos bipolares",
    ambito: "adulto",
    alias: ["bipolar", "trastorno bipolar"],
    sintomas: [
      "animo elevado",
      "aumento de energia",
      "menor necesidad de dormir",
      "impulsividad",
      "animo deprimido",
      "trastorno bipolar",
      "bipolar",
    ],
  },
  {
    nombre: "Autismo / TEA",
    ambito: "ambos",
    alias: ["autismo", "tea", "espectro autista"],
    sintomas: [
      "contacto visual",
      "no responde al nombre",
      "entender gestos",
      "expresiones faciales",
      "tono de voz",
      "conversacion reciproca",
      "falta de empatia",
      "autismo",
      "tea",
    ],
  },
  {
    nombre: "TDAH",
    ambito: "ambos",
    alias: ["tdah", "deficit de atencion", "hiperactividad"],
    sintomas: [
      "dificultad para mantener la atencion",
      "olvidos frecuentes",
      "perdida de cosas",
      "organizar tareas",
      "seguir instrucciones",
      "no escucha",
      "distraccion facil",
      "exceso de movimiento",
      "impulsados por un motor",
      "tdah",
      "hiperactivo",
    ],
  },
  {
    nombre: "Trastornos del sueño",
    ambito: "ambos",
    alias: ["apnea", "insomnio", "trastornos del sueno"],
    sintomas: [
      "ronquidos",
      "pausas en la respiracion",
      "despertares abruptos",
      "asfixia",
      "somnolencia diurna",
      "cansancio cronico",
      "dolor de cabeza matutino",
      "insomnio",
      "no puedo dormir",
      "apnea",
    ],
  },
  {
    nombre: "Síndrome de piernas inquietas",
    ambito: "ambos",
    alias: ["piernas inquietas"],
    sintomas: [
      "tiron",
      "jalon",
      "sensacion de arrastre",
      "hormigueo",
      "cosquilleo",
      "ardor",
      "sensacion electrica",
      "picazon profunda",
      "piernas inquietas",
    ],
  },
  {
    nombre: "Cefalea y migrañas",
    ambito: "ambos",
    alias: ["cefalea", "migrana", "dolor de cabeza"],
    sintomas: [
      "presion constante",
      "opresion",
      "dolor sordo",
      "dolor pulsatil",
      "palpitante",
      "migrana",
      "cefalea",
      "dolor de cabeza",
    ],
  },
  {
    nombre: "Mareos y vértigo",
    ambito: "ambos",
    alias: ["vertigo", "mareos"],
    sintomas: ["vertigo", "mareos", "me mareo", "todo da vueltas"],
  },
  {
    nombre: "Trastornos generalizados del desarrollo (TGD)",
    ambito: "infanto",
    alias: ["tgd"],
    sintomas: [
      "trastorno generalizado del desarrollo",
      "tgd",
      "retraso del desarrollo",
    ],
  },
  {
    nombre: "Trastorno del desarrollo del lenguaje",
    ambito: "infanto",
    alias: ["desarrollo del lenguaje", "retraso del lenguaje"],
    sintomas: [
      "retraso en las primeras palabras",
      "vocabulario muy reducido",
      "dificultad para formar frases",
      "habla poco clara",
      "ininteligible",
      "retraso del lenguaje",
    ],
  },
  {
    nombre: "Trastornos de ansiedad en niños y adolescentes",
    ambito: "infanto",
    alias: ["ansiedad infantil"],
    sintomas: [
      "irritabilidad y enojo constante",
      "preocupaciones incontrolables",
      "necesidad de aprobacion constante",
      "ansiedad en ninos",
      "ansiedad adolescente",
    ],
  },
  {
    nombre: "TOC en niños y adolescentes",
    ambito: "infanto",
    alias: ["toc infantil"],
    sintomas: [
      "rituales en ninos",
      "comprobaciones repetitivas",
      "limpieza excesiva",
      "toc infantil",
    ],
  },
  {
    nombre: "Tourette y tics",
    ambito: "ambos",
    alias: ["tourette", "tics"],
    sintomas: [
      "parpadear constantemente",
      "muecas",
      "encoger los hombros",
      "sacudir la cabeza",
      "tics",
      "tourette",
      "movimientos repetitivos involuntarios",
    ],
  },
];

function norm(texto: string): string {
  return String(texto || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

export function nombresMotivosCatalogo(): string[] {
  return MOTIVOS_CATALOGO.map((item) => item.nombre);
}

/** Lista compacta para el prompt de la IA. */
export function textoMotivosCatalogoParaPrompt(): string {
  return MOTIVOS_CATALOGO.map((item) => {
    const pistas = [...(item.alias ?? []), ...item.sintomas.slice(0, 4)].join("; ");
    return `- ${item.nombre}: ${pistas}`;
  }).join("\n");
}

export type MotivoMatch = { nombre: string; score: number };

/** Coincidencia de palabra/frase completa (evita que "temblor" dispare pánico por "temblores" sueltos en otro contexto). */
function incluyeFrase(haystack: string, needle: string): boolean {
  const n = norm(needle);
  if (n.length < 4) return false;
  if (n.includes(" ")) return haystack.includes(n);
  const re = new RegExp(`(?:^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`, "i");
  return re.test(haystack);
}

/**
 * Puntúa el texto del motivo contra el catálogo.
 * Prioriza mención explícita del diagnóstico / alias; síntomas solo con frases claras.
 */
export function matchMotivoCatalogo(texto: string, limite = 1): MotivoMatch[] {
  const buscado = norm(texto);
  if (buscado.length < 3) return [];

  const scored: MotivoMatch[] = [];
  for (const item of MOTIVOS_CATALOGO) {
    let score = 0;
    let mencionesFuertes = 0;
    const nombreN = norm(item.nombre);
    // Nombre completo del ítem (no al revés: evita que un texto corto matchee un nombre largo).
    if (nombreN.length >= 5 && buscado.includes(nombreN)) {
      score += 120;
      mencionesFuertes += 1;
    }
    for (const alias of item.alias ?? []) {
      if (incluyeFrase(buscado, alias)) {
        const a = norm(alias);
        score += a.length >= 6 ? 100 : 70;
        mencionesFuertes += 1;
      }
    }
    let sintomaHits = 0;
    for (const sintoma of item.sintomas) {
      const s = norm(sintoma);
      // Frases de síntoma: exigir ≥ 2 palabras o ≥ 12 chars para bajar falsos positivos.
      if (s.length < 8 && !s.includes(" ")) continue;
      if (incluyeFrase(buscado, s) || (s.includes(" ") && buscado.includes(s))) {
        score += Math.min(35, 10 + Math.floor(s.length / 5));
        sintomaHits += 1;
      }
    }
    // Sin mención del diagnóstico, hace falta más de un síntoma claro.
    if (mencionesFuertes === 0 && sintomaHits < 2 && score < 50) continue;
    if (score > 0) scored.push({ nombre: item.nombre, score });
  }

  const orden = scored.sort(
    (a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre, "es"),
  );
  if (!orden.length) return [];
  const top = orden[0]!;
  // Un solo diagnóstico salvo empate muy claro del 2.º.
  const out = [top];
  if (limite > 1 && orden[1] && orden[1].score >= Math.max(90, top.score * 0.92)) {
    out.push(orden[1]);
  }
  return out.filter((m) => m.score >= 55).slice(0, Math.max(1, limite));
}

/**
 * Solo mención explícita del diagnóstico o alias (ej. "Parkinson", "TDAH").
 * No usa síntomas sueltos: evita etiquetar pánico/Parkinson por temblor + nervios.
 */
export function matchMotivoCatalogoExplicito(texto: string): MotivoMatch | null {
  const buscado = norm(texto);
  if (buscado.length < 3) return null;
  let mejor: MotivoMatch | null = null;
  for (const item of MOTIVOS_CATALOGO) {
    let score = 0;
    const nombreN = norm(item.nombre);
    if (nombreN.length >= 5 && buscado.includes(nombreN)) score += 120;
    for (const alias of item.alias ?? []) {
      if (!incluyeFrase(buscado, alias)) continue;
      const a = norm(alias);
      score += a.length >= 6 ? 100 : 70;
    }
    if (score < 70) continue;
    if (!mejor || score > mejor.score) mejor = { nombre: item.nombre, score };
  }
  return mejor;
}

/** Resuelve un nombre libre (IA) al ítem exacto del catálogo. */
export function resolverNombreMotivoCatalogo(crudo: string): string {
  const t = norm(crudo);
  if (!t) return "";
  const exacto = MOTIVOS_CATALOGO.find((item) => norm(item.nombre) === t);
  if (exacto) return exacto.nombre;
  // Alias exacto o contenido (parkinson → Enfermedad de Parkinson).
  const porAlias = MOTIVOS_CATALOGO.find((item) =>
    (item.alias ?? []).some((a) => {
      const na = norm(a);
      return na === t || (na.length >= 5 && (t.includes(na) || na.includes(t)));
    }),
  );
  if (porAlias) return porAlias.nombre;
  const parcial = MOTIVOS_CATALOGO.find((item) => {
    const n = norm(item.nombre);
    return n === t || (t.length >= 8 && n.includes(t)) || (n.length >= 8 && t.includes(n));
  });
  return parcial?.nombre ?? "";
}
