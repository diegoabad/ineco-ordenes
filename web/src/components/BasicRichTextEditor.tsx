import {
  useEffect,
  useRef,
  useCallback,
  useState,
  type ClipboardEvent,
  type FocusEvent,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import {
  applyRichTextAlignToSelection,
  applyRichTextSizeToSelection,
  descriptionForEditor,
  normalizeRichHtml,
  readRichTextAlignFromNode,
  readRichTextSizeFromNode,
  type RichTextAlign,
  type RichTextSize,
} from "../lib/richText";
import {
  applySizeToTemplateVarChip,
  captureScrollChain,
  decorateTemplateVarsInHtml,
  expandDomSelectionToTemplateVars,
  findSelectedTemplateVar,
  getSelectionOffsets,
  indexOfTemplateVarChip,
  restoreScrollChain,
  runWithEditableTemplateVars,
  selectTemplateVarChip,
  setSelectionOffsets,
  stripTemplateVarDecorations,
  syncTemplateVarSelectionHighlight,
  templateVarChipAtIndex,
  toggleInlineFormatOnTemplateVarChip,
  TEMPLATE_VAR_CLASS,
  TEMPLATE_VAR_SELECTED_CLASS,
} from "../lib/templateVars";

type FormatCmd = "bold" | "italic" | "underline";
type ListCmd = "insertUnorderedList" | "insertOrderedList";

type FormatToolbarState = Record<FormatCmd, boolean>;
type ListToolbarState = Record<"bullets" | "ordered", boolean>;

const INACTIVE_FORMAT: FormatToolbarState = {
  bold: false,
  italic: false,
  underline: false,
};

const INACTIVE_LIST: ListToolbarState = {
  bullets: false,
  ordered: false,
};

const BOLD_TAGS = new Set(["B", "STRONG"]);
const ITALIC_TAGS = new Set(["I", "EM"]);
const UNDERLINE_TAGS = new Set(["U"]);

/** Detecta formato por etiquetas DOM (no queryCommandState: el chip tiene font-weight 600 y marca negrita a falso). */
function nodeHasFormatTag(node: Node | null, tags: Set<string>, stopAt: HTMLElement): boolean {
  let cur: Node | null = node;
  while (cur && cur !== stopAt) {
    if (cur.nodeType === Node.ELEMENT_NODE && tags.has((cur as HTMLElement).tagName)) {
      return true;
    }
    cur = cur.parentNode;
  }
  return false;
}

function selectionHasFormatTag(editor: HTMLElement, tags: Set<string>): boolean {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;

  if (nodeHasFormatTag(range.startContainer, tags, editor)) return true;
  if (nodeHasFormatTag(range.endContainer, tags, editor)) return true;

  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const parent = range.startContainer;
    const from = range.startOffset;
    const to =
      range.endContainer === range.startContainer ? range.endOffset : range.startOffset + 1;
    for (let i = from; i < to; i++) {
      const child = parent.childNodes[i];
      if (!child) continue;
      if (child.nodeType === Node.ELEMENT_NODE && tags.has((child as HTMLElement).tagName)) {
        return true;
      }
      if (nodeHasFormatTag(child, tags, editor)) return true;
    }
  }

  return false;
}

function readFormatToolbarState(editor: HTMLDivElement | null): FormatToolbarState {
  if (!editor) return { ...INACTIVE_FORMAT };
  return {
    bold: selectionHasFormatTag(editor, BOLD_TAGS),
    italic: selectionHasFormatTag(editor, ITALIC_TAGS),
    underline: selectionHasFormatTag(editor, UNDERLINE_TAGS),
  };
}

function readFormatMixedState(editor: HTMLDivElement | null): FormatToolbarState {
  if (!editor) return { ...INACTIVE_FORMAT };
  // Indeterm solo tiene sentido con queryCommand; con chips suele mentir en bold → no marcar mixed.
  return { ...INACTIVE_FORMAT };
}

function readListToolbarState(): ListToolbarState {
  return {
    bullets: document.queryCommandState("insertUnorderedList"),
    ordered: document.queryCommandState("insertOrderedList"),
  };
}

