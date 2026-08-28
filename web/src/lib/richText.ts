/** HTML permitido: negrita, cursiva, subrayado, listas, alineación, tamaño y saltos de línea. */

const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "BR", "P", "DIV", "UL", "OL", "LI", "SPAN"]);

export const RICH_ALIGN_CLASSES = {
  left: "rich-align-left",
  center: "rich-align-center",
  right: "rich-align-right",
} as const;

export type RichTextAlign = keyof typeof RICH_ALIGN_CLASSES;

export const RICH_SIZE_CLASSES = {
  sm: "rich-size-sm",
  md: "rich-size-md",
  lg: "rich-size-lg",
} as const;

export type RichTextSize = keyof typeof RICH_SIZE_CLASSES;

/** Tamaños en pt para el PDF (pequeño / medio / grande). */
export const RICH_SIZE_PDF_PT: Record<RichTextSize, number> = {
  sm: 8,
  md: 10,
  lg: 13,
};

export const PDF_ALIGN_MARKER_RE = /^\[\[align:(left|center|right)\]\]/;
export const PDF_SIZE_MARKER_RE = /^\[\[size:(sm|md|lg)\]\]/;
export const PDF_ANY_MARKER_RE = /^\[\[(?:align|size):[^\]]+\]\]|^\[\[\/size\]\]/;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** ¿Parece HTML enriquecido (no texto plano)? */
export function looksLikeRichHtml(text: string): boolean {
  return /<(?:b|strong|i|em|u|br|p|div|ul|ol|li|span)\b/i.test(text);
}

/** Texto plano → HTML conservando enters y espacios. */
export function plainTextToHtml(text: string): string {
  if (!text) return "";
  return escapeHtml(text).replace(/\n/g, "<br>");
}

/** Normaliza para guardar o mostrar (acepta texto plano viejo o HTML). */
export function normalizeRichHtml(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const html = looksLikeRichHtml(trimmed) ? trimmed : plainTextToHtml(trimmed);
  return sanitizeRichHtml(html);
}

/** Quita etiquetas; deja saltos de línea visibles. */
export function stripRichHtml(input: string): string {
  if (!input.trim()) return "";
  if (!looksLikeRichHtml(input)) return input;
  const doc = new DOMParser().parseFromString(normalizeRichHtml(input), "text/html");
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName;
    const inner = [...el.childNodes].map(walk).join("");
    if (tag === "BR") return "\n";
    if (tag === "UL") {
      return [...el.children]
        .map((child) => {
          if (child.tagName !== "LI") return walk(child);
          return `• ${walk(child).trim()}`;
        })
        .filter(Boolean)
        .join("\n");
    }
    if (tag === "OL") {
      let index = 1;
      return [...el.children]
        .map((child) => {
          if (child.tagName !== "LI") return walk(child);
          return `${index++}. ${walk(child).trim()}`;
        })
        .filter(Boolean)
        .join("\n");
    }
    if (tag === "LI") return `${inner.trim()}\n`;
    if (tag === "P" || tag === "DIV") return `${inner}\n`;
    return inner;
  };
  return [...doc.body.childNodes].map(walk).join("").replace(/\n+$/, "");
}

function findBlockAncestor(root: HTMLElement, node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as HTMLElement;
      if (el.tagName === "P" || el.tagName === "DIV") return el;
    }
    current = current.parentNode;
  }
  return null;
}

export function readRichTextAlignFromElement(el: HTMLElement): RichTextAlign | null {
  return readAlignFromElement(el);
}

export function readRichTextSizeFromElement(el: HTMLElement): RichTextSize | null {
  return readSizeFromElement(el);
}

/** Lee la alineación del bloque que contiene el nodo (p/div). */
export function readRichTextAlignFromNode(root: HTMLElement, node: Node | null): RichTextAlign | null {
  const block = findBlockAncestor(root, node);
  return block ? readAlignFromElement(block) : null;
}

/** Lee el tamaño del span o bloque que contiene el nodo. */
export function readRichTextSizeFromNode(root: HTMLElement, node: Node | null): RichTextSize | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as HTMLElement;
      if (el.tagName === "SPAN") {
        const size = readSizeFromElement(el);
        if (size) return size;
      }
      if (el.tagName === "P" || el.tagName === "DIV") {
        return readSizeFromElement(el);
      }
    }
    current = current.parentNode;
  }
  return null;
}

