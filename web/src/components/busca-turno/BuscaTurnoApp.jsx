import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'react-toastify';
import { IconX, IconBuilding, IconMonitor, IconTrash } from '../Icons';
import { apiPost, getPersona, createTurno, config } from './medexisApi';
import { fetchBuscaTurnoConfig, saveBuscaTurnoConfig } from './buscaTurnoConfigApi';
import SearchableSelect from './SearchableSelect';
import './BuscaTurnoApp.css';

const CACHE_KEY = 'buscador-turnos-cache-v2';
const SEDES_LS_KEY = 'buscador-turnos-sedes-carga-v1';

/** Sedes que la API y esta app conocen (orden fijo para radios). */
const SEDES_DISPONIBLES = ['INECO'];

/** Por ahora solo INECO; si había otra sede guardada, migra a INECO. */
function readSedesCarga() {
  try {
    const raw = localStorage.getItem(SEDES_LS_KEY);
    if (!raw) return ['INECO'];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return ['INECO'];
    const ok = arr.filter((s) => SEDES_DISPONIBLES.includes(String(s).trim()));
    if (!ok.length || ok[0] !== 'INECO') {
      const single = ['INECO'];
      try {
        localStorage.setItem(SEDES_LS_KEY, JSON.stringify(single));
      } catch {
        /* ignore */
      }
      return single;
    }
    return ['INECO'];
  } catch {
    return ['INECO'];
  }
}

/** Para modal de sede / Config (hoy solo INECO). */
function sedesToModo(_sedes) {
  return 'ineco';
}

function modoToSedes(_modo) {
  return ['INECO'];
}