function readAlignToolbarState(editor: HTMLDivElement | null): RichTextAlign | null {
  if (!editor) return null;
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  return readRichTextAlignFromNode(editor, sel.anchorNode);
}

function readSizeToolbarState(editor: HTMLDivElement | null): RichTextSize {
  if (!editor) return "md";
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return "md";
  return readRichTextSizeFromNode(editor, sel.anchorNode) ?? "md";
}

function alignBtnClass(active: boolean): string {
  return `rich-text-editor__btn${active ? " is-active" : ""}`;
}

function formatBtnClass(active: boolean): string {
  return alignBtnClass(active);
}

function formatBtnAria(active: boolean, mixed: boolean): boolean | "mixed" {
  if (mixed) return "mixed";
  return active;
}

function isSelectionInsideEditor(editor: HTMLDivElement | null): boolean {
  if (!editor) return false;
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  return Boolean(node && editor.contains(node));
}

type Props = {
  id?: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  /** Cambiar al abrir otro registro para resetear el contenido. */
  resetKey?: string;
  onAreaFocus?: () => void;
  onAreaMount?: (el: HTMLDivElement | null) => void;
  /** Resalta {{variables}} en el editor; no se guardan en el HTML. */
  highlightTemplateVars?: boolean;
};

export function BasicRichTextEditor({
  id,
  value,
  onChange,
  placeholder = "Escribí la descripción…",
  className,
  resetKey,
  onAreaFocus,
  onAreaMount,
  highlightTemplateVars = false,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);
  const [formatActive, setFormatActive] = useState<FormatToolbarState>(INACTIVE_FORMAT);
  const [formatMixed, setFormatMixed] = useState<FormatToolbarState>(INACTIVE_FORMAT);
  const [listActive, setListActive] = useState<ListToolbarState>(INACTIVE_LIST);
  const [alignActive, setAlignActive] = useState<RichTextAlign | null>(null);
  const [sizeActive, setSizeActive] = useState<RichTextSize>("md");

  const refreshToolbar = useCallback(() => {
    const editor = editorRef.current;
    if (!isSelectionInsideEditor(editor)) return;
    if (highlightTemplateVars && editor) {
      syncTemplateVarSelectionHighlight(editor);
    }
    setFormatActive(readFormatToolbarState(editor));
    setFormatMixed(readFormatMixedState(editor));
    setListActive(readListToolbarState());
    setAlignActive(readAlignToolbarState(editor));
    setSizeActive(readSizeToolbarState(editor));
  }, [highlightTemplateVars]);

  const setEditorRef = useCallback(
    (el: HTMLDivElement | null) => {
      editorRef.current = el;
      onAreaMount?.(el);
    },
    [onAreaMount],
  );

  const applyEditorHtml = useCallback(
    (html: string, restoreCaret = false) => {
      const el = editorRef.current;
      if (!el) return;
      const offsets = restoreCaret ? getSelectionOffsets(el) : null;
      const scrollChain = captureScrollChain(el);
      const forEditor = highlightTemplateVars
        ? decorateTemplateVarsInHtml(descriptionForEditor(html))
        : descriptionForEditor(html);
      el.innerHTML = forEditor;
      restoreScrollChain(scrollChain);
      lastEmitted.current = normalizeRichHtml(
        highlightTemplateVars ? stripTemplateVarDecorations(forEditor) : forEditor,
      );
      if (offsets) {
        requestAnimationFrame(() => {
          setSelectionOffsets(el, offsets.start, offsets.end);
          restoreScrollChain(scrollChain);
        });
      }
    },
    [highlightTemplateVars],
  );

  const syncToState = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const raw = highlightTemplateVars ? stripTemplateVarDecorations(el.innerHTML) : el.innerHTML;
    const html = normalizeRichHtml(raw);
    lastEmitted.current = html;
    onChange(html);
    if (highlightTemplateVars) {
      const forEditor = decorateTemplateVarsInHtml(descriptionForEditor(html));
      if (el.innerHTML !== forEditor) {
        applyEditorHtml(html, true);
      }
    }
  }, [onChange, highlightTemplateVars, applyEditorHtml]);

  useEffect(() => {
    applyEditorHtml(value, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset explícito al cambiar de registro
  }, [resetKey]);

  useEffect(() => {
    const el = editorRef.current;
    if (el && document.activeElement === el) return;
    const normalized = normalizeRichHtml(value);
    if (normalized !== lastEmitted.current) {
      applyEditorHtml(value, false);
    }
  }, [value, applyEditorHtml]);

  useEffect(() => {
    document.addEventListener("selectionchange", refreshToolbar);
    return () => document.removeEventListener("selectionchange", refreshToolbar);
  }, [refreshToolbar]);

  function reselectChipAfterSync(editor: HTMLDivElement, chipIndex: number) {
    requestAnimationFrame(() => {
      const chip = templateVarChipAtIndex(editor, chipIndex);
      if (chip) selectTemplateVarChip(editor, chip);
      refreshToolbar();
    });
  }

  function runFormatOnSelection(fn: () => void) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    const selectedChip =
      highlightTemplateVars ? findSelectedTemplateVar(el) : null;
    const chipIndex = selectedChip ? indexOfTemplateVarChip(el, selectedChip) : -1;

    if (selectedChip && highlightTemplateVars) {
      selectTemplateVarChip(el, selectedChip);
      runWithEditableTemplateVars(el, fn);
    } else if (highlightTemplateVars) {
      expandDomSelectionToTemplateVars(el);
      runWithEditableTemplateVars(el, fn);
    } else {
      fn();
    }

    syncToState();
    if (chipIndex >= 0) reselectChipAfterSync(el, chipIndex);
    else requestAnimationFrame(refreshToolbar);
  }

  function exec(cmd: FormatCmd) {
    const el = editorRef.current;
    const chip = el && highlightTemplateVars ? findSelectedTemplateVar(el) : null;
    if (chip && el) {
      const chipIndex = indexOfTemplateVarChip(el, chip);
      el.focus();
      toggleInlineFormatOnTemplateVarChip(chip, cmd);
      syncToState();
      reselectChipAfterSync(el, chipIndex);
      return;
    }
    runFormatOnSelection(() => {
      document.execCommand(cmd, false);
    });
  }

  function execList(cmd: ListCmd) {
    runFormatOnSelection(() => {
      document.execCommand(cmd, false);
    });
  }

  function execAlign(align: RichTextAlign) {
    runFormatOnSelection(() => {
      const editor = editorRef.current;
      if (!editor) return;
      applyRichTextAlignToSelection(editor, align);
    });
  }

  function execSize(size: RichTextSize) {
    const el = editorRef.current;
    const chip = el && highlightTemplateVars ? findSelectedTemplateVar(el) : null;
    if (chip && el) {
      const chipIndex = indexOfTemplateVarChip(el, chip);
      el.focus();
      applySizeToTemplateVarChip(chip, size);
      syncToState();
      reselectChipAfterSync(el, chipIndex);
      return;
    }
    runFormatOnSelection(() => {
      const editor = editorRef.current;
      if (!editor) return;
      applyRichTextSizeToSelection(editor, size);
    });
  }

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    syncToState();
    requestAnimationFrame(refreshToolbar);
  }

  function handleFocus(_e: FocusEvent<HTMLDivElement>) {
    onAreaFocus?.();
    refreshToolbar();
  }

  function handleBlur(_e: FocusEvent<HTMLDivElement>) {
    syncToState();
    const editor = editorRef.current;
    if (editor && highlightTemplateVars) {
      for (const chip of editor.querySelectorAll(`.${TEMPLATE_VAR_CLASS}`)) {
        chip.classList.remove(TEMPLATE_VAR_SELECTED_CLASS);
      }
    }
    setFormatActive(INACTIVE_FORMAT);
    setFormatMixed(INACTIVE_FORMAT);
    setListActive(INACTIVE_LIST);
    setAlignActive(null);
    setSizeActive("md");
  }

  function handleEditorInput() {
    syncToState();
    refreshToolbar();
  }

  function handleEditorKeyUp(_e: KeyboardEvent<HTMLDivElement>) {
    refreshToolbar();
  }

  function handleEditorMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (!highlightTemplateVars) return;
    const editor = editorRef.current;
    if (!editor) return;
    const target = e.target as HTMLElement | null;
    const chip = target?.closest?.(`.${TEMPLATE_VAR_CLASS}`);
    if (!(chip instanceof HTMLElement) || !editor.contains(chip)) return;
    e.preventDefault();
    selectTemplateVarChip(editor, chip);
    refreshToolbar();
  }

  function handleEditorMouseUp(_e: MouseEvent<HTMLDivElement>) {
    refreshToolbar();
  }

  const empty = !value.trim();

  return (
    <div className={`rich-text-editor${className ? ` ${className}` : ""}`}>
      <div className="rich-text-editor__toolbar" role="toolbar" aria-label="Formato de texto">
        <button
          type="button"
          className={formatBtnClass(formatActive.bold)}
          title="Negrita"
          aria-pressed={formatBtnAria(formatActive.bold, formatMixed.bold)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("bold")}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className={formatBtnClass(formatActive.italic)}
          title="Cursiva"
          aria-pressed={formatBtnAria(formatActive.italic, formatMixed.italic)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("italic")}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className={formatBtnClass(formatActive.underline)}
          title="Subrayado"
          aria-pressed={formatBtnAria(formatActive.underline, formatMixed.underline)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("underline")}
        >
          <u>U</u>
        </button>
        <span className="rich-text-editor__sep" aria-hidden />
        <button
          type="button"
          className={formatBtnClass(listActive.bullets)}
          title="Lista con viñetas"
          aria-pressed={listActive.bullets}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execList("insertUnorderedList")}
        >
          •
        </button>
        <button
          type="button"
          className={formatBtnClass(listActive.ordered)}
          title="Lista numerada"
          aria-pressed={listActive.ordered}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execList("insertOrderedList")}
        >
          1.
        </button>
        <span className="rich-text-editor__sep" aria-hidden />
        <button
          type="button"
          className={alignBtnClass(alignActive === "left" || alignActive === null)}
          title="Alinear a la izquierda"
          aria-pressed={alignActive === "left" || alignActive === null}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execAlign("left")}
        >
          <span className="rich-text-editor__align-icon rich-text-editor__align-icon--left" aria-hidden />
        </button>
        <button
          type="button"
          className={alignBtnClass(alignActive === "center")}
          title="Centrar"
          aria-pressed={alignActive === "center"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execAlign("center")}
        >
          <span className="rich-text-editor__align-icon rich-text-editor__align-icon--center" aria-hidden />
        </button>
        <button
          type="button"
          className={alignBtnClass(alignActive === "right")}
          title="Alinear a la derecha"
          aria-pressed={alignActive === "right"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execAlign("right")}
        >
          <span className="rich-text-editor__align-icon rich-text-editor__align-icon--right" aria-hidden />
        </button>
        <span className="rich-text-editor__sep" aria-hidden />
        <button
          type="button"
          className={alignBtnClass(sizeActive === "sm")}
          title="Tamaño pequeño"
          aria-pressed={sizeActive === "sm"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execSize("sm")}
        >
          <span className="rich-text-editor__size-label rich-text-editor__size-label--sm">A</span>
        </button>
        <button
          type="button"
          className={alignBtnClass(sizeActive === "md")}
          title="Tamaño medio"
          aria-pressed={sizeActive === "md"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execSize("md")}
        >
          <span className="rich-text-editor__size-label rich-text-editor__size-label--md">A</span>
        </button>
        <button
          type="button"
          className={alignBtnClass(sizeActive === "lg")}
          title="Tamaño grande"
          aria-pressed={sizeActive === "lg"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => execSize("lg")}
        >
          <span className="rich-text-editor__size-label rich-text-editor__size-label--lg">A</span>
        </button>
      </div>
      <div
        id={id}
        ref={setEditorRef}
        className={`rich-text-editor__area${empty ? " is-empty" : ""}`}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        data-placeholder={placeholder}
        onInput={handleEditorInput}
        onPaste={handlePaste}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyUp={handleEditorKeyUp}
        onMouseDown={handleEditorMouseDown}
        onMouseUp={handleEditorMouseUp}
        suppressContentEditableWarning
      />
    </div>
  );
}
