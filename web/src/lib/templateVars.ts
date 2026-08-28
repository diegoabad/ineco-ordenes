/** Tokens {{variable}} en plantillas de email / presupuesto. */

import { RICH_SIZE_CLASSES, type RichTextSize } from "./richText";

export const TEMPLATE_VAR_TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export const TEMPLATE_VAR_CLASS = "template-var";
export const TEMPLATE_VAR_SELECTED_CLASS = "is-selected";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function normalizeTemplateVarKey(key: string, aliases?: Record<string, string>): string {
  return aliases?.[key] ?? key;
}

export type TokenRange = { start: number; end: number };

export function listTemplateTokens(text: string): TokenRange[] {
  const tokens: TokenRange[] = [];
  const re = new RegExp(TEMPLATE_VAR_TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tokens.push({ start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

export function templateTokenForDelete(
  text: string,
  pos: number,
  key: "Backspace" | "Delete",
): TokenRange | null {
  for (const t of listTemplateTokens(text)) {
    if (pos > t.start && pos < t.end) return t;
    if (key === "Backspace" && pos === t.end) return t;
    if (key === "Delete" && pos === t.start) return t;
  }
  return null;
}

export function expandSelectionToTemplateTokens(
  text: string,
  start: number,
  end: number,
): TokenRange {
  let s = start;
  let e = end;
  for (const t of listTemplateTokens(text)) {
    const overlaps = s < t.end && e > t.start;
    if (overlaps) {
      s = Math.min(s, t.start);
      e = Math.max(e, t.end);
    }
  }
  return { start: s, end: e };
}

const FORMAT_TAGS = new Set(["B", "STRONG", "I", "EM", "U"]);

export function stripTemplateVarDecorations(html: string): string {
  if (!html.trim()) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  hoistFormatOutOfTemplateVars(doc.body);
  doc.querySelectorAll(`.${TEMPLATE_VAR_CLASS}`).forEach((el) => {
    el.replaceWith(doc.createTextNode(el.textContent ?? ""));
  });
  return doc.body.innerHTML;
}

/** Si el formato quedó dentro del chip, lo saca afuera para no perderlo al strip. */
export function hoistFormatOutOfTemplateVars(root: ParentNode): void {
  for (let guard = 0; guard < 40; guard++) {
    let moved = false;
    for (const chip of [...root.querySelectorAll(`.${TEMPLATE_VAR_CLASS}`)]) {
      const el = chip as HTMLElement;
      const onlyChild = el.childNodes.length === 1 ? el.firstChild : null;
      if (
        onlyChild &&
        onlyChild.nodeType === Node.ELEMENT_NODE &&
        FORMAT_TAGS.has((onlyChild as HTMLElement).tagName)
      ) {
        const inner = onlyChild as HTMLElement;
        const token = el.textContent ?? "";
        const doc = el.ownerDocument;
        const wrapper = doc.createElement(inner.tagName.toLowerCase());
        const nextChip = el.cloneNode(false) as HTMLElement;
        nextChip.textContent = token;
        wrapper.appendChild(nextChip);
        el.replaceWith(wrapper);
        moved = true;
        break;
      }

      if ([...el.childNodes].some((n) => n.nodeType === Node.ELEMENT_NODE)) {
        el.textContent = el.textContent ?? "";
      }
    }
    if (!moved) break;
  }
}

/** Amplía la selección para cubrir chips de variable parcialmente elegidos. */
export function expandDomSelectionToTemplateVars(root: HTMLElement): void {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  if (!sel.anchorNode || !root.contains(sel.anchorNode)) return;

  const range = sel.getRangeAt(0).cloneRange();
  let changed = false;

  for (const chip of root.querySelectorAll(`.${TEMPLATE_VAR_CLASS}`)) {
    const touches =
      range.intersectsNode(chip) ||
      chip.contains(range.startContainer) ||
      chip.contains(range.endContainer);
    if (!touches) continue;

    const chipRange = document.createRange();
    chipRange.selectNode(chip);
    if (range.compareBoundaryPoints(Range.START_TO_START, chipRange) > 0) {
      range.setStartBefore(chip);
      changed = true;
    }
    if (range.compareBoundaryPoints(Range.END_TO_END, chipRange) < 0) {
      range.setEndAfter(chip);
      changed = true;
    }
  }

  if (changed) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/** Quita temporalmente contenteditable=false para que execCommand / wraps funcionen. */
export function runWithEditableTemplateVars(root: HTMLElement, fn: () => void): void {
  const chips = [...root.querySelectorAll(`.${TEMPLATE_VAR_CLASS}`)] as HTMLElement[];
  for (const chip of chips) chip.removeAttribute("contenteditable");
  try {
    fn();
  } finally {
    hoistFormatOutOfTemplateVars(root);
    for (const chip of [...root.querySelectorAll(`.${TEMPLATE_VAR_CLASS}`)] as HTMLElement[]) {
      chip.setAttribute("contenteditable", "false");
    }
  }
}

const INLINE_FORMAT: Record<
  "bold" | "italic" | "underline",
  { tags: Set<string>; tagName: string }
> = {
  bold: { tags: new Set(["B", "STRONG"]), tagName: "strong" },
  italic: { tags: new Set(["I", "EM"]), tagName: "em" },
  underline: { tags: new Set(["U"]), tagName: "u" },
};

const BLOCK_TAGS = new Set(["P", "DIV", "LI", "UL", "OL"]);

function findFormatAncestor(chip: HTMLElement, tags: Set<string>): HTMLElement | null {
  let cur = chip.parentElement;
  while (cur) {
    if (tags.has(cur.tagName)) return cur;
    if (BLOCK_TAGS.has(cur.tagName)) break;
    if (cur.isContentEditable && cur.getAttribute("contenteditable") === "true") break;
    cur = cur.parentElement;
  }
  return null;
}

function isSoleElementChild(parent: HTMLElement, child: HTMLElement): boolean {
  const elements = [...parent.childNodes].filter(
    (n) =>
      n.nodeType === Node.ELEMENT_NODE ||
      (n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0),
  );
  return elements.length === 1 && elements[0] === child;
}

/** Saca el chip de un ancestro de formato, partiendo el wrapper si hace falta. */
function extractChipFromFormatAncestor(chip: HTMLElement, ancestor: HTMLElement): void {
  if (isSoleElementChild(ancestor, chip)) {
    ancestor.replaceWith(chip);
    return;
  }

  const parent = ancestor.parentNode;
  if (!parent) return;

  const before = document.createDocumentFragment();
  const after = document.createDocumentFragment();
  let seenChip = false;

  for (const node of [...ancestor.childNodes]) {
    if (node === chip || (node instanceof HTMLElement && node.contains(chip))) {
      seenChip = true;
      continue;
    }
    if (!seenChip) before.appendChild(node);
    else after.appendChild(node);
  }

  if (before.childNodes.length) {
    const beforeWrap = ancestor.cloneNode(false) as HTMLElement;
    beforeWrap.appendChild(before);
    parent.insertBefore(beforeWrap, ancestor);
  }
  parent.insertBefore(chip, ancestor);
  if (after.childNodes.length) {
    const afterWrap = ancestor.cloneNode(false) as HTMLElement;
    afterWrap.appendChild(after);
    parent.insertBefore(afterWrap, ancestor);
  }
  parent.removeChild(ancestor);
}

/** Negrita / cursiva / subrayado sobre un chip, como si fuera texto seleccionado. */
export function toggleInlineFormatOnTemplateVarChip(
  chip: HTMLElement,
  cmd: "bold" | "italic" | "underline",
): void {
  const { tags, tagName } = INLINE_FORMAT[cmd];
  const existing = findFormatAncestor(chip, tags);
  if (existing) {
    extractChipFromFormatAncestor(chip, existing);
    return;
  }
  const wrapper = chip.ownerDocument.createElement(tagName);
  chip.replaceWith(wrapper);
  wrapper.appendChild(chip);
}

function isSizeSpan(el: HTMLElement): boolean {
  return (
    el.tagName === "SPAN" &&
    (el.classList.contains(RICH_SIZE_CLASSES.sm) ||
      el.classList.contains(RICH_SIZE_CLASSES.md) ||
      el.classList.contains(RICH_SIZE_CLASSES.lg))
  );
}

/** Tamaño tipográfico solo sobre el chip. */
export function applySizeToTemplateVarChip(chip: HTMLElement, size: RichTextSize): void {
  let parent = chip.parentElement;
  while (parent && isSizeSpan(parent)) {
    if (isSoleElementChild(parent, chip)) {
      parent.replaceWith(chip);
      parent = chip.parentElement;
      continue;
    }
    extractChipFromFormatAncestor(chip, parent);
    parent = chip.parentElement;
  }

  if (size === "md") return;

  const span = chip.ownerDocument.createElement("span");
  span.className = RICH_SIZE_CLASSES[size];
  chip.replaceWith(span);
  span.appendChild(chip);
}

/** Índice del chip en el editor (para re-seleccionarlo tras redecorar). */
export function indexOfTemplateVarChip(root: HTMLElement, chip: HTMLElement): number {
  return [...root.querySelectorAll(`.${TEMPLATE_VAR_CLASS}`)].indexOf(chip);
}

export function templateVarChipAtIndex(root: HTMLElement, index: number): HTMLElement | null {
  if (index < 0) return null;
  const chip = root.querySelectorAll(`.${TEMPLATE_VAR_CLASS}`)[index];
  return chip instanceof HTMLElement ? chip : null;
}

/** Chip de variable bajo la selección actual (o null). */
export function findSelectedTemplateVar(root: HTMLElement): HTMLElement | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  if (
    !range.collapsed &&
    range.startContainer === range.endContainer &&
    range.startContainer.nodeType === Node.ELEMENT_NODE &&
    range.endOffset - range.startOffset === 1
  ) {
    const child = range.startContainer.childNodes[range.startOffset];
    if (child instanceof HTMLElement && child.classList.contains(TEMPLATE_VAR_CLASS)) {
      return child;
    }
  }

  const fromNode =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer.childNodes[range.startOffset] ?? range.startContainer
      : range.startContainer;
  const startEl =
    fromNode.nodeType === Node.ELEMENT_NODE
      ? (fromNode as HTMLElement)
      : fromNode.parentElement;
  const chip = startEl?.closest(`.${TEMPLATE_VAR_CLASS}`);
  if (chip instanceof HTMLElement && root.contains(chip)) {
    if (range.collapsed || range.intersectsNode(chip)) return chip;
  }

  const touched = [...root.querySelectorAll(`.${TEMPLATE_VAR_CLASS}`)].filter((el) => {
    try {
      return range.intersectsNode(el);
    } catch {
      return false;
    }
  }) as HTMLElement[];
  if (touched.length === 1) return touched[0]!;
  return null;
}

/** Marca visualmente el chip seleccionado (borde); limpia el resto. */
export function syncTemplateVarSelectionHighlight(root: HTMLElement): void {
  const selected = findSelectedTemplateVar(root);
  for (const chip of root.querySelectorAll(`.${TEMPLATE_VAR_CLASS}`)) {
    chip.classList.toggle(TEMPLATE_VAR_SELECTED_CLASS, chip === selected);
  }
}

/** Selecciona un chip entero (para ver/aplicar estilos) y lo marca. */
export function selectTemplateVarChip(root: HTMLElement, chip: HTMLElement): void {
  if (!root.contains(chip)) return;
  root.focus();
  const sel = document.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNode(chip);
  sel.removeAllRanges();
  sel.addRange(range);
  syncTemplateVarSelectionHighlight(root);
}

function wrapTokenMatch(match: string): string {
  return `<span class="${TEMPLATE_VAR_CLASS}" contenteditable="false">${match}</span>`;
}

/** Texto plano → HTML con chips de variable (solo editor). */
export function plainTextToDecoratedHtml(text: string): string {
  if (!text) return "";
  const re = new RegExp(TEMPLATE_VAR_TOKEN_RE.source, "g");
  let lastIndex = 0;
  let out = "";
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(lastIndex, match.index));
    out += wrapTokenMatch(match[0]);
    lastIndex = match.index + match[0].length;
  }
  out += escapeHtml(text.slice(lastIndex));
  return out;
}

/** HTML enriquecido → decora tokens en nodos de texto (solo editor). */
export function decorateTemplateVarsInHtml(html: string): string {
  if (!html.trim()) return "";
  const doc = new DOMParser().parseFromString(stripTemplateVarDecorations(html), "text/html");
  const textNodes: Text[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(`.${TEMPLATE_VAR_CLASS}`)) continue;
    textNodes.push(node as Text);
  }

  const re = new RegExp(TEMPLATE_VAR_TOKEN_RE.source, "g");
  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;

    const fragment = doc.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(doc.createTextNode(text.slice(lastIndex, match.index)));
      }
      const span = doc.createElement("span");
      span.className = TEMPLATE_VAR_CLASS;
      span.setAttribute("contenteditable", "false");
      span.textContent = match[0];
      fragment.appendChild(span);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      fragment.appendChild(doc.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return doc.body.innerHTML;
}

export function decoratedHtmlToPlainText(html: string): string {
  if (!html.trim()) return "";
  return stripTemplateVarDecorations(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n+$/, "");
}

export function getContentEditablePlainText(el: HTMLElement): string {
  const doc = new DOMParser().parseFromString(el.innerHTML, "text/html");
  doc.querySelectorAll(`.${TEMPLATE_VAR_CLASS}`).forEach((span) => {
    span.replaceWith(doc.createTextNode(span.textContent ?? ""));
  });
  return doc.body.textContent?.replace(/\u00a0/g, " ") ?? "";
}

export type ScrollSnapshot = { el: HTMLElement; top: number; left: number };

/** Guarda scroll del editor y contenedores padres antes de reemplazar innerHTML. */
export function captureScrollChain(el: HTMLElement): ScrollSnapshot[] {
  const chain: ScrollSnapshot[] = [];
  let current: HTMLElement | null = el;
  while (current) {
    chain.push({ el: current, top: current.scrollTop, left: current.scrollLeft });
    current = current.parentElement;
  }
  return chain;
}

export function restoreScrollChain(chain: ScrollSnapshot[]): void {
  for (const { el, top, left } of chain) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }
}

