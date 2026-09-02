import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'react-toastify';
import { IconX } from '../Icons';
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

const MODALIDADES = [
  { value: 'PRESENCIAL', label: 'Presencial' },
  { value: 'VIDEOCONSULTA', label: 'Videoconsulta' },
];

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
      });
      return {
        version: 2,
        profesionales: remote.profesionales,
        prestaciones: remote.prestaciones,
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

/** Solo entran códigos devueltos por la API en esta carga (p. ej. sede actual). No arrastrar códigos de otra sede. */
function mergePrestacionesFromFetch(prevPrestaciones, newMap, enabledDocs) {
  const enabledSet = new Set(enabledDocs);
  const merged = {};
  const allCods = Object.keys(newMap);

  for (const cod of allCods) {
    const prev = prevPrestaciones?.[cod];
    const fresh = newMap[cod];
    const nombre = fresh?.nombre || prev?.nombre || cod;
    const duracion =
      typeof prev?.duracion === 'number' && prev.duracion > 0
        ? prev.duracion
        : DEFAULT_DURACION;
    const enabled =
      prev !== undefined && prev !== null
        ? prev.enabled !== false
        : prestacionEnabledPorDefecto(cod);

    let profesionales;
    if (fresh?.profesionales?.length) {
      profesionales = fresh.profesionales.filter((p) => enabledSet.has(String(p.doc)));
    } else if (prev?.profesionales?.length) {
      profesionales = prev.profesionales.filter((p) => enabledSet.has(String(p.doc)));
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

/** Aplica el borrador de Config sobre la caché guardada (así Actualizar respeta toggles aunque no hayas Guardado). */
function mergeUserDraftIntoCachedPrev(rawPrev, draftProfs, draftPrestRows) {
  if (!rawPrev) return rawPrev;
  let prev = rawPrev;
  if (draftProfs?.length && rawPrev.profesionales?.length) {
    const profEnabled = new Map(draftProfs.map((p) => [String(p.doc), !!p.enabled]));
    prev = {
      ...prev,
      profesionales: rawPrev.profesionales.map((p) => {
        const e = profEnabled.get(String(p.doc));
        return e !== undefined ? { ...p, enabled: e } : p;
      }),
    };
  }
  if (draftPrestRows?.length && rawPrev.prestaciones && Object.keys(rawPrev.prestaciones).length) {
    const prestEnabled = new Map(draftPrestRows.map((r) => [String(r.codigo), !!r.enabled]));
    const prestaciones = { ...prev.prestaciones };
    for (const cod of Object.keys(prestaciones)) {
      const e = prestEnabled.get(String(cod));
      if (e !== undefined) {
        prestaciones[cod] = { ...prestaciones[cod], enabled: e };
      }
    }
    prev = { ...prev, prestaciones };
  }
  return prev;
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

/** Medexis TurnoNuevo: "YYYY-MM-DD HH:mm:ss" (hora local). */
function formatTurnoFechaHoraMedexis(d) {
  const x = d instanceof Date && !isNaN(d.getTime()) ? d : new Date(d);
  if (isNaN(x.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`;
}

/** Convierte respuesta API (yyyy-mm-dd o ISO) a dd/mm/aaaa para el input. */
function fechaApiToDDMMYYYY(s) {
  const t = String(s || '').trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!iso) return '';
  const day = parseInt(iso[3], 10);
  const month = parseInt(iso[2], 10);
  const year = parseInt(iso[1], 10);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

/** Parsea dd/mm/aaaa (o yyyy-mm-dd) a yyyy-mm-dd para enviar a la API. */
function parseFechaNacimientoParaApi(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) return '';
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Inserta / al escribir: solo dígitos —  dd, dd/mm, dd/mm/aaaa (máx. 8 dígitos). */
function formatFechaNacimientoInput(value) {
  const d = String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const [modalidad, setModalidad] = useState('PRESENCIAL');
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
  const [configSaving, setConfigSaving] = useState(false);
  const configSaveLock = useRef(false);

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

  const resultsSummaryDisplay = useMemo(() => {
    if (!slotsRaw.length || !prestacionId) return '';
    const nombrePrest = prestaciones[prestacionId]?.nombre || prestacionId;
    const days = new Set(slotsRaw.map((s) => fmtDateKey(s.fechaHora))).size;
    return `${slotsRaw.length} turno${slotsRaw.length !== 1 ? 's' : ''} disponibles para "${nombrePrest}" · ${days} día${days !== 1 ? 's' : ''}`;
  }, [slotsRaw, prestacionId, prestaciones]);

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
  const [personaFechaNacimiento, setPersonaFechaNacimiento] = useState('');

  const setSelectedDocs = useCallback((next) => {
    if (!prestacionId) return;
    setSelectedPrestadorDocsByPrestacion((prev) => ({ ...prev, [prestacionId]: next }));
  }, [prestacionId]);

  const clearStatus = useCallback(() => {
    setStatus((s) => ({ ...s, visible: false }));
  }, []);

  const persistState = useCallback(async (profs, prest, opts = {}) => {
    const { silent = true } = opts;
    setCachedFull({ profesionales: profs, prestaciones: prest });
    try {
      await saveBuscaTurnoConfig({
        version: 2,
        sedesCarga: sedesCargaRef.current?.length ? sedesCargaRef.current : ['INECO'],
        profesionales: profs,
        prestaciones: prest,
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
          setCacheLoaded(true);
          setCacheDot('ok');
          const nPrest = Object.values(cached.prestaciones).filter((p) => p.enabled !== false).length;
          setCacheLabel(
            `${nPrest} prestaciones visibles · ${cached.profesionales.filter((x) => x.enabled).length} prof. habilitados`
          );
          setProgress(null);
          // Migración: si solo estaba en local, subir a Firebase.
          if (cached._source === 'local') {
            void persistState(cached.profesionales, cached.prestaciones);
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
        const shouldApplyDraft =
          applyConfigDraft &&
          rawPrev &&
          (draftProfesionales.length > 0 || draftPrestaciones.length > 0);
        const prev = shouldApplyDraft
          ? mergeUserDraftIntoCachedPrev(rawPrev, draftProfesionales, draftPrestaciones)
          : rawPrev;
        let catalog = fromApi.map((p) => {
          const old = prev?.profesionales?.find((x) => String(x.doc) === p.doc);
          return {
            doc: p.doc,
            nombre: p.nombre,
            sede: p.sede,
            enabled: old ? !!old.enabled : true,
          };
        });

        let toFetch = catalog.filter((p) => p.enabled);
        if (toFetch.length === 0) {
          if (fromApi.length === 0) {
            setCacheDot('error');
            setCacheLabel('No hay profesionales');
            setProgress(null);
            return;
          }
          if (prev?.prestaciones && Object.keys(prev.prestaciones).length > 0) {
            setProfesionalesCatalog(catalog);
            setPrestaciones(prev.prestaciones);
            setCacheLoaded(true);
            setCacheDot('warning');
            setCacheLabel('Actualizar cancelado: habilitá al menos un profesional en Config');
            setProgress(null);
            setStatus({
              text: 'No se consultó la API: ningún profesional habilitado. Abrí Config y marcá al menos uno, luego Actualizar.',
              error: true,
              visible: true,
            });
            applyDraftFromServer(catalog, prev.prestaciones);
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
        const merged = mergePrestacionesFromFetch(prevPrest, map, enabledDocs);

        setPrestaciones(merged);
        setProfesionalesCatalog(catalog);
        await persistState(catalog, merged);
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
    setConfigSearchProf('');
    setConfigSearchPrest('');
    setConfigTab('profesionales');
  }, [profesionalesCatalog, prestaciones]);

  useEffect(() => {
    if (configView) prepareConfigDrafts();
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

    try {
      setProfesionalesCatalog(newCatalog);
      setPrestaciones(newPrest);
      await persistState(newCatalog, newPrest, { silent: false });
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
    profesionalesCatalog,
    prestaciones,
    persistState,
    prestacionId,
  ]);

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
        profesionales = profesionales.filter((p) => selected.includes(p.doc));
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
      const MAX_INTENTOS = 3;
      const MAX_PRESTADORES_POR_REQUEST = 10;

      const grupos = [];
      for (let i = 0; i < profesionales.length; i += MAX_PRESTADORES_POR_REQUEST) {
        grupos.push(profesionales.slice(i, i + MAX_PRESTADORES_POR_REQUEST));
      }

      const url = `${config.base}/Turno/Disponible`;

      const parseSlotList = (data) => {
        const slotList = Array.isArray(data) ? data : (data.Turnos || data.turnos || []);
        return slotList.map((s) => {
          const doc = s.profesionalDocumento ?? s.PrestadorDocumento;
          const prof =
            profesionales.find((p) => String(p.doc) === String(doc)) || {
              nombre: s.profesionalNombre || s.PrestadorNombre || '',
              sede: s.sede || s.Sede || '',
            };
          const fechaHora = s.turnoFechaHora || s.TurnoFechaHora;
          return {
            fechaHora: new Date(fechaHora),
            profesional: prof.nombre || s.profesionalNombre || s.PrestadorNombre || '',
            profesionalDoc: String(doc),
            sede: prof.sede || s.sede || s.Sede || '',
            prestacionId,
          };
        });
      };

      for (let intento = 0; intento < MAX_INTENTOS; intento++) {
        const offset = startOffset + intento * 7;
        const desde = addDays(new Date(), offset);
        const hasta = addDays(new Date(), offset + 7);

        setStatus({
          text: `Buscando del ${fmtDisplay(desde)} al ${fmtDisplay(hasta)}...`,
          error: false,
          visible: true,
        });

        const fechaDesde = fmtDate(desde);
        const fechaHasta = fmtDate(hasta);

        const requests = grupos.map(async (grupo) => {
          const modalidadValor = modalidad || 'PRESENCIAL';
          const body = {
            prestacionCodigo: prestacionId,
            profesionalDocumentos: grupo.map((p) => String(p.doc)),
            modalidad: modalidadValor,
            filtros: {
              fechaDesde,
              fechaHasta,
              turnoEstado: 'D',
              modalidad: modalidadValor,
            },
            limite: 20,
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
          return parseSlotList(data);
        });

        const results = await Promise.all(requests);
        for (const sl of results) {
          allSlots.push(...sl);
        }

        if (allSlots.length > 0) break;

        if (intento < MAX_INTENTOS - 1) {
          setStatus({ text: 'Sin resultados en ese rango, ampliando búsqueda...', error: false, visible: true });
          await sleep(200);
        }
      }

      if (allSlots.length === 0) {
        if (!append) {
          setSlotsRaw([]);
          setSearchReturnedEmpty(true);
          clearStatus();
        } else {
          setStatus({ text: 'No hay más turnos en ese rango.', error: false, visible: true });
        }
        setSearchOffset(startOffset + 21);
        return;
      }

      setSlotsRaw((prev) =>
        append ? dedupeSlotsRaw([...prev, ...allSlots]) : dedupeSlotsRaw(allSlots)
      );

      setSearchReturnedEmpty(false);
      setSearchOffset(startOffset + 21);
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
      modalidad,
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
    setPersonaFechaNacimiento('');
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
    setPersonaFechaNacimiento('');
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
    setModalidad('PRESENCIAL');
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
      setPersonaFechaNacimiento(
        fechaApiToDDMMYYYY(person.PersonaFechaNacimiento ?? person.FechaNacimiento ?? '')
      );
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
    setPersonaFechaNacimiento('');
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
      const fechaNacRaw =
        personaFechaNacimiento.trim() ||
        personaData.PersonaFechaNacimiento ||
        personaData.FechaNacimiento ||
        '';
      const fechaNac = parseFechaNacimientoParaApi(fechaNacRaw);
      if (!fechaNac) {
        setAssignError('La fecha de nacimiento es obligatoria (formato dd/mm/aaaa).');
        setAssignLoading(false);
        return;
      }
      if (!slot.prestacionId) {
        setAssignError('Falta el código de la prestación.');
        setAssignLoading(false);
        return;
      }
      const turnoFh = formatTurnoFechaHoraMedexis(
        slot.fechaHora instanceof Date ? slot.fechaHora : new Date(slot.fechaHora)
      );
      if (!turnoFh) {
        setAssignError('La fecha y hora del turno no son válidas.');
        setAssignLoading(false);
        return;
      }
      const turnoItem = {
        PersonaTipoDocumento: 'AR',
        PersonaDocumento: String(personaData.PersonaDocumento ?? assignDni.trim()),
        PersonaNombre: personaData.PersonaNombre ?? '',
        PersonaApellido: personaData.PersonaApellido ?? '',
        PersonaFechaNacimiento: fechaNac,
        PersonaSexo: (personaData.PersonaSexo || 'MASCULINO').toUpperCase().replace('OTRO', 'MASCULINO'),
        PersonaEmail: personaData.PersonaEmail ?? '',
        PersonaTelefonoCel: personaData.PersonaTelefonoCel ?? '',
        PersonaIdioma: 'es',
        PrestadorDocumento: slot.profesionalDoc,
        Sede: (slot.sede && String(slot.sede).trim()) || 'INECO',
        TurnoFechaHora: turnoFh,
        TurnoPrestacion: String(slot.prestacionId),
        GeneraPago: personaData._manual ? 'N' : 'S',
        TurnoX: 1,
      };
      await createTurno({ turno: [turnoItem] });
      const k = slotDedupeKey(slot);
      setSlotsRaw((prev) => prev.filter((s) => slotDedupeKey(s) !== k));
      closeAssignModal();
      toast.success('Turno asignado correctamente.');
    } catch (e) {
      setAssignError(e.message || 'Error al asignar el turno.');
    } finally {
      setAssignLoading(false);
    }
  }, [
    selectedSlotForAssign,
    personaData,
    assignDni,
    personaFechaNacimiento,
    closeAssignModal,
  ]);

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
  slotsRaw.forEach((s) => {
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
              </div>
              <div className="config-sync-strip">
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
                    });
                  }}
                >
                  {progress != null
                    ? 'Actualizando datos desde Medexis…'
                    : 'Actualizar datos desde Medexis'}
                </button>
                {progress != null && (
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
            </div>
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

        {(resultsSummaryDisplay || (searchReturnedEmpty && slotsRaw.length === 0)) && (
          <div className="results-summary-row">
            {resultsSummaryDisplay ? (
              <div className="results-summary visible">{resultsSummaryDisplay}</div>
            ) : (
              <div className="results-summary visible">Sin turnos en este rango</div>
            )}
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
                            const sede = (s.sede && String(s.sede).trim()) || 'INECO';
                            return (
                              <button
                                key={`${doc}-${new Date(s.fechaHora).getTime()}-${i}`}
                                type="button"
                                className="slot-card slot-card-compact"
                                onClick={() => openAssignModal(s)}
                                title="Elegir este horario para asignar turno a un paciente"
                                aria-label={`Asignar turno ${fmtTime(s.fechaHora)} · ${sede}`}
                              >
                                <span className="slot-time">{fmtTime(s.fechaHora)}</span>
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
                  <label className="modal-field">
                    <span>Fecha de nacimiento (obligatorio)</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="bday"
                      placeholder="dd/mm/aaaa"
                      value={personaFechaNacimiento}
                      onChange={(e) =>
                        setPersonaFechaNacimiento(formatFechaNacimientoInput(e.target.value))
                      }
                      disabled={assignLoading}
                    />
                  </label>
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
                    Otro DNI
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleAsignarTurno}
                    disabled={assignLoading || !personaFechaNacimiento.trim()}
                  >
                    {assignLoading ? 'Asignando...' : 'Asignar turno'}
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