function writeSedesCarga(arr) {
  try {
    localStorage.setItem(SEDES_LS_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

/** Filtro UI (client-side). Medexis no discrimina bien por modalidad en Disponible. */
const MODALIDADES = [
  { value: 'TODOS', label: 'Todos' },
  { value: 'PRESENCIAL', label: 'Presencial' },
  { value: 'VIRTUAL', label: 'Virtual' },
];

/** Las agendas pueden ir de 15, 30 o 45 min. Las duraciones del buscador saltan de 15 en 15. */
const PASO_MIN = 15;
const DURACIONES_MIN = [15, 30, 45, 60, 75, 90, 105, 120];
const REGLA_MODALIDADES = [
  { value: 'TODAS', label: 'Todas' },
  { value: 'PRESENCIAL', label: 'Presencial' },
  { value: 'VIRTUAL', label: 'Virtual' },
];

function modalidadReglaValida(value) {
  return value === 'TODAS' || value === 'PRESENCIAL' || value === 'VIRTUAL';
}

function labelModalidadRegla(value) {
  if (value === 'TODAS') return 'Todas';
  if (value === 'VIRTUAL') return 'Virtual';
  return 'Presencial';
}

function labelDuracion(min) {
  const n = Number(min);
  if (n === 120) return '120 min (2 h)';
  return `${n} min`;
}

/** Una sola regla por profesional + prestación + modalidad. */
function normalizeReglas(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const profesionalDoc = String(raw.profesionalDoc || '').trim();
    const prestacionCodigo = String(raw.prestacionCodigo || '').trim();
    const modalidad = modalidadReglaValida(raw.modalidad) ? raw.modalidad : '';
    const duracionMin = Number(raw.duracionMin);
    if (!profesionalDoc || !prestacionCodigo || !modalidad) continue;
    if (!DURACIONES_MIN.includes(duracionMin)) continue;
    const id = `${profesionalDoc}|${prestacionCodigo}|${modalidad}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, profesionalDoc, prestacionCodigo, modalidad, duracionMin });
  }
  return out;
}

function reglaKey(doc, prestacion, modalidad) {
  return `${String(doc)}|${String(prestacion)}|${modalidad}`;
}

/** Virtual = edificio "Video-Consulta Medexis" (sector vacío en la práctica). */
function isSlotVirtual(edificio) {
  return /video\s*-?\s*consulta\s*medexis/i.test(String(edificio ?? ''));
}

function slotModalidadLabel(edificio) {
  return isSlotVirtual(edificio) ? 'Virtual' : 'Presencial';
}

const DEFAULT_DURACION = 15;

/** Cuántas peticiones PRESTADOR (por profesional) van en paralelo; el resto espera en cola por lotes. */
const PRESTADOR_FETCH_BATCH_SIZE = 8;
/** Pausa entre lotes (ms) para no saturar Medexis ni el proxy. */
const PRESTADOR_FETCH_BATCH_PAUSE_MS = 40;

/** Solo estas prestaciones quedan habilitadas por defecto (resto deshabilitadas). Códigos comparados como número. */
const PRESTACIONES_HABILITADAS_POR_DEFECTO = new Set([
  12034, 7013, 7014, 7011, 7010, 4005, 4006, 9006, 9007, 11010, 9001, 9002, 6004, 6005, 8001,
  14003, 14004, 12032, 12035, 10001, 12002, 420904, 12031, 12010,
]);

function prestacionEnabledPorDefecto(cod) {
  const n = parseInt(String(cod).replace(/\D/g, ''), 10);
  return !Number.isNaN(n) && PRESTACIONES_HABILITADAS_POR_DEFECTO.has(n);
}

const PREST_WHITELIST_MIGRATION_LS = 'buscador-turnos-prest-whitelist-v1';

function applyPrestacionesWhitelistIfNeeded(data) {
  if (!data?.prestaciones || typeof data.prestaciones !== 'object') return data;
  if (localStorage.getItem(PREST_WHITELIST_MIGRATION_LS)) return data;
  try {
    localStorage.setItem(PREST_WHITELIST_MIGRATION_LS, '1');
  } catch {
    return data;
  }
  const prestaciones = {};
  for (const [cod, v] of Object.entries(data.prestaciones)) {
    prestaciones[cod] = {
      ...v,
      enabled: prestacionEnabledPorDefecto(cod),
    };
  }
  const next = { ...data, prestaciones };
  setCachedFull(next);
  return next;
}

function parseCache(raw) {
  try {
    const data = JSON.parse(raw);
    if (data?.version === 2 && data.profesionales && data.prestaciones) {
      return data;
    }
    if (data?.prestaciones && typeof data.prestaciones === 'object' && !data.version) {
      const prestaciones = {};
      const profMap = new Map();
      for (const [cod, v] of Object.entries(data.prestaciones)) {
        prestaciones[cod] = {
          nombre: v.nombre || cod,
          duracion: DEFAULT_DURACION,
          enabled: prestacionEnabledPorDefecto(cod),
          profesionales: v.profesionales || [],
        };
        for (const pr of v.profesionales || []) {
          if (pr?.doc && !profMap.has(String(pr.doc))) {
            profMap.set(String(pr.doc), {
              doc: String(pr.doc),
              nombre: pr.nombre || '',
              sede: pr.sede || 'INECO',
              enabled: true,
            });
          }
        }
      }
      return { version: 2, profesionales: [...profMap.values()], prestaciones };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function getCachedFull() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      const old = localStorage.getItem('buscador-turnos-prestaciones');
      if (old) return applyPrestacionesWhitelistIfNeeded(parseCache(old));
      return null;
    }
    return applyPrestacionesWhitelistIfNeeded(parseCache(raw));
  } catch {
    return null;
  }
}

function setCachedFull(payload) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ version: 2, ...payload, savedAt: Date.now() })
    );
  } catch (e) {
    console.warn('No se pudo guardar en caché', e);
  }
}

function configLooksPopulated(cfg) {
  return !!(
    cfg?.profesionales?.length &&
    cfg?.prestaciones &&
    Object.keys(cfg.prestaciones).length > 0
  );
}

/** Preferir Firebase; si no hay, localStorage. Devuelve shape v2. */
async function resolveStoredConfig() {
  try {
    const remote = await fetchBuscaTurnoConfig();
    if (configLooksPopulated(remote)) {
      setCachedFull({
        profesionales: remote.profesionales,
        prestaciones: remote.prestaciones,
        reglas: normalizeReglas(remote.reglas),
      });
      return {
        version: 2,
        profesionales: remote.profesionales,
        prestaciones: remote.prestaciones,
        reglas: normalizeReglas(remote.reglas),
        sedesCarga: Array.isArray(remote.sedesCarga) ? remote.sedesCarga : undefined,
        _source: 'firebase',
      };
    }
  } catch (e) {
    console.warn('No se pudo leer config Busca turno desde Firebase', e);
  }
  const local = getCachedFull();
  if (configLooksPopulated(local)) {
    return { ...local, _source: 'local' };
  }
  return null;
}

/**
 * Actualiza nombres y vínculos desde Medexis.
 * El tilde de una prestación que ya estaba se conserva (borrador primero, después lo guardado).
 * Las que Medexis no devolvió en esta pasada también se quedan, para que no reaparezcan tildadas.
 * Solo en la primera carga, sin nada guardado, se usa la lista por defecto.
 */
function mergePrestacionesFromFetch(prevPrestaciones, newMap, enabledDocs, draftRows) {
  const enabledSet = new Set((enabledDocs || []).map((d) => String(d)));
  const draftEnabled = new Map(
    (draftRows || []).map((r) => [String(r.codigo), !!r.enabled])
  );
  const prev = prevPrestaciones || {};
  const primeraCarga = Object.keys(prev).length === 0 && draftEnabled.size === 0;
  const merged = {};

  for (const cod of new Set([...Object.keys(newMap || {}), ...Object.keys(prev)])) {
    const fresh = newMap?.[cod];
    const old = prev[cod];
    const nombre = fresh?.nombre || old?.nombre || cod;
    const duracion =
      typeof old?.duracion === 'number' && old.duracion > 0
        ? old.duracion
        : DEFAULT_DURACION;
    let enabled;
    if (draftEnabled.has(String(cod))) enabled = draftEnabled.get(String(cod));
    else if (old) enabled = old.enabled !== false;
    else enabled = primeraCarga ? prestacionEnabledPorDefecto(cod) : false;

    let profesionales;
    if (fresh?.profesionales?.length) {
      profesionales = fresh.profesionales.filter((p) => enabledSet.has(String(p.doc)));
      const ya = new Set(profesionales.map((p) => String(p.doc)));
      for (const pr of old?.profesionales || []) {
        if (!ya.has(String(pr.doc)) && !enabledSet.has(String(pr.doc))) {
          profesionales.push(pr);
          ya.add(String(pr.doc));
        }
      }
    } else if (old?.profesionales?.length) {
      profesionales = old.profesionales;
    } else {
      profesionales = [];
    }

    merged[cod] = {
      nombre,
      duracion,
      enabled,
      profesionales,
    };
  }
  return merged;
}

function slotDedupeKey(s) {
  const d = s.fechaHora instanceof Date ? s.fechaHora : new Date(s.fechaHora);
  return `${String(s.profesionalDoc)}_${d.getTime()}`;
}

function dedupeSlotsRaw(slots) {
  const m = new Map();
  for (const s of slots) {
    const d = s.fechaHora instanceof Date ? s.fechaHora : new Date(s.fechaHora);
    const k = `${s.profesionalDoc}_${d.getTime()}`;
    if (!m.has(k)) m.set(k, { ...s, fechaHora: d });
  }
  return [...m.values()];
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function fmtDate(d) {
  return d.toISOString().split('T')[0];
}
function fmtDateKey(d) {
  return d.toISOString().split('T')[0];
}
function fmtDisplay(d) {
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}
function fmtDayLabel(d) {
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Día y mes con mayúscula inicial (p. ej. modal Asignar turno). */
function fmtDayLabelTitulo(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  const weekday = dt.toLocaleDateString('es-AR', { weekday: 'long' });
  const month = dt.toLocaleDateString('es-AR', { month: 'long' });
  const dayNum = dt.getDate();
  const w = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const m = month.charAt(0).toUpperCase() + month.slice(1);
  return `${w}, ${dayNum} de ${m}`;
}
function fmtTime(d) {
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function minutoSlot(s) {
  const d = s.fechaHora instanceof Date ? s.fechaHora : new Date(s.fechaHora);
  if (isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 60000);
}

/** Mismo profesional y mismo lugar: no se encadenan módulos de otra sede o edificio. */
function mismoBloque(a, b) {
  return (
    String(a.profesionalDoc) === String(b.profesionalDoc) &&
    String(a.edificio || '') === String(b.edificio || '') &&
    String(a.sector || '') === String(b.sector || '') &&
    String(a.sede || '') === String(b.sede || '')
  );
}

function mismoDiaMinutos(a, b) {
  const da = new Date(a * 60000);
  const db = new Date(b * 60000);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function gcdMin(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * Paso de la agenda de ESTE bloque, sin mirar otros profesionales.
 * 15, 30 o 45 si aparecen. Si solo se ven huecos más grandes (el módulo del medio
 * está ocupado), el paso es 15, 30 o 45 según el máximo común divisor.
 * Un hueco de 60 en una agenda de 30 no es un módulo de 60.
 */
function detectarPaso(minutos) {
  const counts = new Map();
  const gaps = [];
  for (let i = 1; i < minutos.length; i++) {
    const gap = minutos[i] - minutos[i - 1];
    if (gap <= 0 || gap % PASO_MIN !== 0) continue;
    if (!mismoDiaMinutos(minutos[i - 1], minutos[i])) continue;
    gaps.push(gap);
    if (gap === 15 || gap === 30 || gap === 45) {
      counts.set(gap, (counts.get(gap) || 0) + 1);
    }
  }
  let paso = null;
  let veces = 0;
  for (const p of [15, 30, 45]) {
    const n = counts.get(p) || 0;
    if (n > veces || (n === veces && n > 0 && paso != null && p > paso)) {
      paso = p;
      veces = n;
    }
  }
  if (paso) return paso;
  if (!gaps.length) return null;
  let g = gaps[0];
  for (let i = 1; i < gaps.length; i++) g = gcdMin(g, gaps[i]);
  for (const p of [45, 30, 15]) {
    if (g % p === 0) return p;
  }
  return null;
}

function ofertasDeUnModulo(byMin, moduloMin) {
  const out = [];
  for (const start of byMin.values()) {
    out.push({ ...start, modulos: [start], moduloMin });
  }
  return out;
}

/**
 * Ofertas que caben en `duracionMin` para los huecos que ya son de un solo
 * profesional y una sola duración. No se mezclan acá con otra agenda.
 * 45 es un módulo y 90 ocupa 9:00 y 9:45. En una agenda de 30, 60 ocupa
 * 10:00 y 10:30; 9:00 no entra si falta 9:30.
 * Sin regla, si esa duración no entra en la agenda, se muestran igual los huecos
 * para no hacer desaparecer al profesional.
 */
function armarOfertasPorDuracion(slots, duracionMin, opts) {
  const duracion = Number(duracionMin);
  const conservar = !!opts?.conservarSiNoEntra;
  if (!Number.isFinite(duracion) || duracion <= 0) return [];
  const byBloque = new Map();
  for (const s of slots) {
    const k = [
      String(s.profesionalDoc),
      String(s.edificio || ''),
      String(s.sector || ''),
      String(s.sede || ''),
    ].join('|');
    if (!byBloque.has(k)) byBloque.set(k, []);
    byBloque.get(k).push(s);
  }
  const ofertas = [];
  const duracionDeUnModulo = duracion === 15 || duracion === 30 || duracion === 45;
  for (const list of byBloque.values()) {
    const byMin = new Map();
    for (const s of list) {
      const min = minutoSlot(s);
      if (min == null || byMin.has(min)) continue;
      byMin.set(min, s);
    }
    const minutos = [...byMin.keys()].sort((a, b) => a - b);
    const paso = detectarPaso(minutos);
    if (!paso) {
      if (conservar || duracionDeUnModulo) {
        ofertas.push(...ofertasDeUnModulo(byMin, duracion));
      }
      continue;
    }
    if (duracion % paso !== 0) {
      if (conservar) ofertas.push(...ofertasDeUnModulo(byMin, paso));
      continue;
    }
    const needed = duracion / paso;
    const delBloque = [];
    for (const startMin of minutos) {
      const start = byMin.get(startMin);
      const modulos = [start];
      let ok = true;
      for (let i = 1; i < needed; i++) {
        const nextMin = startMin + i * paso;
        const next = byMin.get(nextMin);
        if (!next || !mismoBloque(start, next) || !mismoDiaMinutos(startMin, nextMin)) {
          ok = false;
          break;
        }
        modulos.push(next);
      }
      if (ok) delBloque.push({ ...start, modulos, moduloMin: paso });
    }
    if (delBloque.length) ofertas.push(...delBloque);
    else if (conservar) ofertas.push(...ofertasDeUnModulo(byMin, paso));
  }
  return ofertas;
}

function duracionDeSlot(slot, prestacionId, duracionGeneral, index) {
  const mod = isSlotVirtual(slot.edificio) ? 'VIRTUAL' : 'PRESENCIAL';
  const prest = prestacionId || slot.prestacionId;
  const especifica = index.get(reglaKey(slot.profesionalDoc, prest, mod));
  const todas = index.get(reglaKey(slot.profesionalDoc, prest, 'TODAS'));
  const porRegla = especifica != null || todas != null;
  const dur = porRegla ? (especifica != null ? especifica : todas) : duracionGeneral;
  return { mod, porRegla, dur };
}

/**
 * La duración se aplica después de la modalidad, y nunca mezclada:
 * cada profesional usa la suya (la regla si tiene, si no la del selector).
 * La grilla de uno no cambia el paso ni los huecos de otro.
 */
function armarOfertasConReglas(slots, prestacionId, duracionGeneral, reglas) {
  const index = new Map();
  for (const r of normalizeReglas(reglas)) {
    index.set(reglaKey(r.profesionalDoc, r.prestacionCodigo, r.modalidad), r.duracionMin);
  }
  const porProf = new Map();
  for (const s of slots) {
    const doc = String(s.profesionalDoc);
    if (!porProf.has(doc)) porProf.set(doc, []);
    porProf.get(doc).push(s);
  }
  const out = [];
  for (const list of porProf.values()) {
    const porDuracion = new Map();
    for (const s of list) {
      const info = duracionDeSlot(s, prestacionId, duracionGeneral, index);
      const k = `${info.mod}|${info.dur}|${info.porRegla ? '1' : '0'}`;
      if (!porDuracion.has(k)) porDuracion.set(k, { dur: info.dur, porRegla: info.porRegla, slots: [] });
      porDuracion.get(k).slots.push({ ...s, porRegla: info.porRegla, duracionMin: info.dur });
    }
    for (const grupo of porDuracion.values()) {
      // La regla solo recorta al profesional que la tiene. El resto usa la duración general
      // y, si no entra en su agenda, igual se muestran sus huecos.
      out.push(
        ...armarOfertasPorDuracion(grupo.slots, grupo.dur, {
          conservarSiNoEntra: !grupo.porRegla,
        })
      );
    }
  }
  return out;
}

function textoModulos(modulos) {
  const horas = (modulos || []).map((m) =>
    fmtTime(m.fechaHora instanceof Date ? m.fechaHora : new Date(m.fechaHora))
  );
  if (horas.length <= 1) return horas[0] || '';
  if (horas.length === 2) return `${horas[0]} y ${horas[1]}`;
  return `${horas.slice(0, -1).join(', ')} y ${horas[horas.length - 1]}`;
}

/** Medexis TurnoNuevo: "YYYY-MM-DD HH:mm:ss" (hora local). */
function formatTurnoFechaHoraMedexis(d) {
  const x = d instanceof Date && !isNaN(d.getTime()) ? d : new Date(d);
  if (isNaN(x.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`;
}

/** Medexis exige PersonaFechaNacimiento; usamos la fecha del día (YYYY-MM-DD). */
function fechaNacimientoHoyParaApi() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function titleCase(s) {
  if (!s) return '';
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** DNI/documento solo dígitos con separador de miles (ej. 12.345.678). */
function formatDocumentoMiles(doc) {
  const d = String(doc ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function profLabelConDoc(nombre, doc) {
  const n = titleCase(nombre || '');
  const f = formatDocumentoMiles(doc);
  return f ? `${n} (${f})` : n;
}

function sortProfesionalesAlfabetico(list) {
  return [...list].sort((a, b) =>
    String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', {
      sensitivity: 'base',
    })
  );
}

function App({ section = 'turnos', onRequestSection, onCatalogStatus }) {
  const configView = section === 'config';
  const [profesionalesCatalog, setProfesionalesCatalog] = useState([]);
  const [prestaciones, setPrestaciones] = useState({});
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [cacheDot, setCacheDot] = useState('loading');
  const [cacheLabel, setCacheLabel] = useState('Cargando...');
  const [progress, setProgress] = useState(null);
  const [status, setStatus] = useState({ text: '', error: false, visible: false });
  const [prestacionId, setPrestacionId] = useState('');
  const [modalidad, setModalidad] = useState('TODOS');
  const [duracionMin, setDuracionMin] = useState(30);
  const [searching, setSearching] = useState(false);
  const [slotsRaw, setSlotsRaw] = useState([]);
  const [searchReturnedEmpty, setSearchReturnedEmpty] = useState(false);
  const [searchOffset, setSearchOffset] = useState(0);
  const [collapsedDays, setCollapsedDays] = useState(() => new Set());
  const [selectedPrestadorDocsByPrestacion, setSelectedPrestadorDocsByPrestacion] = useState({});
  const [configTab, setConfigTab] = useState('profesionales');
  const [configDraftProfesionales, setConfigDraftProfesionales] = useState([]);
  const [configDraftPrestaciones, setConfigDraftPrestaciones] = useState([]);
  const [configSearchProf, setConfigSearchProf] = useState('');
  const [configSearchPrest, setConfigSearchPrest] = useState('');
  const [reglas, setReglas] = useState([]);
  const [configDraftReglas, setConfigDraftReglas] = useState([]);
  const [reglaProfDoc, setReglaProfDoc] = useState('');
  const [reglaPrestCod, setReglaPrestCod] = useState('');
  const [reglaModalidad, setReglaModalidad] = useState('TODAS');
  const [reglaDuracion, setReglaDuracion] = useState(120);
  const [reglaModalOpen, setReglaModalOpen] = useState(false);
  const [filtroReglaProf, setFiltroReglaProf] = useState('');
  const [filtroReglaPrest, setFiltroReglaPrest] = useState('');
  const [filtroReglaMod, setFiltroReglaMod] = useState('TODOS');
  const [configSaving, setConfigSaving] = useState(false);
  const configSaveLock = useRef(false);
  const reglasRef = useRef([]);

  const sedePickerIntentRef = useRef(null);
  const pendingRefreshOptsRef = useRef(null);
  const [sedePickerOpen, setSedePickerOpen] = useState(false);
  /** 'initial' = primera carga sin cache; 'refresh' = antes de Actualizar datos */
  const [sedePickerSource, setSedePickerSource] = useState(null);
  const [sedePickerDraftModo, setSedePickerDraftModo] = useState('ineco');

  const [sedesCarga, setSedesCarga] = useState(readSedesCarga);
  const sedesCargaRef = useRef(sedesCarga);
  useEffect(() => {
    sedesCargaRef.current = sedesCarga;
  }, [sedesCarga]);

  useEffect(() => {
    onCatalogStatus?.({
      cacheDot,
      cacheLabel,
    });
  }, [cacheDot, cacheLabel, onCatalogStatus]);

  const esSedeCargada = useCallback(
    (sede) => sedesCarga.includes(String(sede ?? '').trim()),
    [sedesCarga]
  );

  const sedeModo = useMemo(() => 'ineco', []);

  const setSedeModo = useCallback((_modo) => {
    const next = ['INECO'];
    setSedesCarga(next);
    writeSedesCarga(next);
  }, []);

  const configProfFiltered = useMemo(() => {
    const q = configSearchProf.trim().toLowerCase();
    const docQ = configSearchProf.trim();
    return sortProfesionalesAlfabetico(configDraftProfesionales)
      .filter((p) => esSedeCargada(p.sede))
      .filter((p) => {
        if (!q) return true;
        return (
          (p.nombre && String(p.nombre).toLowerCase().includes(q)) ||
          String(p.doc).includes(docQ)
        );
      });
  }, [configDraftProfesionales, configSearchProf, esSedeCargada]);

  const configPrestFiltered = useMemo(() => {
    const q = configSearchPrest.trim().toLowerCase();
    return [...configDraftPrestaciones]
      .sort((a, b) => a.codigo.localeCompare(b.codigo))
      .filter((row) => {
        const profs = prestaciones[row.codigo]?.profesionales || [];
        const visible = profs.some((pr) => esSedeCargada(pr.sede));
        if (!visible) return false;
        if (!q) return true;
        return (
          String(row.codigo).toLowerCase().includes(q) ||
          (row.nombre && String(row.nombre).toLowerCase().includes(q))
        );
      });
  }, [configDraftPrestaciones, configSearchPrest, prestaciones, esSedeCargada]);

  const reglaProfOptions = useMemo(() => {
    return sortProfesionalesAlfabetico(
      configDraftProfesionales.filter((p) => esSedeCargada(p.sede) && p.enabled === true)
    ).map((p) => ({
      value: String(p.doc),
      label: profLabelConDoc(p.nombre, p.doc),
    }));
  }, [configDraftProfesionales, esSedeCargada]);

  const reglaPrestOptions = useMemo(() => {
    if (!reglaProfDoc) return [];
    const habilitadas = new Set(
      configDraftPrestaciones.filter((r) => r.enabled === true).map((r) => String(r.codigo))
    );
    return Object.entries(prestaciones)
      .filter(([cod, v]) => habilitadas.has(String(cod)))
      .filter(([, v]) =>
        (v.profesionales || []).some((p) => String(p.doc) === String(reglaProfDoc))
      )
      .sort((a, b) => (a[1].nombre || '').localeCompare(b[1].nombre || '', 'es'))
      .map(([cod, v]) => {
        const nombre = String(v.nombre || '').trim();
        const label = nombre && nombre !== cod ? `${cod} - ${nombre}` : nombre || cod;
        return { value: cod, label };
      });
  }, [prestaciones, reglaProfDoc, configDraftPrestaciones]);

  useEffect(() => {
    if (reglaProfDoc && !reglaProfOptions.some((o) => o.value === reglaProfDoc)) {
      setReglaProfDoc('');
    }
  }, [reglaProfDoc, reglaProfOptions]);

  useEffect(() => {
    if (!reglaPrestCod) return;
    if (!reglaPrestOptions.some((o) => o.value === reglaPrestCod)) setReglaPrestCod('');
  }, [reglaPrestCod, reglaPrestOptions]);

  const filtroPrestOptions = useMemo(() => {
    const habilitadas = new Set(
      configDraftPrestaciones.filter((r) => r.enabled === true).map((r) => String(r.codigo))
    );
    return Object.entries(prestaciones)
      .filter(([cod, v]) => habilitadas.has(String(cod)))
      .filter(([, v]) => {
        if (!filtroReglaProf) return true;
        return (v.profesionales || []).some((p) => String(p.doc) === String(filtroReglaProf));
      })
      .sort((a, b) => (a[1].nombre || '').localeCompare(b[1].nombre || '', 'es'))
      .map(([cod, v]) => {
        const nombre = String(v.nombre || '').trim();
        const label = nombre && nombre !== cod ? `${cod} - ${nombre}` : nombre || cod;
        return { value: cod, label };
      });
  }, [prestaciones, filtroReglaProf, configDraftPrestaciones]);

  useEffect(() => {
    if (!filtroReglaPrest) return;
    if (!filtroPrestOptions.some((o) => o.value === filtroReglaPrest)) setFiltroReglaPrest('');
  }, [filtroReglaPrest, filtroPrestOptions]);

  const filtroProfSelectOptions = useMemo(
    () => [{ value: '', label: 'Todos' }, ...reglaProfOptions],
    [reglaProfOptions]
  );
  const filtroPrestSelectOptions = useMemo(
    () => [{ value: '', label: 'Todos' }, ...filtroPrestOptions],
    [filtroPrestOptions]
  );
  const filtroModSelectOptions = useMemo(
    () => [
      { value: 'TODOS', label: 'Todos' },
      { value: 'TODAS', label: 'Todas las modalidades' },
      { value: 'PRESENCIAL', label: 'Presencial' },
      { value: 'VIRTUAL', label: 'Virtual' },
    ],
    []
  );

  const reglasVisibles = useMemo(() => {
    const nombreProf = (doc) =>
      profesionalesCatalog.find((p) => String(p.doc) === String(doc))?.nombre || doc;
    const nombrePrest = (cod) => prestaciones[cod]?.nombre || cod;
    return [...configDraftReglas]
      .filter((r) => {
        if (filtroReglaProf && String(r.profesionalDoc) !== String(filtroReglaProf)) return false;
        if (filtroReglaPrest && String(r.prestacionCodigo) !== String(filtroReglaPrest)) return false;
        if (filtroReglaMod !== 'TODOS' && r.modalidad !== filtroReglaMod) return false;
        return true;
      })
      .sort((a, b) => {
      const byProf = String(nombreProf(a.profesionalDoc)).localeCompare(String(nombreProf(b.profesionalDoc)), 'es', {
        sensitivity: 'base',
      });
      if (byProf) return byProf;
      return String(nombrePrest(a.prestacionCodigo)).localeCompare(String(nombrePrest(b.prestacionCodigo)), 'es', {
        sensitivity: 'base',
      });
    });
  }, [configDraftReglas, profesionalesCatalog, prestaciones, filtroReglaProf, filtroReglaPrest, filtroReglaMod]);

  const reglasDeBusqueda = useMemo(
    () => reglas.filter((r) => String(r.prestacionCodigo) === String(prestacionId)),
    [reglas, prestacionId]
  );

  const slotsFiltered = useMemo(() => {
    // 1) los turnos ya vinieron por prestación y profesional.
    // 2) modalidad. 3) duración, aparte: regla si ese profesional tiene, si no la general.
    let list = slotsRaw;
    if (modalidad === 'VIRTUAL') list = list.filter((s) => isSlotVirtual(s.edificio));
    else if (modalidad === 'PRESENCIAL') list = list.filter((s) => !isSlotVirtual(s.edificio));
    return armarOfertasConReglas(list, prestacionId, duracionMin, reglas);
  }, [slotsRaw, modalidad, duracionMin, prestacionId, reglas]);

  const enabledProfDocs = useMemo(
    () => new Set(profesionalesCatalog.filter((p) => p.enabled).map((p) => String(p.doc))),
    [profesionalesCatalog]
  );

  const profesionalesForPrestacion = useMemo(() => {
    if (!prestacionId) return [];
    const list = prestaciones[prestacionId]?.profesionales || [];
    return sortProfesionalesAlfabetico(
      list.filter((p) => esSedeCargada(p.sede) && enabledProfDocs.has(String(p.doc)))
    );
  }, [prestacionId, prestaciones, enabledProfDocs]);

  useEffect(() => {
    if (!prestacionId || !prestaciones[prestacionId]) return;
    const profs = sortProfesionalesAlfabetico(
      (prestaciones[prestacionId]?.profesionales || []).filter(
        (p) => esSedeCargada(p.sede) && enabledProfDocs.has(String(p.doc))
      )
    );
    if (profs.length === 0) return;
    const allDocs = profs.map((p) => p.doc);
    setSelectedPrestadorDocsByPrestacion((prev) => {
      if (prev[prestacionId] !== undefined) return prev;
      return { ...prev, [prestacionId]: [...allDocs] };
    });
  }, [prestacionId, prestaciones, enabledProfDocs]);

  const selectedDocs = prestacionId
    ? (selectedPrestadorDocsByPrestacion[prestacionId] ?? profesionalesForPrestacion.map((p) => p.doc))
    : [];
  const [prestadorFilter, setPrestadorFilter] = useState('');
  const [prestadoresModalOpen, setPrestadoresModalOpen] = useState(false);
  const [selectedSlotForAssign, setSelectedSlotForAssign] = useState(null);

  useEffect(() => {
    setPrestadoresModalOpen(false);
    setPrestadorFilter('');
  }, [prestacionId]);

  useEffect(() => {
    const prestadoresPickOpen =
      prestadoresModalOpen && !!prestacionId && profesionalesForPrestacion.length > 0;
    const anyModalOpen = selectedSlotForAssign != null || prestadoresPickOpen;
    const html = document.documentElement;
    const body = document.body;
    if (anyModalOpen) {
      html.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
      body.style.overscrollBehavior = 'none';
    } else {
      html.style.overflow = '';
      body.style.overflow = '';
      body.style.overscrollBehavior = '';
    }
  }, [
    selectedSlotForAssign,
    prestadoresModalOpen,
    prestacionId,
    profesionalesForPrestacion.length,
  ]);

  const [assignDni, setAssignDni] = useState('');
  const [personaData, setPersonaData] = useState(null);
  const [assignPacienteNoEncontrado, setAssignPacienteNoEncontrado] = useState(false);
  const [assignNombreManual, setAssignNombreManual] = useState('');
  const [assignApellidoManual, setAssignApellidoManual] = useState('');
  const [assignSexoManual, setAssignSexoManual] = useState('MASCULINO');
  const [assignEmailManual, setAssignEmailManual] = useState('');
  const [assignTelefonoManual, setAssignTelefonoManual] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState('');

  const setSelectedDocs = useCallback((next) => {
    if (!prestacionId) return;
    setSelectedPrestadorDocsByPrestacion((prev) => ({ ...prev, [prestacionId]: next }));
  }, [prestacionId]);

  const clearStatus = useCallback(() => {
    setStatus((s) => ({ ...s, visible: false }));
  }, []);

  const persistState = useCallback(async (profs, prest, opts = {}) => {
    const { silent = true, reglas: reglasOpt } = opts;
    const reglasPayload = normalizeReglas(reglasOpt ?? reglasRef.current);
    setCachedFull({ profesionales: profs, prestaciones: prest, reglas: reglasPayload });
    try {
      await saveBuscaTurnoConfig({
        version: 2,
        sedesCarga: sedesCargaRef.current?.length ? sedesCargaRef.current : ['INECO'],
        profesionales: profs,
        prestaciones: prest,
        reglas: reglasPayload,
      });
    } catch (e) {
      console.warn('No se pudo guardar config Busca turno en Firebase', e);
      if (!silent) {
        toast.error(e?.message || 'No se pudo guardar la configuración en Firebase');
        throw e;
      }
    }
  }, []);

  const loadCache = useCallback(
    async (forceRefresh = false, opts = {}) => {
      const {
        syncConfigDraft = false,
        applyConfigDraft = false,
        draftProfesionales = [],
        draftPrestaciones = [],
        draftReglas,
      } = opts;
      if (!forceRefresh) {
        setPrestacionId('');
      }

      const applyDraftFromServer = (catalog, mergedPrest) => {
        if (!syncConfigDraft) return;
        setConfigDraftProfesionales(catalog.map((p) => ({ ...p })));
        setConfigDraftPrestaciones(
          Object.entries(mergedPrest)
            .map(([cod, v]) => ({
              codigo: cod,
              nombre: v.nombre || cod,
              enabled: v.enabled !== false,
            }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre))
        );
      };

      if (!forceRefresh) {
        const cached = await resolveStoredConfig();
        if (configLooksPopulated(cached)) {
          if (cached.sedesCarga?.length) {
            const sedes = cached.sedesCarga.includes('INECO') ? ['INECO'] : cached.sedesCarga;
            sedesCargaRef.current = sedes;
            setSedesCarga(sedes);
            writeSedesCarga(sedes);
          }
          setProfesionalesCatalog(cached.profesionales);
          setPrestaciones(cached.prestaciones);
          const reglasNorm = normalizeReglas(cached.reglas);
          reglasRef.current = reglasNorm;
          setReglas(reglasNorm);
          setCacheLoaded(true);
          setCacheDot('ok');
          const nPrest = Object.values(cached.prestaciones).filter((p) => p.enabled !== false).length;
          setCacheLabel(
            `${nPrest} prestaciones visibles · ${cached.profesionales.filter((x) => x.enabled).length} prof. habilitados`
          );
          setProgress(null);
          // Migración: si solo estaba en local, subir a Firebase.
          if (cached._source === 'local') {
            void persistState(cached.profesionales, cached.prestaciones, { reglas: reglasNorm });
          }
          return;
        }
      }

      setCacheDot('loading');
      setCacheLabel('Consultando departamentos por sede...');
      setProgress(0);
      setCacheLoaded(false);

      try {
        const allDepts = [];
        const sedesParaApi = sedesCargaRef.current;
        if (sedesParaApi.length === 0) {
          setCacheDot('error');
          setCacheLabel('Seleccioná al menos una sede en Config');
          setProgress(null);
          return;
        }

        for (const sedeNom of sedesParaApi) {
          const depRaw = await apiPost('/Departamento', { sede: sedeNom });
          const depArr = Array.isArray(depRaw) ? depRaw : [depRaw];
          for (const d of depArr) {
            if (d && d.DepartamentoID != null) allDepts.push(d);
          }
        }

        const prestadoresMap = {};
        const deptBatchSize = Math.min(
          Math.max(PRESTADOR_FETCH_BATCH_SIZE, 5),
          10
        );
        let deptDone = 0;
        const totalDepts = allDepts.length;

        if (totalDepts === 0) {
          setCacheDot('error');
          setCacheLabel('No hay departamentos para las sedes configuradas');
          setProgress(null);
          return;
        }

        setCacheLabel(`Cargando profesionales por departamento (0/${totalDepts})...`);
        setProgress(5);

        for (let ds = 0; ds < allDepts.length; ds += deptBatchSize) {
          const deptBatch = allDepts.slice(ds, ds + deptBatchSize);
          const dbIdx = Math.floor(ds / deptBatchSize) + 1;
          const dbNum = Math.ceil(allDepts.length / deptBatchSize);

          await Promise.all(
            deptBatch.map(async (d) => {
              try {
                const profsRaw = await apiPost('/PRESTADOR', {
                  DepartamentoID: String(d.DepartamentoID),
                });
                const list = Array.isArray(profsRaw) ? profsRaw : [profsRaw];
                for (const p of list) {
                  if (!p?.PrestadorDocumento) continue;
                  const key = String(p.PrestadorDocumento);
                  if (!prestadoresMap[key]) {
                    prestadoresMap[key] = {
                      doc: key,
                      nombre: `${p.PrestadorApellido || ''} ${p.PrestadorNombre || ''}`.trim() || key,
                      sede: p.Sede || d.Sede || sedesParaApi[0] || 'INECO',
                    };
                  }
                }
              } catch {
                /* ignore per dept */
              }
              deptDone++;
              setProgress(5 + Math.round((deptDone / totalDepts) * 10));
              setCacheLabel(
                `Profesionales por departamento: ${deptDone}/${totalDepts} · lote ${dbIdx}/${dbNum}`
              );
            })
          );

          if (ds + deptBatchSize < allDepts.length) {
            await new Promise((r) => setTimeout(r, PRESTADOR_FETCH_BATCH_PAUSE_MS));
          }
        }

        const fromApi = Object.values(prestadoresMap);
        let rawPrev = await resolveStoredConfig();
        if (!rawPrev) rawPrev = getCachedFull();
        const prev = rawPrev;
        const profEnabled = new Map();
        for (const p of prev?.profesionales || []) {
          profEnabled.set(String(p.doc), !!p.enabled);
        }
        if (applyConfigDraft) {
          for (const p of draftProfesionales || []) {
            profEnabled.set(String(p.doc), !!p.enabled);
          }
        }
        const haySeleccionPrevia = profEnabled.size > 0;
        let catalog = fromApi.map((p) => ({
          doc: p.doc,
          nombre: p.nombre,
          sede: p.sede,
          enabled: profEnabled.has(String(p.doc))
            ? profEnabled.get(String(p.doc))
            : haySeleccionPrevia
              ? false
              : true,
        }));
        const vistos = new Set(catalog.map((p) => String(p.doc)));
        for (const p of prev?.profesionales || []) {
          const doc = String(p.doc);
          if (vistos.has(doc)) continue;
          catalog.push({
            doc,
            nombre: p.nombre,
            sede: p.sede || 'INECO',
            enabled: profEnabled.has(doc) ? profEnabled.get(doc) : !!p.enabled,
          });
          vistos.add(doc);
        }

        let toFetch = catalog.filter((p) => p.enabled);
        if (toFetch.length === 0) {
          if (fromApi.length === 0 && catalog.length === 0) {
            setCacheDot('error');
            setCacheLabel('No hay profesionales');
            setProgress(null);
            return;
          }
          if (haySeleccionPrevia || (prev?.prestaciones && Object.keys(prev.prestaciones).length > 0)) {
            const prestKeep = mergePrestacionesFromFetch(
              prev?.prestaciones || {},
              {},
              [],
              applyConfigDraft ? draftPrestaciones : []
            );
            setProfesionalesCatalog(catalog);
            setPrestaciones(prestKeep);
            setCacheLoaded(true);
            setCacheDot('warning');
            setCacheLabel('Actualizar cancelado: habilitá al menos un profesional en Config');
            setProgress(null);
            setStatus({
              text: 'No se consultaron prestaciones: ningún profesional está tildado. Los tildes no se modificaron.',
              error: true,
              visible: true,
            });
            applyDraftFromServer(catalog, prestKeep);
            await persistState(catalog, prestKeep, {
              reglas: normalizeReglas(
                Array.isArray(draftReglas) ? draftReglas : (prev?.reglas ?? reglasRef.current)
              ),
            });
            return;
          }
          catalog = fromApi.map((p) => ({ ...p, enabled: true }));
          toFetch = catalog;
        }

        setProfesionalesCatalog(catalog);
        setCacheLabel(
          `${toFetch.length} profesionales a consultar (solo habilitados). Cargando prestaciones...`
        );
        setProgress(15);

        const map = {};
        let done = 0;
        const total = toFetch.length;
        const batchSize = Math.min(
          Math.max(PRESTADOR_FETCH_BATCH_SIZE, 5),
          10
        );
        const numBatches = Math.max(1, Math.ceil(total / batchSize));

        for (let start = 0; start < toFetch.length; start += batchSize) {
          const batch = toFetch.slice(start, start + batchSize);
          const batchIndex = Math.floor(start / batchSize) + 1;

          await Promise.all(
            batch.map(async (p) => {
              try {
                const prestData = await apiPost('/PRESTADOR', {
                  PrestadorDocumento: p.doc,
                });
                const prests = Array.isArray(prestData) ? prestData : [prestData];
                prests.forEach((pr) => {
                  if (!pr.PrestacionCodigo) return;
                  const cod = String(pr.PrestacionCodigo);
                  if (!map[cod]) {
                    map[cod] = {
                      nombre: pr.PrestacionNombre || pr.PrestadorNombre || cod,
                      profesionales: [],
                    };
                  }
                  if (pr.PrestacionNombre && String(pr.PrestacionNombre).trim()) {
                    map[cod].nombre = pr.PrestacionNombre;
                  }
                  const yaEsta = map[cod].profesionales.some((x) => x.doc === p.doc);
                  if (!yaEsta) {
                    map[cod].profesionales.push({
                      doc: p.doc,
                      nombre: p.nombre,
                      sede: p.sede,
                    });
                  }
                });
              } catch (e) {
                /* ignore per prof */
              }
              done++;
              setProgress(15 + Math.round((done / total) * 85));
              setCacheLabel(
                `Prestaciones: ${done} de ${total} · lote ${batchIndex}/${numBatches}`
              );
            })
          );

          if (start + batchSize < toFetch.length) {
            await new Promise((r) => setTimeout(r, PRESTADOR_FETCH_BATCH_PAUSE_MS));
          }
        }

        const enabledDocs = toFetch.map((p) => p.doc);
        const prevPrest = prev?.prestaciones || {};
        const merged = mergePrestacionesFromFetch(
          prevPrest,
          map,
          enabledDocs,
          applyConfigDraft ? draftPrestaciones : []
        );

        setPrestaciones(merged);
        setProfesionalesCatalog(catalog);
        const reglasKeep = normalizeReglas(
          Array.isArray(draftReglas) ? draftReglas : (prev?.reglas ?? reglasRef.current)
        );
        reglasRef.current = reglasKeep;
        setReglas(reglasKeep);
        await persistState(catalog, merged, { reglas: reglasKeep });
        setCacheLoaded(true);
        setCacheDot('ok');
        const nVis = Object.values(merged).filter((x) => x.enabled !== false).length;
        const nProfEn = catalog.filter((x) => x.enabled).length;
        setCacheLabel(`${nVis} prestaciones visibles · ${nProfEn} prof. habilitados`);
        setProgress(null);
        applyDraftFromServer(catalog, merged);
        setPrestacionId((currentId) => {
          if (!currentId) return currentId;
          const entry = merged[currentId];
          if (!entry || entry.enabled === false) return '';
          return currentId;
        });
      } catch (e) {
        setCacheDot('error');
        setCacheLabel('Error — reintentá desde Config → Actualizar datos');
        setProgress(null);
        setStatus({
          text: 'No se pudieron cargar los datos. Revisá la conexión y en Config usá Actualizar datos.',
          error: true,
          visible: true,
        });
      }
    },
    [persistState]
  );

  const confirmSedePicker = useCallback(() => {
    const next = modoToSedes(sedePickerDraftModo);
    sedesCargaRef.current = next;
    setSedesCarga(next);
    writeSedesCarga(next);
    setSedePickerOpen(false);
    setSedePickerSource(null);
    const intent = sedePickerIntentRef.current;
    sedePickerIntentRef.current = null;
    const pending = pendingRefreshOptsRef.current;
    pendingRefreshOptsRef.current = null;
    if (intent === 'refresh' && pending) {
      loadCache(true, pending);
    } else if (intent === 'initial') {
      loadCache();
    }
  }, [loadCache, sedePickerDraftModo]);

  const cancelSedePickerRefresh = useCallback(() => {
    sedePickerIntentRef.current = null;
    pendingRefreshOptsRef.current = null;
    setSedePickerOpen(false);
    setSedePickerSource(null);
    onRequestSection?.('config');
  }, [onRequestSection]);

  useEffect(() => {
    const cached = getCachedFull();
    const hasCache =
      cached?.prestaciones &&
      Object.keys(cached.prestaciones).length > 0 &&
      cached.profesionales?.length;

    if (hasCache) {
      loadCache();
      return;
    }

    const next = ['INECO'];
    sedesCargaRef.current = next;
    setSedesCarga(next);
    writeSedesCarga(next);
    loadCache();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prepareConfigDrafts = useCallback(() => {
    setConfigDraftProfesionales(profesionalesCatalog.map((p) => ({ ...p })));
    setConfigDraftPrestaciones(
      Object.entries(prestaciones)
        .map(([cod, v]) => ({
          codigo: cod,
          nombre: v.nombre || cod,
          enabled: v.enabled !== false,
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    );
    setConfigDraftReglas(normalizeReglas(reglas));
    setConfigSearchProf('');
    setConfigSearchPrest('');
  }, [profesionalesCatalog, prestaciones, reglas]);

  const configAbiertaRef = useRef(false);
  useEffect(() => {
    if (!configView) {
      configAbiertaRef.current = false;
      return;
    }
    if (!configAbiertaRef.current) {
      setConfigTab('profesionales');
      configAbiertaRef.current = true;
    }
    prepareConfigDrafts();
  }, [configView, prepareConfigDrafts]);

  const openConfigModal = useCallback(() => {
    prepareConfigDrafts();
    onRequestSection?.('config');
  }, [prepareConfigDrafts, onRequestSection]);

  const saveConfigModal = useCallback(async () => {
    if (configSaveLock.current) return;
    configSaveLock.current = true;
    setConfigSaving(true);

    const profByDoc = new Map(configDraftProfesionales.map((p) => [String(p.doc), p]));
    const newCatalog = profesionalesCatalog.length
      ? profesionalesCatalog.map((p) => {
          const d = profByDoc.get(String(p.doc));
          return d ? { ...p, enabled: !!d.enabled } : p;
        })
      : configDraftProfesionales.map((p) => ({
          doc: p.doc,
          nombre: p.nombre,
          sede: p.sede || 'INECO',
          enabled: !!p.enabled,
        }));

    const prestDraftByCod = new Map(configDraftPrestaciones.map((p) => [p.codigo, p]));
    const newPrest = { ...prestaciones };
    for (const cod of Object.keys(newPrest)) {
      const d = prestDraftByCod.get(cod);
      if (d) {
        newPrest[cod] = {
          ...newPrest[cod],
          nombre: d.nombre || newPrest[cod].nombre,
          enabled: !!d.enabled,
        };
      }
    }
    for (const row of configDraftPrestaciones) {
      if (!newPrest[row.codigo]) {
        newPrest[row.codigo] = {
          nombre: row.nombre,
          duracion: DEFAULT_DURACION,
          enabled: !!row.enabled,
          profesionales: [],
        };
      }
    }

    const reglasLimpias = normalizeReglas(configDraftReglas);
    try {
      setProfesionalesCatalog(newCatalog);
      setPrestaciones(newPrest);
      reglasRef.current = reglasLimpias;
      setReglas(reglasLimpias);
      setConfigDraftReglas(reglasLimpias);
      await persistState(newCatalog, newPrest, { silent: false, reglas: reglasLimpias });
      setConfigDraftProfesionales(newCatalog.map((p) => ({ ...p })));
      setConfigDraftPrestaciones(
        Object.entries(newPrest)
          .map(([cod, v]) => ({
            codigo: cod,
            nombre: v.nombre || cod,
            enabled: v.enabled !== false,
          }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre))
      );
      if (prestacionId && newPrest[prestacionId]?.enabled === false) {
        setPrestacionId('');
      }
      setCacheLabel(
        `${Object.values(newPrest).filter((x) => x.enabled !== false).length} prestaciones visibles · ${newCatalog.filter((x) => x.enabled).length} prof. habilitados`
      );
      toast.success('Configuración guardada');
    } catch {
      /* toast ya en persistState */
    } finally {
      window.setTimeout(() => {
        configSaveLock.current = false;
        setConfigSaving(false);
      }, 400);
    }
  }, [
    configDraftProfesionales,
    configDraftPrestaciones,
    configDraftReglas,
    profesionalesCatalog,
    prestaciones,
    persistState,
    prestacionId,
  ]);

  const persistirReglas = useCallback(async (lista, mensaje) => {
    if (configSaveLock.current) return false;
    configSaveLock.current = true;
    setConfigSaving(true);
    const reglasLimpias = normalizeReglas(lista);
    try {
      await persistState(profesionalesCatalog, prestaciones, { silent: false, reglas: reglasLimpias });
      reglasRef.current = reglasLimpias;
      setReglas(reglasLimpias);
      setConfigDraftReglas(reglasLimpias);
      toast.success(mensaje);
      return true;
    } catch {
      return false;
    } finally {
      window.setTimeout(() => {
        configSaveLock.current = false;
        setConfigSaving(false);
      }, 400);
    }
  }, [persistState, profesionalesCatalog, prestaciones]);

  const agregarRegla = useCallback(async () => {
    if (!reglaProfDoc || !reglaPrestCod) {
      toast.error('Elegí el profesional y la prestación.');
      return;
    }
    const keyPar = (r) =>
      String(r.profesionalDoc) === String(reglaProfDoc) &&
      String(r.prestacionCodigo) === String(reglaPrestCod);
    const delPar = configDraftReglas.filter(keyPar);
    let next;
    let mensaje;
    if (reglaModalidad === 'TODAS') {
      next = [
        ...configDraftReglas.filter((r) => !keyPar(r)),
        {
          profesionalDoc: reglaProfDoc,
          prestacionCodigo: reglaPrestCod,
          modalidad: 'TODAS',
          duracionMin: Number(reglaDuracion),
        },
      ];
      mensaje = 'Regla guardada para todas las modalidades.';
    } else {
      const todas = delPar.find((r) => r.modalidad === 'TODAS');
      const otra = reglaModalidad === 'PRESENCIAL' ? 'VIRTUAL' : 'PRESENCIAL';
      next = configDraftReglas.filter(
        (r) => !keyPar(r) || (r.modalidad !== reglaModalidad && r.modalidad !== 'TODAS')
      );
      if (todas) {
        next.push({
          profesionalDoc: reglaProfDoc,
          prestacionCodigo: reglaPrestCod,
          modalidad: otra,
          duracionMin: todas.duracionMin,
        });
      }
      next.push({
        profesionalDoc: reglaProfDoc,
        prestacionCodigo: reglaPrestCod,
        modalidad: reglaModalidad,
        duracionMin: Number(reglaDuracion),
      });
      mensaje = delPar.some((r) => r.modalidad === reglaModalidad) ? 'Regla actualizada.' : 'Regla guardada.';
    }
    const ok = await persistirReglas(next, mensaje);
    if (ok) setReglaModalOpen(false);
  }, [reglaProfDoc, reglaPrestCod, reglaModalidad, reglaDuracion, configDraftReglas, persistirReglas]);

  const quitarRegla = useCallback((id) => {
    void persistirReglas(
      configDraftReglas.filter((r) => r.id !== id),
      'Regla quitada.'
    );
  }, [configDraftReglas, persistirReglas]);

  const buscar = useCallback(
    async (startOffset = 0, append = false) => {
      if (!prestacionId) {
        setStatus({ text: 'Elegí una prestación', error: true, visible: true });
        return;
      }
      if (prestaciones[prestacionId]?.enabled === false) {
        setStatus({ text: 'Esta prestación está deshabilitada en Config', error: true, visible: true });
        return;
      }

      let profesionales = (prestaciones[prestacionId]?.profesionales || []).slice();
      profesionales = profesionales.filter(
        (p) => esSedeCargada(p.sede) && enabledProfDocs.has(String(p.doc))
      );
      const selected = selectedPrestadorDocsByPrestacion[prestacionId];
      if (selected !== undefined && selected.length > 0) {
        const elegidos = new Set(selected.map((d) => String(d)));
        profesionales = profesionales.filter((p) => elegidos.has(String(p.doc)));
      }

      if (!profesionales.length) {
        setStatus({
          text: 'No hay prestadores habilitados para esta prestación. Revisá Config o Actualizar.',
          error: true,
          visible: true,
        });
        return;
      }

      if (startOffset === 0 && !append) setSearchOffset(0);
      if (!append) {
        setSlotsRaw([]);
        setSearchReturnedEmpty(false);
        setCollapsedDays(new Set());
      }
      clearStatus();
      setSearching(true);

      try {
      let allSlots = [];
      let falloBusqueda = null;
      const DAYS_PER_BLOCK = 21;
      const PARALLEL_DAYS = 7;
      const LIMITE_POR_DIA = 40;
      const PROFESIONALES_EN_PARALELO = 4;

      const url = `${config.base}/Turno/Disponible`;

      const parseSlotList = (data, profPedido) => {
        const slotList = Array.isArray(data) ? data : (data.Turnos || data.turnos || []);
        return slotList.map((s) => {
          const docRaw = s.profesionalDocumento ?? s.PrestadorDocumento;
          const doc =
            docRaw != null && String(docRaw).trim() !== ''
              ? String(docRaw).trim()
              : String(profPedido.doc);
          const prof =
            profesionales.find((p) => String(p.doc) === String(doc)) || profPedido;
          const fechaHora = s.turnoFechaHora || s.TurnoFechaHora;
          const edificio = String(s.edificio ?? s.Edificio ?? '').trim();
          const sector = String(s.sector ?? s.Sector ?? '').trim();
          return {
            fechaHora: new Date(fechaHora),
            profesional: prof.nombre || s.profesionalNombre || s.PrestadorNombre || profPedido.nombre || '',
            profesionalDoc: String(prof.doc || doc),
            sede: prof.sede || s.sede || s.Sede || profPedido.sede || '',
            edificio,
            sector,
            prestacionId,
          };
        });
      };

      const fetchDay = async (dayOffset) => {
        const desde = addDays(new Date(), dayOffset);
        const hasta = addDays(new Date(), dayOffset + 1);
        const fechaDesde = fmtDate(desde);
        const fechaHasta = fmtDate(hasta);
        // Medexis ignora el filtro de modalidad en Disponible: pedimos PRESENCIAL
        // y filtramos Virtual/Presencial en el cliente según `edificio`.
        const modalidadValor = 'PRESENCIAL';

        const fetchProf = async (prof) => {
          try {
            const body = {
              prestacionCodigo: prestacionId,
              profesionalDocumentos: [String(prof.doc)],
              modalidad: modalidadValor,
              filtros: {
                fechaDesde,
                fechaHasta,
                turnoEstado: 'D',
                modalidad: modalidadValor,
              },
              // Un día y un profesional: el límite de Medexis es del request entero.
              // Si iban varios juntos, los huecos de uno se comían el cupo y el resto no volvía.
              limite: LIMITE_POR_DIA,
            };
            const res = await fetch(url, {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
              },
              credentials: 'include',
              body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
              const msg =
                data?.Detalle || data?.Mensaje || data?.Message || `HTTP ${res.status}`;
              throw new Error(msg);
            }
            if (data?.Respuesta === 'ERROR') {
              throw new Error(data.Detalle || data.Mensaje || 'Error al consultar turnos');
            }
            return parseSlotList(data, prof);
          } catch (e) {
            falloBusqueda = e;
            return [];
          }
        };

        const slotsDia = [];
        for (let i = 0; i < profesionales.length; i += PROFESIONALES_EN_PARALELO) {
          const tanda = profesionales.slice(i, i + PROFESIONALES_EN_PARALELO);
          const results = await Promise.all(tanda.map((prof) => fetchProf(prof)));
          for (const sl of results) slotsDia.push(...sl);
        }
        return slotsDia;
      };

      for (let i = 0; i < DAYS_PER_BLOCK; i += PARALLEL_DAYS) {
        const batchOffsets = [];
        for (let j = 0; j < PARALLEL_DAYS && i + j < DAYS_PER_BLOCK; j++) {
          batchOffsets.push(startOffset + i + j);
        }
        const batchDesde = addDays(new Date(), batchOffsets[0]);
        const batchHasta = addDays(new Date(), batchOffsets[batchOffsets.length - 1]);
        setStatus({
          text: `Buscando del ${fmtDisplay(batchDesde)} al ${fmtDisplay(batchHasta)}...`,
          error: false,
          visible: true,
        });

        const batchResults = await Promise.all(batchOffsets.map((offset) => fetchDay(offset)));
        for (const sl of batchResults) {
          allSlots.push(...sl);
        }
      }

      if (allSlots.length === 0 && falloBusqueda) throw falloBusqueda;

      if (allSlots.length === 0) {
        if (!append) {
          setSlotsRaw([]);
          setSearchReturnedEmpty(true);
          clearStatus();
        } else {
          setStatus({ text: 'No hay más turnos en ese rango.', error: false, visible: true });
        }
        setSearchOffset(startOffset + DAYS_PER_BLOCK);
        return;
      }

      setSlotsRaw((prev) =>
        append ? dedupeSlotsRaw([...prev, ...allSlots]) : dedupeSlotsRaw(allSlots)
      );

      setSearchReturnedEmpty(false);
      setSearchOffset(startOffset + DAYS_PER_BLOCK);
      clearStatus();
      } catch (e) {
        setStatus({
          text: e?.message || 'Error al buscar turnos',
          error: true,
          visible: true,
        });
        toast.error(e?.message || 'Error al buscar turnos');
      } finally {
        setSearching(false);
      }
    },
    [
      prestacionId,
      prestaciones,
      selectedPrestadorDocsByPrestacion,
      clearStatus,
      enabledProfDocs,
      esSedeCargada,
    ]
  );

  const closeAssignModal = useCallback(() => {
    setSelectedSlotForAssign(null);
    setAssignDni('');
    setPersonaData(null);
    setAssignPacienteNoEncontrado(false);
    setAssignNombreManual('');
    setAssignApellidoManual('');
    setAssignSexoManual('MASCULINO');
    setAssignEmailManual('');
    setAssignTelefonoManual('');
    setAssignError('');
  }, []);

  const openAssignModal = useCallback((slot) => {
    setSelectedSlotForAssign(slot);
    setAssignDni('');
    setPersonaData(null);
    setAssignPacienteNoEncontrado(false);
    setAssignNombreManual('');
    setAssignApellidoManual('');
    setAssignSexoManual('MASCULINO');
    setAssignEmailManual('');
    setAssignTelefonoManual('');
    setAssignError('');
  }, []);

  const limpiarBusqueda = useCallback(() => {
    setPrestacionId('');
    setSlotsRaw([]);
    setSearchReturnedEmpty(false);
    setSearchOffset(0);
    setCollapsedDays(new Set());
    setPrestadoresModalOpen(false);
    setPrestadorFilter('');
    setSelectedPrestadorDocsByPrestacion({});
    setModalidad('TODOS');
    setDuracionMin(30);
    clearStatus();
    closeAssignModal();
  }, [clearStatus, closeAssignModal]);

  const handleBuscarPaciente = useCallback(async () => {
    const doc = assignDni.trim();
    if (!doc) return;
    setAssignError('');
    setPersonaData(null);
    setAssignPacienteNoEncontrado(false);
    setAssignNombreManual('');
    setAssignApellidoManual('');
    setAssignSexoManual('MASCULINO');
    setAssignEmailManual('');
    setAssignTelefonoManual('');
    setAssignLoading(true);
    try {
      const data = await getPersona(doc);
      const person = Array.isArray(data) ? data[0] : data;
      if (!person || person.PersonaDocumento == null) {
        setAssignPacienteNoEncontrado(true);
        return;
      }
      setPersonaData(person);
    } catch (e) {
      // Si Medexis falla (p. ej. 500), permitir completar datos a mano.
      setAssignPacienteNoEncontrado(true);
      const raw = e?.message || 'Error al buscar el paciente.';
      setAssignError(
        /HTTP\s*5\d\d/i.test(raw) || /no se pudo conectar/i.test(raw)
          ? 'No se pudo consultar el paciente en Medexis. Completá los datos manualmente.'
          : raw
      );
    } finally {
      setAssignLoading(false);
    }
  }, [assignDni]);

  const handleContinuarPacienteManual = useCallback(() => {
    const doc = assignDni.trim();
    const nom = assignNombreManual.trim();
    const ape = assignApellidoManual.trim();
    const email = assignEmailManual.trim();
    const tel = assignTelefonoManual.replace(/\D/g, '');
    if (!doc) {
      setAssignError('Ingresá el DNI.');
      return;
    }
    if (!nom || !ape) {
      setAssignError('Completá nombre y apellido.');
      return;
    }
    if (assignSexoManual !== 'MASCULINO' && assignSexoManual !== 'FEMENINO') {
      setAssignError('Elegí el sexo.');
      return;
    }
    if (!email) {
      setAssignError('Ingresá el email.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAssignError('Ingresá un email válido.');
      return;
    }
    if (!tel || tel.length < 6) {
      setAssignError('Ingresá un teléfono válido (al menos 6 dígitos).');
      return;
    }
    setAssignError('');
    setPersonaData({
      PersonaDocumento: doc,
      PersonaNombre: nom,
      PersonaApellido: ape,
      PersonaEmail: email,
      PersonaTelefonoCel: tel,
      PersonaSexo: assignSexoManual,
      _manual: true,
    });
  }, [
    assignDni,
    assignNombreManual,
    assignApellidoManual,
    assignSexoManual,
    assignEmailManual,
    assignTelefonoManual,
  ]);

  const handleAsignarTurno = useCallback(async () => {
    if (!selectedSlotForAssign || !personaData) return;
    setAssignError('');
    setAssignLoading(true);
    try {
      const slot = selectedSlotForAssign;
      const fechaNac = fechaNacimientoHoyParaApi();
      if (!slot.prestacionId) {
        setAssignError('Falta el código de la prestación.');
        setAssignLoading(false);
        return;
      }
      const modulos = slot.modulos?.length ? slot.modulos : [slot];
      const turnoItems = [];
      for (const m of modulos) {
        const turnoFh = formatTurnoFechaHoraMedexis(
          m.fechaHora instanceof Date ? m.fechaHora : new Date(m.fechaHora)
        );
        if (!turnoFh) {
          setAssignError('La fecha y hora del turno no son válidas.');
          setAssignLoading(false);
          return;
        }
        turnoItems.push({
          PersonaTipoDocumento: 'AR',
          PersonaDocumento: String(personaData.PersonaDocumento ?? assignDni.trim()),
          PersonaNombre: personaData.PersonaNombre ?? '',
          PersonaApellido: personaData.PersonaApellido ?? '',
          PersonaFechaNacimiento: fechaNac,
          PersonaSexo: (personaData.PersonaSexo || 'MASCULINO').toUpperCase().replace('OTRO', 'MASCULINO'),
          PersonaEmail: personaData.PersonaEmail ?? '',
          PersonaTelefonoCel: personaData.PersonaTelefonoCel ?? '',
          PersonaIdioma: 'es',
          PrestadorDocumento: m.profesionalDoc,
          Sede: (m.sede && String(m.sede).trim()) || 'INECO',
          TurnoFechaHora: turnoFh,
          TurnoPrestacion: String(m.prestacionId || slot.prestacionId),
          GeneraPago: personaData._manual ? 'N' : 'S',
          TurnoX: 1,
        });
      }
      await createTurno({ turno: turnoItems });
      const ocupados = new Set(modulos.map((m) => slotDedupeKey(m)));
      setSlotsRaw((prev) => prev.filter((s) => !ocupados.has(slotDedupeKey(s))));
      closeAssignModal();
      toast.success(
        modulos.length > 1
          ? `Se asignaron ${modulos.length} turnos (${textoModulos(modulos)}) al mismo paciente.`
          : 'Turno asignado correctamente.'
      );
    } catch (e) {
      setAssignError(e.message || 'Error al asignar el turno.');
    } finally {
      setAssignLoading(false);
    }
  }, [selectedSlotForAssign, personaData, assignDni, closeAssignModal]);

  const prestacionList = useMemo(() => {
    return Object.entries(prestaciones)
      .filter(([, v]) => v.enabled !== false)
      .filter(([, v]) =>
        (v.profesionales || []).some((pr) => esSedeCargada(pr.sede))
      )
      .sort((a, b) => (a[1].nombre || '').localeCompare(b[1].nombre || ''));
  }, [prestaciones, esSedeCargada]);

  /** Si cambia la sede de carga, la prestación elegida puede dejar de tener profesionales en esa sede. */
  useEffect(() => {
    if (!prestacionId) return;
    const v = prestaciones[prestacionId];
    if (!v || v.enabled === false) {
      setPrestacionId('');
      return;
    }
    const profs = v.profesionales || [];
    if (!profs.some((pr) => esSedeCargada(pr.sede))) setPrestacionId('');
  }, [prestacionId, prestaciones, esSedeCargada]);

  /** En el combo solo código y nombre; la duración solo en el input de minutos (editable). */
  const prestacionOptions = useMemo(() => {
    return prestacionList.map(([cod, v]) => {
      const nombre = String(v.nombre || '').trim();
      const label =
        nombre && nombre !== cod ? `${cod} - ${nombre}` : nombre || cod;
      return { value: cod, label };
    });
  }, [prestacionList]);

  const byDay = {};
  slotsFiltered.forEach((s) => {
    const key = fmtDateKey(s.fechaHora);
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(s);
  });
  const dayEntries = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));

  const prestadoresModalFiltered = useMemo(() => {
    const q = prestadorFilter.trim().toLowerCase();
    const docQ = prestadorFilter.trim();
    return sortProfesionalesAlfabetico(
      profesionalesForPrestacion.filter((p) => {
        if (!q) return true;
        return (
          (p.nombre && String(p.nombre).toLowerCase().includes(q)) ||
          String(p.doc).includes(docQ)
        );
      })
    );
  }, [profesionalesForPrestacion, prestadorFilter]);

  return (
    <div className="busca-turno">
      {configView ? (
        <div className="busca-turno-config fl-table-card">
            {configSaving && (
              <div className="config-saving-overlay" aria-live="polite">
                <div className="config-saving-inner">
                  <span className="config-saving-spinner" aria-hidden />
                  <span>Guardando…</span>
                </div>
              </div>
            )}
            <div className="config-toolbar">
              <div className="config-tabs">
                <button
                  type="button"
                  className={configTab === 'profesionales' ? 'config-tab active' : 'config-tab'}
                  onClick={() => setConfigTab('profesionales')}
                >
                  Profesionales
                </button>
                <button
                  type="button"
                  className={configTab === 'prestaciones' ? 'config-tab active' : 'config-tab'}
                  onClick={() => setConfigTab('prestaciones')}
                >
                  Prestaciones
                </button>
                <button
                  type="button"
                  className={configTab === 'reglas' ? 'config-tab active' : 'config-tab'}
                  onClick={() => setConfigTab('reglas')}
                >
                  Reglas
                </button>
              </div>
              <div className="config-sync-strip">
                <div className="config-sync-actions">
                  {configTab === 'reglas' && (
                    <button
                      type="button"
                      className="btn btn-refresh-config"
                      onClick={() => setReglaModalOpen(true)}
                    >
                      Agregar regla
                    </button>
                  )}
                  {configTab !== 'reglas' && (
                  <button
                    type="button"
                    className="btn btn-refresh-config"
                    disabled={progress != null || configSaving}
                    onClick={() => {
                      const next = ['INECO'];
                      sedesCargaRef.current = next;
                      setSedesCarga(next);
                      writeSedesCarga(next);
                      loadCache(true, {
                        syncConfigDraft: true,
                        applyConfigDraft: true,
                        draftProfesionales: configDraftProfesionales,
                        draftPrestaciones: configDraftPrestaciones,
                        draftReglas: configDraftReglas,
                      });
                    }}
                  >
                    {progress != null
                      ? 'Actualizando datos desde Medexis…'
                      : 'Actualizar datos desde Medexis'}
                  </button>
                  )}
                </div>
                {progress != null && configTab !== 'reglas' && (
                  <div className="config-progress-track">
                    <div className="config-progress-bar" style={{ width: `${progress}%` }} />
                  </div>
                )}
              </div>
            </div>
            <div className="modal-body modal-config-body busca-turno-config__body">
              {configTab === 'profesionales' && (
                <div className="config-tab-panel">
                  <div className="config-list-header-row config-list-toolbar">
                    <input
                      type="text"
                      className="config-search-input"
                      placeholder="Buscar por nombre o documento..."
                      value={configSearchProf}
                      onChange={(e) => setConfigSearchProf(e.target.value)}
                      autoComplete="off"
                    />
                    <span className="prestadores-list-actions">
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() =>
                          setConfigDraftProfesionales((rows) => rows.map((r) => ({ ...r, enabled: true })))
                        }
                      >
                        Todos
                      </button>
                      <span className="prestadores-list-sep">·</span>
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() =>
                          setConfigDraftProfesionales((rows) => rows.map((r) => ({ ...r, enabled: false })))
                        }
                      >
                        Ninguno
                      </button>
                    </span>
                  </div>
                  <div className="config-scroll config-unified-list">
                    {configProfFiltered.map((p) => (
                      <label key={p.doc} className="prestador-checkbox config-unified-row config-row-prof">
                        <input
                          type="checkbox"
                          checked={!!p.enabled}
                          onChange={() =>
                            setConfigDraftProfesionales((rows) =>
                              rows.map((r) =>
                                String(r.doc) === String(p.doc) ? { ...r, enabled: !r.enabled } : r
                              )
                            )
                          }
                        />
                        <span className="prestador-nombre">{profLabelConDoc(p.nombre, p.doc)}</span>
                      </label>
                    ))}
                  </div>
                  {configProfFiltered.length === 0 && (
                    <p className="config-list-empty">Ningún profesional coincide con la búsqueda.</p>
                  )}
                </div>
              )}
              {configTab === 'prestaciones' && (
                <div className="config-tab-panel">
                  <div className="config-list-header-row config-list-toolbar">
                    <input
                      type="text"
                      className="config-search-input"
                      placeholder="Buscar por código o nombre..."
                      value={configSearchPrest}
                      onChange={(e) => setConfigSearchPrest(e.target.value)}
                      autoComplete="off"
                    />
                    <span className="prestadores-list-actions">
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() =>
                          setConfigDraftPrestaciones((rows) => rows.map((r) => ({ ...r, enabled: true })))
                        }
                      >
                        Todos
                      </button>
                      <span className="prestadores-list-sep">·</span>
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() =>
                          setConfigDraftPrestaciones((rows) => rows.map((r) => ({ ...r, enabled: false })))
                        }
                      >
                        Ninguno
                      </button>
                    </span>
                  </div>
                  <div className="config-scroll config-unified-list">
                    {configPrestFiltered.map((row) => (
                      <label
                        key={row.codigo}
                        className="prestador-checkbox config-unified-row config-row-prest"
                      >
                        <input
                          type="checkbox"
                          checked={!!row.enabled}
                          onChange={() =>
                            setConfigDraftPrestaciones((rows) =>
                              rows.map((r) =>
                                r.codigo === row.codigo ? { ...r, enabled: !r.enabled } : r
                              )
                            )
                          }
                        />
                        <span className="config-prest-line">
                          <span className="config-codigo">{row.codigo}</span>
                          <span className="config-prest-name">{row.nombre}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {configPrestFiltered.length === 0 && (
                    <p className="config-list-empty">Ninguna prestación coincide con la búsqueda.</p>
                  )}
                </div>
              )}
              {configTab === 'reglas' && (
                <div className="config-tab-panel">
                  <div className="reglas-filtros">
                    <div className="field">
                      <label>Profesional</label>
                      <SearchableSelect
                        options={filtroProfSelectOptions}
                        value={filtroReglaProf}
                        onChange={setFiltroReglaProf}
                        placeholder="Todos"
                        maxHeight={240}
                      />
                    </div>
                    <div className="field">
                      <label>Prestación</label>
                      <SearchableSelect
                        options={filtroPrestSelectOptions}
                        value={filtroReglaPrest}
                        onChange={setFiltroReglaPrest}
                        placeholder="Todos"
                        maxHeight={240}
                      />
                    </div>
                    <div className="field">
                      <label>Modalidad</label>
                      <SearchableSelect
                        options={filtroModSelectOptions}
                        value={filtroReglaMod}
                        onChange={setFiltroReglaMod}
                        placeholder="Todos"
                        maxHeight={220}
                      />
                    </div>
                  </div>
                  <div className="config-scroll reglas-table-wrap">
                    {reglasVisibles.length > 0 ? (
                      <table className="reglas-table">
                        <thead>
                          <tr>
                            <th>Profesional</th>
                            <th>Prestación</th>
                            <th>Modalidad</th>
                            <th>Duración</th>
                            <th className="reglas-table-accion" aria-label="Acciones" />
                          </tr>
                        </thead>
                        <tbody>
                          {reglasVisibles.map((r) => {
                            const prof = profesionalesCatalog.find((p) => String(p.doc) === String(r.profesionalDoc));
                            const prest = prestaciones[r.prestacionCodigo];
                            const prestLabel = prest?.nombre
                              ? `${r.prestacionCodigo} - ${prest.nombre}`
                              : r.prestacionCodigo;
                            return (
                              <tr key={r.id}>
                                <td>{profLabelConDoc(prof?.nombre || '', r.profesionalDoc)}</td>
                                <td>{prestLabel}</td>
                                <td>{labelModalidadRegla(r.modalidad)}</td>
                                <td>{labelDuracion(r.duracionMin)}</td>
                                <td className="reglas-table-accion">
                                  <button
                                    type="button"
                                    className="regla-del"
                                    onClick={() => quitarRegla(r.id)}
                                    disabled={configSaving}
                                    aria-label="Eliminar regla"
                                    title="Eliminar regla"
                                  >
                                    <IconTrash size={16} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <p className="config-list-empty">
                        {configDraftReglas.length === 0
                          ? 'Todavía no hay reglas.'
                          : 'Ninguna regla coincide con el filtro.'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
            {configTab !== 'reglas' && (
            <div className="modal-footer config-footer">
              <button
                type="button"
                className="btn primary"
                disabled={configSaving}
                onClick={saveConfigModal}
              >
                Guardar
              </button>
            </div>
            )}
        </div>
      ) : (
      <>
      <div className="search-panel">
        <div className="search-row">
          <div className="field">
            <label>Prestación</label>
            <SearchableSelect
              options={prestacionOptions}
              value={prestacionId}
              onChange={setPrestacionId}
              placeholder={
                cacheLoaded
                  ? prestacionOptions.length
                    ? 'Escribí para buscar...'
                    : 'No hay prestaciones habilitadas — Config'
                  : 'Cargando...'
              }
              disabled={!cacheLoaded}
              maxHeight={260}
            />
          </div>
          <div className="field">
            <label>Modalidad</label>
            <select value={modalidad} onChange={(e) => setModalidad(e.target.value)}>
              {MODALIDADES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Duración</label>
            <select
              value={duracionMin}
              onChange={(e) => setDuracionMin(Number(e.target.value))}
            >
              {DURACIONES_MIN.map((min) => (
                <option key={min} value={min}>
                  {min} min
                </option>
              ))}
            </select>
          </div>
          <div className="search-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (prestacionId && profesionalesForPrestacion.length > 0) {
                  setPrestadoresModalOpen(true);
                } else {
                  buscar(0);
                }
              }}
              disabled={
                !cacheLoaded ||
                searching ||
                prestacionOptions.length === 0 ||
                !String(prestacionId || '').trim()
              }
            >
              {searching ? 'Buscando...' : 'Buscar turnos'}
            </button>
          </div>
        </div>

        {(slotsRaw.length > 0 || searchReturnedEmpty) && (
          <div className="results-summary-row">
            {searchReturnedEmpty && slotsRaw.length === 0 ? (
              <div className="results-summary visible">Sin turnos en este rango</div>
            ) : null}
            <button
              type="button"
              className="btn btn-limpiar"
              onClick={limpiarBusqueda}
              disabled={searching}
              title="Quitar prestación, resultados y volver al estado inicial"
            >
              Limpiar
            </button>
          </div>
        )}
        {prestacionId && profesionalesForPrestacion.length === 0 && (
          <p className="prestadores-picker-empty">
            No hay prestadores habilitados en Config para esta prestación (sedes: {sedesCarga.join(', ')}).
          </p>
        )}
      </div>

      {prestadoresModalOpen && prestacionId && profesionalesForPrestacion.length > 0 && (
        <div className="fl-modal-backdrop" role="presentation">
          <div
            className="fl-modal fl-modal--wide fl-modal--busca-prestadores"
            role="dialog"
            aria-modal="true"
            aria-labelledby="busca-prestadores-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fl-modal__header">
              <h2 id="busca-prestadores-title">Prestadores</h2>
              <button
                type="button"
                className="fl-icon-btn"
                onClick={() => setPrestadoresModalOpen(false)}
                aria-label="Cerrar"
              >
                <IconX size={18} />
              </button>
            </div>
            <div className="fl-modal__body modal-prestadores-body">
              <div className="config-list-header-row config-list-toolbar">
                <input
                  type="text"
                  className="config-search-input modal-prestadores-search"
                  placeholder="Buscar por nombre o documento..."
                  value={prestadorFilter}
                  onChange={(e) => setPrestadorFilter(e.target.value)}
                  autoComplete="off"
                />
                <span className="prestadores-list-actions">
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => setSelectedDocs(profesionalesForPrestacion.map((p) => p.doc))}
                  >
                    Todos
                  </button>
                  <span className="prestadores-list-sep">·</span>
                  <button type="button" className="btn-link" onClick={() => setSelectedDocs([])}>
                    Ninguno
                  </button>
                </span>
              </div>
              <div className="config-scroll modal-prestadores-scroll">
                <div className="prestadores-list-grid modal-prestadores-grid">
                  {prestadoresModalFiltered.map((p) => {
                    const checked = selectedDocs.includes(p.doc);
                    return (
                      <label key={p.doc} className="prestador-checkbox">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            if (checked) {
                              setSelectedDocs(selectedDocs.filter((d) => d !== p.doc));
                            } else {
                              setSelectedDocs([...selectedDocs, p.doc]);
                            }
                          }}
                        />
                        <span className="prestador-nombre">{titleCase(p.nombre || '')}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              {prestadoresModalFiltered.length === 0 && (
                <p className="config-list-empty">Ningún profesional coincide con la búsqueda.</p>
              )}
              <p className="config-list-footer modal-prestadores-footer">
                {selectedDocs.length} de {profesionalesForPrestacion.length} seleccionados
              </p>
            </div>
            <div className="fl-modal__footer">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setPrestadoresModalOpen(false);
                  buscar(0);
                }}
                disabled={selectedDocs.length === 0}
              >
                Buscar turnos
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="busca-turno-results">
      {status.visible && (
        <div className={`status-bar visible ${status.error ? 'error' : ''}`}>{status.text}</div>
      )}
      {progress != null && !configView && (
        <div className="progress-bar-wrap visible">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}

      {searchReturnedEmpty && slotsRaw.length === 0 && (
        <div className="empty-state">
          <p className="empty-state-text">
            {searchOffset === 0
              ? 'No se encontraron turnos en los próximos 21 días.'
              : 'Tampoco hay turnos en ese rango.'}
          </p>
          <p className="empty-state-hint">Podés ampliar la búsqueda a los siguientes 21 días.</p>
          <button
            type="button"
            className="btn primary empty-state-btn"
            onClick={() => buscar(searchOffset)}
            disabled={searching}
          >
            {searching ? 'Buscando...' : 'Ampliar búsqueda'}
          </button>
        </div>
      )}

      {slotsRaw.length > 0 && dayEntries.length === 0 && (
        <div className="empty-state">
          <p className="empty-state-text">
            {reglasDeBusqueda.length > 0
              ? 'No hay turnos que cumplan la duración. Si el profesional tiene una regla, esa manda sobre la duración general.'
              : `No hay ${duracionMin} minutos seguidos libres${
                  modalidad === 'VIRTUAL'
                    ? ' en modalidad virtual'
                    : modalidad === 'PRESENCIAL'
                      ? ' en modalidad presencial'
                      : ''
                }.`}
          </p>
          <p className="empty-state-hint">
            {reglasDeBusqueda.length > 0
              ? 'La regla pide huecos consecutivos del mismo profesional y la misma modalidad.'
              : 'Hacen falta turnos seguidos del mismo profesional que sumen esa duración. El módulo puede ser de 15, 30 o 45 min.'}
          </p>
        </div>
      )}

      {dayEntries.length > 0 && (
        <div id="results-container">
          {dayEntries.map(([key, daySlots]) => {
            const fecha = new Date(key + 'T12:00:00');
            const sorted = [...daySlots].sort((a, b) => a.fechaHora - b.fechaHora);
            const byProf = new Map();
            for (const s of sorted) {
              const doc = String(s.profesionalDoc);
              if (!byProf.has(doc)) {
                byProf.set(doc, { nombre: s.profesional, slots: [] });
              }
              byProf.get(doc).slots.push(s);
            }
            const profBlocks = sortProfesionalesAlfabetico(
              [...byProf.entries()].map(([doc, g]) => ({
                doc,
                nombre: g.nombre,
                slots: g.slots.sort((a, b) => a.fechaHora - b.fechaHora),
              }))
            );
            const dayCollapsed = collapsedDays.has(key);
            return (
              <div key={key} className={`day-group${dayCollapsed ? ' is-collapsed' : ''}`}>
                <button
                  type="button"
                  className="day-header"
                  onClick={() => {
                    setCollapsedDays((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                  aria-expanded={!dayCollapsed}
                >
                  <span className="day-header-main">
                    <span className="day-header-chevron" aria-hidden>
                      ▾
                    </span>
                    <span className="day-header-label">{fmtDayLabel(fecha)}</span>
                  </span>
                  <span className="day-count">
                    {sorted.length} turno{sorted.length !== 1 ? 's' : ''}
                  </span>
                </button>
                {!dayCollapsed && (
                  <div className="day-prof-list">
                    {profBlocks.map(({ doc, nombre, slots: profSlots }) => (
                      <div key={doc} className="day-prof-block">
                        <div className="day-prof-header">
                          <span className="day-prof-name">{profLabelConDoc(nombre, doc)}</span>
                        </div>
                        <div className="slot-grid slot-grid-by-prof">
                          {profSlots.map((s, i) => {
                            const virtual = isSlotVirtual(s.edificio);
                            const tooltip = virtual
                              ? 'Virtual'
                              : [s.edificio, s.sector].filter(Boolean).join(' · ') || 'Presencial';
                            const modulos = s.modulos?.length ? s.modulos : [s];
                            const ocupa =
                              modulos.length > 1
                                ? `Ocupa ${modulos.length} módulos: ${textoModulos(modulos)}`
                                : '';
                            const reglaTxt = s.porRegla
                              ? `Regla · ${labelDuracion(s.duracionMin || (s.moduloMin || PASO_MIN) * modulos.length)}`
                              : '';
                            const detalle = [ocupa, reglaTxt].filter(Boolean).join(' · ');
                            return (
                              <button
                                key={`${doc}-${new Date(s.fechaHora).getTime()}-${i}`}
                                type="button"
                                className={`slot-card slot-card-compact${virtual ? ' slot-card--virtual' : ' slot-card--presencial'}${detalle ? ' slot-card--multi' : ''}`}
                                onClick={() => openAssignModal(s)}
                                title={tooltip}
                                aria-label={`Asignar turno ${fmtTime(s.fechaHora)}. ${tooltip}${detalle ? `. ${detalle}` : ''}`}
                              >
                                <span className="slot-time-row">
                                  <span
                                    className="slot-mod-icon"
                                    title={tooltip}
                                    aria-hidden
                                  >
                                    {virtual ? (
                                      <IconMonitor size={14} />
                                    ) : (
                                      <IconBuilding size={14} />
                                    )}
                                  </span>
                                  <span className="slot-time">{fmtTime(s.fechaHora)}</span>
                                </span>
                                {detalle ? <span className="slot-modulos">{detalle}</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {slotsRaw.length > 0 && (
        <div className="load-more-wrap">
          <button
            type="button"
            className="btn load-more-btn"
            onClick={() => buscar(searchOffset, true)}
            disabled={searching}
          >
            {searching ? 'Buscando...' : 'Buscar más fechas'}
          </button>
        </div>
      )}
      </div>

      </>
      )}


      {reglaModalOpen && (
        <div className="fl-modal-backdrop" role="presentation">
          <div
            className="fl-modal fl-modal--busca-regla"
            role="dialog"
            aria-modal="true"
            aria-labelledby="busca-regla-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fl-modal__header">
              <h2 id="busca-regla-title">Agregar regla</h2>
              <button
                type="button"
                className="fl-icon-btn"
                onClick={() => setReglaModalOpen(false)}
                aria-label="Cerrar"
              >
                <IconX size={18} />
              </button>
            </div>
            <div className="fl-modal__body">
              <div className="reglas-modal-form">
                <div className="field">
                  <label>Profesional</label>
                  <SearchableSelect
                    options={reglaProfOptions}
                    value={reglaProfDoc}
                    onChange={setReglaProfDoc}
                    placeholder={reglaProfOptions.length ? 'Elegí un profesional...' : 'Sin profesionales habilitados'}
                    disabled={reglaProfOptions.length === 0}
                    maxHeight={240}
                  />
                </div>
                <div className="field">
                  <label>Prestación</label>
                  <SearchableSelect
                    options={reglaPrestOptions}
                    value={reglaPrestCod}
                    onChange={setReglaPrestCod}
                    placeholder={
                      !reglaProfDoc
                        ? 'Primero elegí un profesional'
                        : reglaPrestOptions.length
                          ? 'Prestaciones que atiende...'
                          : 'Este profesional no tiene prestaciones tildadas'
                    }
                    disabled={!reglaProfDoc || reglaPrestOptions.length === 0}
                    maxHeight={240}
                  />
                </div>
                <div className="field">
                  <label>Modalidad</label>
                  <select value={reglaModalidad} onChange={(e) => setReglaModalidad(e.target.value)}>
                    {REGLA_MODALIDADES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Duración</label>
                  <select value={reglaDuracion} onChange={(e) => setReglaDuracion(Number(e.target.value))}>
                    {DURACIONES_MIN.map((min) => (
                      <option key={min} value={min}>
                        {labelDuracion(min)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="fl-modal__footer">
              <button type="button" className="btn btn-secondary" onClick={() => setReglaModalOpen(false)} disabled={configSaving}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={agregarRegla} disabled={configSaving}>
                {configSaving ? 'Guardando...' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedSlotForAssign && (
        <div className="fl-modal-backdrop" role="presentation">
          <div
            className="fl-modal fl-modal--busca-asignar"
            role="dialog"
            aria-modal="true"
            aria-labelledby="busca-asignar-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fl-modal__header">
              <h2 id="busca-asignar-title">Asignar turno</h2>
              <button type="button" className="fl-icon-btn" onClick={closeAssignModal} aria-label="Cerrar">
                <IconX size={18} />
              </button>
            </div>
            <div className="fl-modal__body">
              <div className="modal-slot-info" aria-label="Datos del turno">
                <div className="modal-slot-row">
                  <span className="modal-slot-label">Fecha</span>
                  <span className="modal-slot-value">{fmtDayLabelTitulo(selectedSlotForAssign.fechaHora)}</span>
                </div>
                <div className="modal-slot-row">
                  <span className="modal-slot-label">Hora</span>
                  <span className="modal-slot-value modal-slot-value--time">{fmtTime(selectedSlotForAssign.fechaHora)}</span>
                </div>
                <div className="modal-slot-row">
                  <span className="modal-slot-label">Duración</span>
                  <span className="modal-slot-value">
                    {labelDuracion(
                      selectedSlotForAssign.duracionMin ||
                        (selectedSlotForAssign.moduloMin || PASO_MIN) *
                          (selectedSlotForAssign.modulos?.length || 1)
                    )}
                    {selectedSlotForAssign.porRegla ? ' · según regla' : ''}
                  </span>
                </div>
                {(selectedSlotForAssign.modulos?.length || 1) > 1 && (
                  <div className="modal-slot-row">
                    <span className="modal-slot-label">Módulos</span>
                    <span className="modal-slot-value modal-slot-value--time">
                      Ocupa {selectedSlotForAssign.modulos.length} módulos:{' '}
                      {textoModulos(selectedSlotForAssign.modulos)}. Se van a crear{' '}
                      {selectedSlotForAssign.modulos.length} turnos para el mismo paciente.
                    </span>
                  </div>
                )}
                <div className="modal-slot-row">
                  <span className="modal-slot-label">Modalidad</span>
                  <span className="modal-slot-value">
                    {slotModalidadLabel(selectedSlotForAssign.edificio)}
                    {selectedSlotForAssign.edificio
                      ? ` · ${selectedSlotForAssign.edificio}${
                          selectedSlotForAssign.sector
                            ? ` · ${selectedSlotForAssign.sector}`
                            : ''
                        }`
                      : ''}
                  </span>
                </div>
                <div className="modal-slot-row">
                  <span className="modal-slot-label">Profesional</span>
                  <span className="modal-slot-value">{titleCase(selectedSlotForAssign.profesional || '')}</span>
                </div>
              </div>
              {!personaData ? (
                <>
                  <label className="modal-field">
                    <span>DNI del paciente</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Ej. 30123456"
                      value={assignDni}
                      onChange={(e) => setAssignDni(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      onKeyDown={(e) => e.key === 'Enter' && handleBuscarPaciente()}
                      disabled={assignLoading}
                    />
                  </label>
                  {assignPacienteNoEncontrado && (
                    <>
                      <p className="modal-info">
                        No se encontró una ficha con ese documento. Completá los datos para asignar el
                        turno igualmente (sin generación de pago).
                      </p>
                      <label className="modal-field">
                        <span>Nombre</span>
                        <input
                          type="text"
                          autoComplete="given-name"
                          placeholder="Nombre"
                          value={assignNombreManual}
                          onChange={(e) => setAssignNombreManual(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleContinuarPacienteManual()}
                          disabled={assignLoading}
                        />
                      </label>
                      <label className="modal-field">
                        <span>Apellido</span>
                        <input
                          type="text"
                          autoComplete="family-name"
                          placeholder="Apellido"
                          value={assignApellidoManual}
                          onChange={(e) => setAssignApellidoManual(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleContinuarPacienteManual()}
                          disabled={assignLoading}
                        />
                      </label>
                      <div className="modal-field modal-field-sexo">
                        <span className="modal-field-label-block">Sexo</span>
                        <div className="modal-sexo-options" role="radiogroup" aria-label="Sexo">
                          <label className="modal-radio">
                            <input
                              type="radio"
                              name="assign-sexo-manual"
                              checked={assignSexoManual === 'MASCULINO'}
                              onChange={() => setAssignSexoManual('MASCULINO')}
                              disabled={assignLoading}
                            />
                            Masculino
                          </label>
                          <label className="modal-radio">
                            <input
                              type="radio"
                              name="assign-sexo-manual"
                              checked={assignSexoManual === 'FEMENINO'}
                              onChange={() => setAssignSexoManual('FEMENINO')}
                              disabled={assignLoading}
                            />
                            Femenino
                          </label>
                        </div>
                      </div>
                      <label className="modal-field">
                        <span>Email</span>
                        <input
                          type="email"
                          autoComplete="email"
                          inputMode="email"
                          placeholder="correo@ejemplo.com"
                          value={assignEmailManual}
                          onChange={(e) => setAssignEmailManual(e.target.value)}
                          disabled={assignLoading}
                        />
                      </label>
                      <label className="modal-field">
                        <span>Teléfono</span>
                        <input
                          type="tel"
                          autoComplete="tel"
                          inputMode="tel"
                          placeholder="Ej. 1155551234"
                          value={assignTelefonoManual}
                          onChange={(e) =>
                            setAssignTelefonoManual(e.target.value.replace(/[^\d+\s()-]/g, ''))
                          }
                          disabled={assignLoading}
                        />
                      </label>
                    </>
                  )}
                  {assignError && <p className="modal-error">{assignError}</p>}
                </>
              ) : (
                <>
                  <div className="modal-persona">
                    <p className="modal-persona-title">Datos del paciente</p>
                    <p>
                      <strong>
                        {titleCase(personaData.PersonaNombre)} {titleCase(personaData.PersonaApellido || '')}
                      </strong>
                    </p>
                    {(personaData.PersonaEmail || personaData._manual) && (
                      <p>{personaData.PersonaEmail || '—'}</p>
                    )}
                    {(personaData.PersonaTelefonoCel || personaData._manual) && (
                      <p>Tel. {personaData.PersonaTelefonoCel || '—'}</p>
                    )}
                  </div>
                  {assignError && <p className="modal-error">{assignError}</p>}
                </>
              )}
            </div>
            <div className="fl-modal__footer">
              {!personaData ? (
                <>
                  {assignPacienteNoEncontrado && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleBuscarPaciente}
                      disabled={!assignDni.trim() || assignLoading}
                    >
                      {assignLoading ? 'Buscando...' : 'Buscar de nuevo'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={assignPacienteNoEncontrado ? handleContinuarPacienteManual : handleBuscarPaciente}
                    disabled={
                      assignLoading ||
                      !assignDni.trim() ||
                      (assignPacienteNoEncontrado &&
                        (!assignNombreManual.trim() ||
                          !assignApellidoManual.trim() ||
                          !assignEmailManual.trim() ||
                          assignTelefonoManual.replace(/\D/g, '').length < 6))
                    }
                  >
                    {assignLoading
                      ? 'Buscando...'
                      : assignPacienteNoEncontrado
                        ? 'Continuar con estos datos'
                        : 'Buscar paciente'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setPersonaData(null);
                      setAssignPacienteNoEncontrado(false);
                      setAssignNombreManual('');
                      setAssignApellidoManual('');
                      setAssignSexoManual('MASCULINO');
                      setAssignEmailManual('');
                      setAssignTelefonoManual('');
                      setAssignError('');
                    }}
                  >
                    Cambiar paciente
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleAsignarTurno}
                    disabled={assignLoading}
                  >
                    {assignLoading
                      ? 'Asignando...'
                      : (selectedSlotForAssign.modulos?.length || 1) > 1
                        ? `Asignar ${selectedSlotForAssign.modulos.length} turnos`
                        : 'Asignar turno'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BuscaTurnoApp(props) {
  return <App {...props} />;
}