function readAlignFromElement(el: HTMLElement): RichTextAlign | null {
  for (const [key, className] of Object.entries(RICH_ALIGN_CLASSES) as [RichTextAlign, string][]) {
    if (el.classList.contains(className)) return key;
  }
  const textAlign = el.style.textAlign.trim().toLowerCase();
  if (textAlign === "center") return "center";
  if (textAlign === "right" || textAlign === "end") return "right";
  if (textAlign === "left" || textAlign === "start") return "left";
  return null;
}

function readSizeFromElement(el: HTMLElement): RichTextSize | null {
  for (const [key, className] of Object.entries(RICH_SIZE_CLASSES) as [RichTextSize, string][]) {
    if (el.classList.contains(className)) return key;
  }
  const fontSize = el.style.fontSize.trim().toLowerCase();
  if (!fontSize) return null;
  const ptMatch = /^(\d+(?:\.\d+)?)pt$/.exec(fontSize);
  const pxMatch = /^(\d+(?:\.\d+)?)px$/.exec(fontSize);
  const value = ptMatch ? Number(ptMatch[1]) : pxMatch ? Number(pxMatch[1]) * 0.75 : NaN;
  if (!Number.isFinite(value)) return null;
  if (value <= 9) return "sm";
  if (value >= 14) return "lg";
  return "md";
}

function blockClassList(align: RichTextAlign | null, size: RichTextSize | null): string {
  const parts: string[] = [];
  if (align && align !== "left") parts.push(RICH_ALIGN_CLASSES[align]);
  if (size && size !== "md") parts.push(RICH_SIZE_CLASSES[size]);
  return parts.join(" ");
}

function setBlockAlignAndSize(
  block: HTMLElement,
  align: RichTextAlign | null,
  size: RichTextSize | null,
): void {
  const className = blockClassList(align, size);
  if (className) block.className = className;
  else block.removeAttribute("class");
  block.style.removeProperty("font-size");
  block.style.removeProperty("text-align");
}

function deepestBlocks(blocks: HTMLElement[]): HTMLElement[] {
  return blocks.filter((block) => !blocks.some((other) => other !== block && block.contains(other)));
}

function getSelectedBlocks(root: HTMLElement): HTMLElement[] {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return [];

  const range = sel.getRangeAt(0);
  const blocks: HTMLElement[] = [];
  for (const el of root.querySelectorAll("p,div")) {
    const block = el as HTMLElement;
    if (block === root) continue;
    if (range.intersectsNode(block)) blocks.push(block);
  }

  if (blocks.length === 0) {
    const fallback = findBlockAncestor(root, sel.anchorNode);
    if (fallback && fallback !== root) blocks.push(fallback);
  }

  return deepestBlocks(blocks);
}

function ensureSelectedBlocks(root: HTMLElement): HTMLElement[] {
  let blocks = getSelectedBlocks(root);
  if (blocks.length > 0) return blocks;

  document.execCommand("formatBlock", false, "p");
  blocks = getSelectedBlocks(root);
  return blocks;
}

function unwrapSizeSpansIn(root: Node): void {
  const scope =
    root.nodeType === Node.ELEMENT_NODE
      ? (root as HTMLElement)
      : root instanceof DocumentFragment
        ? root
        : null;
  if (!scope) return;

  for (const span of [...scope.querySelectorAll("span")]) {
    const el = span as HTMLElement;
    const hasSize =
      el.classList.contains(RICH_SIZE_CLASSES.sm) ||
      el.classList.contains(RICH_SIZE_CLASSES.md) ||
      el.classList.contains(RICH_SIZE_CLASSES.lg) ||
      Boolean(readSizeFromElement(el));
    if (!hasSize) continue;
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }
}

function selectionCoversWholeBlock(range: Range, block: HTMLElement): boolean {
  const selected = range.toString().replace(/\s+/g, " ").trim();
  const blockText = (block.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!selected || !blockText) return false;
  return selected === blockText;
}

