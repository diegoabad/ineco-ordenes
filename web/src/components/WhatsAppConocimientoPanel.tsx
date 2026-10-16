import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "react-toastify";
import {
  fetchWhatsappConocimiento,
  saveWhatsappConocimiento,
} from "../services/whatsappCrmService";
import { LoadingBlock } from "./InecoMark";

const PLACEHOLDER = `# Sucursales
## CABA
Dirección:
Teléfono:
Horarios:

# Tratamientos

# Profesionales
`;

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
      if (link) {
        parts.push(
          <a key={key++} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>,
        );
      } else {
        parts.push(token);
      }
    } else {
      parts.push(
        <a key={key++} href={token} target="_blank" rel="noreferrer">
          {token}
        </a>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

type MdItem = { text: string; children: MdItem[] };

function itemDepth(raw: string): { depth: number; text: string } {
  const indent = /^[ \t]*/.exec(raw)?.[0] ?? "";
  const spaces = indent.replace(/\t/g, "  ").length;
  const body = raw.slice(indent.length).replace(/^(?:[-*•]|\d+\.)\s+/, "");
  return { depth: Math.floor(spaces / 2), text: body };
}

function renderItems(items: MdItem[], keyPrefix: string): ReactNode {
  return (
    <ul key={keyPrefix}>
      {items.map((item, i) => (
        <li key={i}>
          {renderInline(item.text)}
          {item.children.length > 0 ? renderItems(item.children, `${keyPrefix}-${i}`) : null}
        </li>
      ))}
    </ul>
  );
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function MarkdownView({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let root: MdItem[] = [];

  function flushList() {
    if (!root.length) return;
    blocks.push(renderItems(root, `ul-${blocks.length}`));
    root = [];
  }

  function pushItem(depth: number, text: string) {
    if (!text.trim()) return;
    let level = root;
    let currentDepth = 0;
    while (currentDepth < depth) {
      const parent = level[level.length - 1];
      if (!parent) break;
      level = parent.children;
      currentDepth += 1;
    }
    level.push({ text, children: [] });
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      flushList();
      blocks.push(<div key={`sp-${blocks.length}`} className="wa-md-gap" />);
      continue;
    }
    if (/^\s*-{3,}\s*$/.test(line)) {
      flushList();
      blocks.push(<hr key={`hr-${blocks.length}`} />);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushList();
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      i -= 1;
      blocks.push(
        <div key={`tw-${blocks.length}`} className="wa-md-table-wrap">
          <table>
            <thead>
              <tr>
                {headers.map((cell, c) => (
                  <th key={c}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {headers.map((_, c) => (
                    <td key={c}>{renderInline(row[c] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      blocks.push(<Tag key={`h-${blocks.length}`}>{renderInline(heading[2])}</Tag>);
      continue;
    }
    const item = itemDepth(line);
    pushItem(item.depth, item.text);
  }
  flushList();

  return <div className="wa-conocimiento-preview">{blocks}</div>;
}

function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function WhatsAppConocimientoPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [editing, setEditing] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWhatsappConocimiento();
      setText(res.text);
      setSavedText(res.text);
      setUpdatedAt(res.updatedAt);
      setEditing(res.text.trim() === "");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "No se pudo cargar la base de conocimiento",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      const saved = await saveWhatsappConocimiento(text);
      setText(saved.text);
      setSavedText(saved.text);
      setUpdatedAt(saved.updatedAt);
      setEditing(saved.text.trim() === "");
      toast.success("Base de conocimiento guardada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setText(savedText);
    setEditing(false);
  }

  const dirty = text !== savedText;
  const canPreview = savedText.trim() !== "";

  if (loading) {
    return (
      <div className="wa-config-panel">
        <LoadingBlock label="Cargando base de conocimiento…" />
      </div>
    );
  }

  return (
    <div className="wa-config-panel wa-conocimiento">
      {editing ? (
        <textarea
          className="wa-config-panel__textarea wa-conocimiento-textarea"
          value={text}
          placeholder={PLACEHOLDER}
          onChange={(e) => setText(e.target.value)}
          spellCheck
          disabled={saving}
        />
      ) : (
        <MarkdownView source={savedText} />
      )}
      <div className="wa-conocimiento-footer">
        <span className="wa-config-panel__meta">
          {updatedAt ? `Guardado ${formatSavedAt(updatedAt)}` : "Todavía no hay texto guardado"}
          {dirty ? " · cambios sin guardar" : ""}
        </span>
        {editing ? (
          <div className="wa-conocimiento-actions">
            {canPreview ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCancel}
                disabled={saving}
              >
                Cancelar
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
            Editar
          </button>
        )}
      </div>
    </div>
  );
}
