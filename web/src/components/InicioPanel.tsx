type InicioBlock = {
  id: string;
  title: string;
  empty: string;
};

const BLOCKS: InicioBlock[] = [
  {
    id: "hoy",
    title: "Tareas para hoy",
    empty: "No hay tareas para hoy.",
  },
  {
    id: "vencidas",
    title: "Tareas vencidas",
    empty: "No hay tareas vencidas.",
  },
  {
    id: "recordatorios",
    title: "Próximos recordatorios",
    empty: "No hay recordatorios próximos.",
  },
  {
    id: "asignadas",
    title: "Tareas asignadas a vos",
    empty: "Nadie te asignó tareas todavía.",
  },
  {
    id: "notas",
    title: "Notas fijadas",
    empty: "Todavía no hay notas fijadas.",
  },
];

function todayLabel(): string {
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

type Props = {
  userName?: string;
};

/** Pantalla de entrada: resumen del día (contenido real en siguientes pasos). */
export function InicioPanel({ userName }: Props) {
  const saludo = userName?.trim() ? `Hola, ${userName.trim().split(/\s+/)[0]}` : "Hola";
  const fecha = todayLabel();

  return (
    <div className="app-shell app-shell--scroll inicio-panel">
      <header className="app-header">
        <div className="app-header__brand">
          <div>
            <h1>Inicio</h1>
            <p>
              {saludo}. {fecha.charAt(0).toUpperCase() + fecha.slice(1)}.
            </p>
          </div>
        </div>
      </header>

      <div className="inicio-grid">
        {BLOCKS.map((block) => (
          <section key={block.id} className="inicio-card">
            <h2 className="inicio-card__title">{block.title}</h2>
            <p className="inicio-card__empty">{block.empty}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