function wrapRangeWithSize(range: Range, size: RichTextSize): void {
  const fragment = range.extractContents();
  unwrapSizeSpansIn(fragment);

  if (size === "md") {
    const endNode = fragment.lastChild;
    range.insertNode(fragment);
    if (endNode) {
      const sel = document.getSelection();
      if (sel) {
        const next = document.createRange();
        next.setStartBefore(fragment.firstChild ?? range.startContainer);
        // reselect inserted content roughly
        try {
          next.selectNodeContents(range.commonAncestorContainer);
        } catch {
          /* ignore */
        }
      }
    }
    return;
  }

  const span = document.createElement("span");
  span.className = RICH_SIZE_CLASSES[size];
  span.appendChild(fragment);
  range.insertNode(span);

  const sel = document.getSelection();
  if (sel) {
    const next = document.createRange();
    next.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(next);
  }
}

/** Aplica tamaño solo al texto seleccionado (span), sin tocar el resto. */
export function applyRichTextSizeToSelection(root: HTMLElement, size: RichTextSize): void {
  root.focus();
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);

  if (range.collapsed) {
    const block = findBlockAncestor(root, sel.anchorNode);
    if (!block) return;
    setBlockAlignAndSize(block, readAlignFromElement(block), size);
    unwrapSizeSpansIn(block);
    return;
  }

  const blocks = getSelectedBlocks(root);
  if (blocks.length === 1 && selectionCoversWholeBlock(range, blocks[0]!)) {
    const block = blocks[0]!;
    setBlockAlignAndSize(block, readAlignFromElement(block), size);
    unwrapSizeSpansIn(block);
    return;
  }

  if (
    blocks.length > 1 &&
    blocks.every((block) => selectionCoversWholeBlock(range, block))
  ) {
    for (const block of blocks) {
      setBlockAlignAndSize(block, readAlignFromElement(block), size);
      unwrapSizeSpansIn(block);
    }
    return;
  }

  wrapRangeWithSize(range, size);
}

/** Aplica alineación a los bloques de la selección sin perder tamaño. */
export function applyRichTextAlignToSelection(root: HTMLElement, align: RichTextAlign): void {
  root.focus();
  const blocks = ensureSelectedBlocks(root);
  for (const block of blocks) {
    const size = readSizeFromElement(block);
    setBlockAlignAndSize(block, align, size);
  }
}

function sanitizeElementAttributes(el: HTMLElement): void {
  if (el.tagName === "P" || el.tagName === "DIV") {
    const align = readAlignFromElement(el);
    const size = readSizeFromElement(el);
    for (const attr of [...el.attributes]) {
      el.removeAttribute(attr.name);
    }
    const className = blockClassList(align, size);
    if (className) el.className = className;
    return;
  }

  if (el.tagName === "SPAN") {
    const size = readSizeFromElement(el);
    for (const attr of [...el.attributes]) {
      el.removeAttribute(attr.name);
    }
    if (size && size !== "md") {
      el.className = RICH_SIZE_CLASSES[size];
    } else {
      el.removeAttribute("class");
    }
    return;
  }

  for (const attr of [...el.attributes]) {
    el.removeAttribute(attr.name);
  }
}

function blockAlignFromElement(el: HTMLElement): RichTextAlign {
  return readAlignFromElement(el) ?? "left";
}

function blockSizeFromElement(el: HTMLElement): RichTextSize {
  return readSizeFromElement(el) ?? "md";
}

function prefixPdfMarkerLines(text: string, align: RichTextAlign, size: RichTextSize): string {
  if (!text) return text;
  const prefix =
    (align !== "left" ? `[[align:${align}]]` : "") + (size !== "md" ? `[[size:${size}]]` : "");
  if (!prefix) return text;
  return text
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}

function stripPdfMarkers(line: string): string {
  return line
    .replace(/\[\[align:(?:left|center|right)\]\]/g, "")
    .replace(/\[\[size:(?:sm|md|lg)\]\]/g, "")
    .replace(/\[\[\/size\]\]/g, "");
}

