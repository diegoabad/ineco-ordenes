import { useMemo } from "react";
import { normalizeRichHtml } from "../lib/richText";

type Props = {
  html: string;
  className?: string;
};

export function RichTextContent({ html, className }: Props) {
  const safe = useMemo(() => normalizeRichHtml(html), [html]);

  if (!safe) {
    return <span className="text-muted">Sin descripción</span>;
  }

  return (
    <div
      className={`rich-text-content${className ? ` ${className}` : ""}`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