export function getSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const preRange = document.createRange();
  preRange.selectNodeContents(root);
  preRange.setEnd(range.startContainer, range.startOffset);
  const start = preRange.toString().length;
  preRange.setEnd(range.endContainer, range.endOffset);
  const end = preRange.toString().length;
  return { start, end };
}

export function setSelectionOffsets(root: HTMLElement, start: number, end: number): void {
  const sel = document.getSelection();
  if (!sel) return;

  let charIndex = 0;
  const range = document.createRange();
  range.setStart(root, 0);
  range.collapse(true);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0;
    if (!startNode && charIndex + len >= start) {
      startNode = node;
      startOffset = start - charIndex;
    }
    if (charIndex + len >= end) {
      endNode = node;
      endOffset = end - charIndex;
      break;
    }
    charIndex += len;
  }

  if (!startNode) {
    startNode = root;
    startOffset = root.childNodes.length;
  }
  if (!endNode) {
    endNode = startNode;
    endOffset = startOffset;
  }

  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function refreshTemplateVarDecorations(el: HTMLElement, plainOrHtml: string, rich = false): void {
  const offsets = getSelectionOffsets(el);
  const scrollChain = captureScrollChain(el);
  el.innerHTML = rich ? decorateTemplateVarsInHtml(plainOrHtml) : plainTextToDecoratedHtml(plainOrHtml);
  restoreScrollChain(scrollChain);
  if (offsets) {
    requestAnimationFrame(() => {
      setSelectionOffsets(el, offsets.start, offsets.end);
      restoreScrollChain(scrollChain);
    });
  }
}