function mergeOrphanInlineFragments(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    const content = stripPdfMarkers(line);
    const trimmed = content.trim();
    const isOrphan =
      trimmed.length > 0 &&
      trimmed.length <= 6 &&
      /^[.,;:!?¿¡)\]\-–—]+$/.test(trimmed);

    if (isOrphan && out.length > 0) {
      let prevIdx = out.length - 1;
      while (prevIdx >= 0) {
        const prevContent = stripPdfMarkers(out[prevIdx]!).trim();
        if (prevContent) break;
        prevIdx -= 1;
      }
      if (prevIdx >= 0) {
        out[prevIdx] = out[prevIdx]! + trimmed;
        continue;
      }
    }

    out.push(line);
  }

  return out.join("\n");
}

/** Convierte HTML enriquecido a texto plano para PDF (conserva enters, **negrita** y alineación). */
export function richHtmlToPdfText(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (!looksLikeRichHtml(trimmed)) {
    return trimmed.replace(/\r\n/g, "\n");
  }

  const doc = new DOMParser().parseFromString(normalizeRichHtml(trimmed), "text/html");

  const walkInline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName;
    const inner = [...el.childNodes].map(walkInline).join("");
    if (tag === "B" || tag === "STRONG") return inner ? `**${inner}**` : "";
    if (tag === "I" || tag === "EM") return inner;
    if (tag === "U") return inner ? `[[u]]${inner}[[/u]]` : "";
    if (tag === "BR") return "\n";
    if (tag === "UL") {
      return [...el.children]
        .map((child) => {
          if (child.tagName !== "LI") return walkInline(child);
          return `• ${walkBlock(child as HTMLElement).trim()}`;
        })
        .join("\n");
    }
    if (tag === "OL") {
      let index = 1;
      return [...el.children]
        .map((child) => {
          if (child.tagName !== "LI") return walkInline(child);
          return `${index++}. ${walkBlock(child as HTMLElement).trim()}`;
        })
        .join("\n");
    }
    if (tag === "LI") return walkBlock(el);
    if (tag === "P" || tag === "DIV") return walkBlock(el);
    if (tag === "SPAN") {
      const size = readSizeFromElement(el);
      if (size && size !== "md") return `[[size:${size}]]${inner}[[/size]]`;
      return inner;
    }
    return inner;
  };

  const walkBlock = (el: HTMLElement): string => {
    const parts: string[] = [];
    for (const child of el.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child as HTMLElement;
        const tag = childEl.tagName;
        if (tag === "P" || tag === "DIV") {
          parts.push(
            prefixPdfMarkerLines(
              walkBlock(childEl),
              blockAlignFromElement(childEl),
              blockSizeFromElement(childEl),
            ),
          );
          continue;
        }
      }
      parts.push(walkInline(child));
    }
    return parts.join("");
  };

  const blocks = [...doc.body.childNodes].map((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "P" || el.tagName === "DIV") {
        const content = walkBlock(el);
        // <div><br></div> / vacío: no sumar un "\n" extra al join entre bloques
        if (!content.replace(/\n/g, "").trim()) return "";
        return prefixPdfMarkerLines(
          content,
          blockAlignFromElement(el),
          blockSizeFromElement(el),
        );
      }
    }
    return walkInline(node);
  });

  return mergeOrphanInlineFragments(
    blocks
      .join("\n")
      .replace(/\r\n/g, "\n")
      // Un Enter del editor ≈ una línea en blanco, no dos
      .replace(/\n{3,}/g, "\n\n"),
  );
}

export function sanitizeRichHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  function walk(node: Node): void {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const children = [...el.childNodes];
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child as HTMLElement;
        if (!ALLOWED_TAGS.has(childEl.tagName)) {
          while (childEl.firstChild) {
            el.insertBefore(childEl.firstChild, childEl);
          }
          el.removeChild(childEl);
          continue;
        }
        sanitizeElementAttributes(childEl);
      }
      walk(child);
    }
  }

  walk(doc.body);

  for (const el of doc.body.querySelectorAll("p,div,span")) {
    sanitizeElementAttributes(el as HTMLElement);
  }

  for (const span of [...doc.body.querySelectorAll("span")]) {
    if (!(span as HTMLElement).className) {
      const parent = span.parentNode;
      if (!parent) continue;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    }
  }

  // Normalizar div/p vacíos
  let out = doc.body.innerHTML
    .replace(/<div><br><\/div>/gi, "<br>")
    .replace(/<p><br><\/p>/gi, "<br>")
    .trim();

  if (out === "<br>" || out === "<div><br></div>") return "";
  return out;
}

