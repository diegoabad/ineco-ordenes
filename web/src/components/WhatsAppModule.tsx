import { useCallback, useRef, useState } from "react";
import { WHATSAPP_SECTIONS, type WhatsappSection } from "../lib/appNav";
import { IconPlus } from "./Icons";
import { WhatsAppCoberturasPanel } from "./WhatsAppCoberturasPanel";
import {
  WhatsAppConversationsPanel,
  type WaConnectionBanner,
} from "./WhatsAppConversationsPanel";
import { WhatsAppFlowsPanel } from "./WhatsAppFlowsPanel";
import { WhatsAppOperatorsPanel } from "./WhatsAppOperatorsPanel";
import { WhatsAppProfileSchemaPanel } from "./WhatsAppProfileSchemaPanel";
import { WhatsAppQuickRepliesPanel } from "./WhatsAppQuickRepliesPanel";
import { WhatsAppTagsPanel, type TagsPanelTab } from "./WhatsAppTagsPanel";

type Props = {
  section: WhatsappSection;
};

export function WhatsAppModule({ section }: Props) {
  const label =
    WHATSAPP_SECTIONS.find((item) => item.id === section)?.label ?? "WhatsApp";
  const [connection, setConnection] = useState<WaConnectionBanner>({
    connected: false,
    connecting: false,
    label: "Desconectado",
  });
  const [tagsTab, setTagsTab] = useState<TagsPanelTab>("etiquetas");
  const onConnectionChange = useCallback((status: WaConnectionBanner) => {
    setConnection(status);
  }, []);
  const onTagsTabChange = useCallback((tab: TagsPanelTab) => {
    setTagsTab(tab);
  }, []);
  const connectRef = useRef<(() => void) | null>(null);
  const createReplyRef = useRef<(() => void) | null>(null);
  const createFlowRef = useRef<(() => void) | null>(null);
  const createProfileFieldRef = useRef<(() => void) | null>(null);
  const createTagRef = useRef<(() => void) | null>(null);
  const createGroupRef = useRef<(() => void) | null>(null);
  const createCoberturaRef = useRef<(() => void) | null>(null);
  const addOperatorRef = useRef<(() => void) | null>(null);

  return (
    <div className="app-shell">
      <header className={`app-header${section === "conversaciones" ? " wa-header" : ""}`}>
        <div className="app-header__brand">
          <div>
            <h1>{label}</h1>
            {section === "conversaciones" ? (
              <p>Chats del WhatsApp vinculado</p>
            ) : section === "operadoras" ? (
              <p>Usuarios a los que se pueden derivar las conversaciones</p>
            ) : section === "respuestas-rapidas" ? (
              <p>Atajos con disparadores tipo /saludo y variables como {"{{nombre}}"}</p>
            ) : section === "flujos" ? (
              <p>Objetivo, campos del perfil y subflujos que usa cada conversación guiada</p>
            ) : section === "perfil" ? (
              <p>
                Variables del objeto del bot. El orden de preguntas lo definen los flujos.
              </p>
            ) : section === "etiquetas" ? (
              <p>
                {tagsTab === "grupos"
                  ? "Grupos para organizar y colorear las etiquetas"
                  : "Etiquetas para clasificar las conversaciones"}
              </p>
            ) : section === "coberturas" ? (
              <p>Obras sociales disponibles según Infanto o Adulto</p>
            ) : null}
          </div>
        </div>
        {section === "conversaciones" ? (
          <div className="wa-header__status">
            <span
              className={`wa-inbox__status-dot${connection.connected ? " is-online" : ""}`}
            />
            <span className="busca-turno-header-status__label">{connection.label}</span>
          </div>
        ) : null}
        {section === "conversaciones" ? (
          <div className="app-header__actions wa-header-actions">
            {!connection.connected ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => connectRef.current?.()}
                disabled={connection.connecting}
              >
                {connection.connecting ? "Conectando…" : "Conectar"}
              </button>
            ) : null}
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
        ) : section === "coberturas" ? (
          <div className="app-header__actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => createCoberturaRef.current?.()}
            >
              <IconPlus size={16} />
              Nueva cobertura
            </button>
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
        ) : section === "flujos" ? (
          <div className="app-header__actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => createFlowRef.current?.()}
            >
              <IconPlus size={16} />
              Nuevo flujo
            </button>
          </div>
        ) : section === "perfil" ? (
          <div className="app-header__actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => createProfileFieldRef.current?.()}
            >
              <IconPlus size={16} />
              Nuevo campo
            </button>
          </div>
        ) : null}
      </header>
      {section === "conversaciones" ? (
        <WhatsAppConversationsPanel
          onConnectionChange={onConnectionChange}
          connectRef={connectRef}
        />
      ) : section === "operadoras" ? (
        <WhatsAppOperatorsPanel addRef={addOperatorRef} />
      ) : section === "respuestas-rapidas" ? (
        <WhatsAppQuickRepliesPanel createRef={createReplyRef} />
      ) : section === "flujos" ? (
        <WhatsAppFlowsPanel createRef={createFlowRef} />
      ) : section === "perfil" ? (
        <WhatsAppProfileSchemaPanel createRef={createProfileFieldRef} />
      ) : section === "etiquetas" ? (
        <WhatsAppTagsPanel
          createRef={createTagRef}
          createGroupRef={createGroupRef}
          onTabChange={onTagsTabChange}
        />
      ) : section === "coberturas" ? (
        <WhatsAppCoberturasPanel createRef={createCoberturaRef} />
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
