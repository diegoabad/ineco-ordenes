import { useCallback, useRef, useState } from "react";
import { WHATSAPP_SECTIONS, type WhatsappSection } from "../lib/appNav";
import { IconPlus } from "./Icons";
import { WhatsAppConversationsPanel } from "./WhatsAppConversationsPanel";
import { WhatsAppOperatorsPanel } from "./WhatsAppOperatorsPanel";
import { WhatsAppQuickRepliesPanel } from "./WhatsAppQuickRepliesPanel";
import { WhatsAppTagsPanel, type TagsPanelTab } from "./WhatsAppTagsPanel";
import { WhatsAppConfigPanel } from "./WhatsAppConfigPanel";
import { WhatsAppMotorPanel } from "./WhatsAppMotorPanel";
import { WhatsAppIntencionesPanel } from "./WhatsAppIntencionesPanel";
import { WhatsAppConocimientoPanel } from "./WhatsAppConocimientoPanel";
import { WhatsAppMetricasPanel } from "./WhatsAppMetricasPanel";
import { WhatsAppMenuFlujosPanel } from "./WhatsAppMenuFlujosPanel";

type Props = {
  section: WhatsappSection;
};

export function WhatsAppModule({ section }: Props) {
  const label =
    WHATSAPP_SECTIONS.find((item) => item.id === section)?.label ?? "CRM";
  const [tagsTab, setTagsTab] = useState<TagsPanelTab>("etiquetas");
  const [configHasData, setConfigHasData] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const onTagsTabChange = useCallback((tab: TagsPanelTab) => {
    setTagsTab(tab);
  }, []);
  const createPruebaRef = useRef<(() => void) | null>(null);
  const createReplyRef = useRef<(() => void) | null>(null);
  const createTagRef = useRef<(() => void) | null>(null);
  const createGroupRef = useRef<(() => void) | null>(null);
  const addOperatorRef = useRef<(() => void) | null>(null);
  const openConfigJsonRef = useRef<(() => void) | null>(null);
  const createIntencionRef = useRef<(() => void) | null>(null);

  return (
    <div className="app-shell">
      <header
        className={`app-header${section === "conversaciones" || section === "prueba" || section === "prueba-bot" ? " wa-header" : ""}`}
      >
        <div className="app-header__brand">
          <div>
            <h1>{label}</h1>
            {section === "conversaciones" ? (
              <p>Chats del WhatsApp vinculado</p>
            ) : section === "prueba" ? (
              <p>Números ficticios para hablarle al bot y ver la ficha. No sale por WhatsApp.</p>
            ) : section === "prueba-bot" ? (
              <p>Números ficticios para probar el bot de opciones. No sale por WhatsApp.</p>
            ) : section === "flujos-bot" ? (
              <p>Mapa visual de menús, opciones, acciones y respuestas del bot sin IA</p>
            ) : section === "operadoras" ? (
              <p>Usuarios a los que se pueden derivar las conversaciones</p>
            ) : section === "respuestas-rapidas" ? (
              <p>Atajos con disparadores tipo /saludo y variables como {"{{nombre}}"}</p>
            ) : section === "etiquetas" ? (
              <p>
                {tagsTab === "grupos"
                  ? "Grupos para organizar y colorear las etiquetas"
                  : "Etiquetas para clasificar las conversaciones"}
              </p>
            ) : section === "config" ? (
              <p>Identidad, saludo, tono y cómo se comunica el bot</p>
            ) : section === "motor" ? (
              <p>Interpretación, contexto y comportamiento del motor conversacional</p>
            ) : section === "intenciones" ? (
              <p>Objetivos que el bot puede reconocer y resolver</p>
            ) : section === "metricas" ? (
              <p>Conversaciones del período, por bot, operador y etiquetas</p>
            ) : section === "conocimiento" ? (
              <p>Información institucional que el bot puede usar para responder</p>
            ) : null}
          </div>
        </div>
        {section === "prueba" || section === "prueba-bot" ? (
          <div className="app-header__actions wa-header-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => createPruebaRef.current?.()}
            >
              <IconPlus size={16} />
              Crear prueba
            </button>
          </div>
        ) : section === "operadoras" ? (
          <div className="app-header__actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => addOperatorRef.current?.()}
            >
              <IconPlus size={16} />
              Agregar
            </button>
          </div>
        ) : section === "etiquetas" ? (
          <div className="app-header__actions">
            {tagsTab === "grupos" ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => createGroupRef.current?.()}
              >
                <IconPlus size={16} />
                Crear grupo
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => createTagRef.current?.()}
              >
                <IconPlus size={16} />
                Nueva etiqueta
              </button>
            )}
          </div>
        ) : section === "respuestas-rapidas" ? (
          <div className="app-header__actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => createReplyRef.current?.()}
            >
              <IconPlus size={16} />
              Nueva respuesta
            </button>
          </div>
        ) : section === "config" ? (
          <div className="app-header__actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={configSaving}
              onClick={() => openConfigJsonRef.current?.()}
            >
              {configHasData ? "Actualizar configuración" : "Crear configuración"}
            </button>
          </div>
        ) : section === "intenciones" ? (
          <div className="app-header__actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => createIntencionRef.current?.()}
            >
              <IconPlus size={16} />
              Nueva intención
            </button>
          </div>
        ) : null}
      </header>
      {section === "conversaciones" ? (
        <WhatsAppConversationsPanel key="conversaciones" />
      ) : section === "prueba" ? (
        <WhatsAppConversationsPanel
          key="prueba"
          mode="prueba"
          createPruebaRef={createPruebaRef}
        />
      ) : section === "prueba-bot" ? (
        <WhatsAppConversationsPanel
          key="prueba-bot"
          mode="prueba-bot"
          createPruebaRef={createPruebaRef}
        />
      ) : section === "operadoras" ? (
        <WhatsAppOperatorsPanel addRef={addOperatorRef} />
      ) : section === "respuestas-rapidas" ? (
        <WhatsAppQuickRepliesPanel createRef={createReplyRef} />
      ) : section === "etiquetas" ? (
        <WhatsAppTagsPanel
          createRef={createTagRef}
          createGroupRef={createGroupRef}
          onTabChange={onTagsTabChange}
        />
      ) : section === "config" ? (
        <WhatsAppConfigPanel
          openJsonRef={openConfigJsonRef}
          onStatusChange={({ hasConfig, saving }) => {
            setConfigHasData(hasConfig);
            setConfigSaving(saving);
          }}
        />
      ) : section === "motor" ? (
        <WhatsAppMotorPanel />
      ) : section === "intenciones" ? (
        <WhatsAppIntencionesPanel createRef={createIntencionRef} />
      ) : section === "metricas" ? (
        <WhatsAppMetricasPanel />
      ) : section === "conocimiento" ? (
        <WhatsAppConocimientoPanel />
      ) : section === "flujos-bot" ? (
        <WhatsAppMenuFlujosPanel />
      ) : (
        <div className="fl-table-empty fl-table-empty--fill">
          <p className="fl-table-empty__title">Próximamente</p>
          <p className="fl-table-empty__hint">
            Esta sección todavía no está integrada.
          </p>
        </div>
      )}
    </div>
  );
}