function normalizeFormatTag(tag: string): "b" | "i" | "u" | "br" | "block" | null {
  const t = tag.toLowerCase();
  if (t === "strong" || t === "b") return "b";
  if (t === "em" || t === "i") return "i";
  if (t === "u") return "u";
  if (t === "br") return "br";
  if (t === "div" || t === "p") return "block";
  return null;
}

function serializeInline(nodes: Node[]): string {
  return nodes
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const el = node as HTMLElement;
      if (el.tagName === "SPAN") {
        const size = readSizeFromElement(el);
        const inner = serializeInline([...el.childNodes]);
        if (!inner) return "";
        if (size && size !== "md") {
          return `<span class="${RICH_SIZE_CLASSES[size]}">${inner}</span>`;
        }
        return inner;
      }
      const kind = normalizeFormatTag(el.tagName);
      if (!kind) return serializeInline([...el.childNodes]);
      if (kind === "br") return "<br>";
      if (kind === "block") return serializeBlock(el);
      const inner = serializeInline([...el.childNodes]);
      if (!inner) return "";
      return `<${kind}>${inner}</${kind}>`;
    })
    .join("");
}

function serializeBlock(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const className = blockClassList(readAlignFromElement(el), readSizeFromElement(el));
  const classAttr = className ? ` class="${className}"` : "";
  return `<${tag}${classAttr}>${serializeBlockInner(el)}</${tag}>`;
}

function serializeBlockInner(el: HTMLElement): string {
  const parts: string[] = [];
  let inlineBuffer = "";

  function flushInline() {
    if (inlineBuffer) {
      parts.push(inlineBuffer);
      inlineBuffer = "";
    }
  }

  for (const node of el.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE && normalizeFormatTag((node as HTMLElement).tagName) === "br") {
      flushInline();
      parts.push("");
      continue;
    }
    if (node.nodeType === Node.ELEMENT_NODE && normalizeFormatTag((node as HTMLElement).tagName) === "block") {
      flushInline();
      parts.push(serializeBlock(node as HTMLElement));
      continue;
    }
    inlineBuffer += serializeInline([node]);
  }

  flushInline();
  return parts.join("<br>");
}

/** HTML estable para comparar si el contenido enriquecido cambió de verdad. */
export function canonicalRichHtml(input: string): string {
  const normalized = normalizeRichHtml(input);
  if (!normalized) return "";
  if (
    /<(?:ul|ol)\b/i.test(normalized) ||
    /\bclass="[^"]*\brich-(?:align|size)-/i.test(normalized)
  ) {
    return normalized;
  }

  const doc = new DOMParser().parseFromString(normalized, "text/html");
  const body = doc.body;

  const blocks: string[] = [];
  let inlineBuffer = "";

  function flushInline() {
    if (inlineBuffer) {
      blocks.push(inlineBuffer);
      inlineBuffer = "";
    }
  }

  for (const node of body.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE && normalizeFormatTag((node as HTMLElement).tagName) === "br") {
      flushInline();
      blocks.push("");
      continue;
    }
    if (node.nodeType === Node.ELEMENT_NODE && normalizeFormatTag((node as HTMLElement).tagName) === "block") {
      flushInline();
      blocks.push(serializeBlock(node as HTMLElement));
      continue;
    }
    inlineBuffer += serializeInline([node]);
  }

  flushInline();

  return blocks
    .join("<br>")
    .replace(/(?:<br>){3,}/g, "<br><br>")
    .trim();
}

export function richHtmlEquivalent(a: string, b: string): boolean {
  return canonicalRichHtml(a) === canonicalRichHtml(b);
}

/** Para el editor al abrir un registro existente. */
export function descriptionForEditor(stored: string): string {
  if (!stored.trim()) return "";
  return looksLikeRichHtml(stored) ? sanitizeRichHtml(stored) : plainTextToHtml(stored);
}

/** Resumen de una línea para tablas. */
export function richTextPreview(input: string, maxLen = 80): string {
  const plain = stripRichHtml(input).replace(/\s+/g, " ").trim();
  if (!plain) return "";
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen)}...`;
}
