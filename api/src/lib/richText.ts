/** HTML permitido en cuerpos de mail: negrita, cursiva, subrayado, listas, alineación, tamaño y saltos de línea. */

const ALLOWED_TAGS = new Set(["b", "strong", "i", "em", "u", "br", "p", "div", "ul", "ol", "li", "span"]);

const RICH_ALIGN_CLASSES = {
  left: "rich-align-left",
  center: "rich-align-center",
  right: "rich-align-right",
} as const;

type RichTextAlign = keyof typeof RICH_ALIGN_CLASSES;

const RICH_SIZE_CLASSES = {
  sm: "rich-size-sm",
  md: "rich-size-md",
  lg: "rich-size-lg",
} as const;

type RichTextSize = keyof typeof RICH_SIZE_CLASSES;

const RICH_SIZE_EMAIL_PT: Record<RichTextSize, number> = {
  sm: 8,
  md: 10,
  lg: 13,
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function looksLikeRichHtml(text: string): boolean {
  return /<(?:b|strong|i|em|u|br|p|div|ul|ol|li|span)\b/i.test(text);
}

export function plainTextToHtml(text: string): string {
  if (!text) return "";
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function extractAlignFromAttrs(attrs: string): RichTextAlign | null {
  const classMatch = /\bclass=["']([^"']*)["']/i.exec(attrs);
  if (classMatch) {
    for (const [key, className] of Object.entries(RICH_ALIGN_CLASSES) as [RichTextAlign, string][]) {
      if (new RegExp(`\\b${className}\\b`).test(classMatch[1]!)) return key;
    }
  }

  const styleMatch = /\bstyle=["']([^"']*)["']/i.exec(attrs);
  if (styleMatch) {
    const textAlign = /text-align\s*:\s*(left|center|right|start|end)/i.exec(styleMatch[1]!);
    if (textAlign) {
      const value = textAlign[1]!.toLowerCase();
      if (value === "center") return "center";
      if (value === "right" || value === "end") return "right";
      if (value === "left" || value === "start") return "left";
    }
  }

  return null;
}

function extractSizeFromAttrs(attrs: string): RichTextSize | null {
  const classMatch = /\bclass=["']([^"']*)["']/i.exec(attrs);
  if (classMatch) {
    for (const [key, className] of Object.entries(RICH_SIZE_CLASSES) as [RichTextSize, string][]) {
      if (new RegExp(`\\b${className}\\b`).test(classMatch[1]!)) return key;
    }
  }

  const styleMatch = /\bstyle=["']([^"']*)["']/i.exec(attrs);
  if (styleMatch) {
    const fontSize = /font-size\s*:\s*(\d+(?:\.\d+)?)(pt|px)/i.exec(styleMatch[1]!);
    if (fontSize) {
      const value = Number(fontSize[1]);
      const unit = fontSize[2]!.toLowerCase();
      const pt = unit === "px" ? value * 0.75 : value;
      if (pt <= 9) return "sm";
      if (pt >= 14) return "lg";
      return "md";
    }
  }

  return null;
}

function openBlockTag(tag: "p" | "div", attrs: string): string {
  const align = extractAlignFromAttrs(attrs);
  const size = extractSizeFromAttrs(attrs);
  const classes: string[] = [];
  if (align && align !== "left") classes.push(RICH_ALIGN_CLASSES[align]);
  if (size && size !== "md") classes.push(RICH_SIZE_CLASSES[size]);
  return classes.length ? `<${tag} class="${classes.join(" ")}">` : `<${tag}>`;
}

function openSpanTag(attrs: string): string {
  const size = extractSizeFromAttrs(attrs);
  if (size && size !== "md") return `<span class="${RICH_SIZE_CLASSES[size]}">`;
  return "<span>";
}

export function sanitizeRichHtml(html: string): string {
  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<(p|div)\b([^>]*)>/gi, (_match, tag: string, attrs: string) =>
      openBlockTag(tag.toLowerCase() as "p" | "div", attrs),
    )
    .replace(/<span\b([^>]*)>/gi, (_match, attrs: string) => openSpanTag(attrs))
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tag: string) => {
      const name = tag.toLowerCase();
      if (name === "p" || name === "div" || name === "span") return match;
      if (!ALLOWED_TAGS.has(name)) return "";
      if (match.startsWith("</")) return `</${name}>`;
      if (name === "br") return "<br>";
      return `<${name}>`;
    })
    .replace(/<span>([\s\S]*?)<\/span>/gi, "$1")
    .replace(/<div><br><\/div>/gi, "<br>")
    .replace(/<p><br><\/p>/gi, "<br>")
    .trim();

  if (out === "<br>" || out === "<div><br></div>") return "";
  return out;
}

function richClassesToInlineStyles(html: string): string {
  return html
    .replace(/<(p|div)(?:\s+class="([^"]*)")?/gi, (_match, tag: string, classList = "") => {
      const styles: string[] = [];
      if (/\brich-align-center\b/.test(classList)) styles.push("text-align:center");
      else if (/\brich-align-right\b/.test(classList)) styles.push("text-align:right");
      else if (/\brich-align-left\b/.test(classList)) styles.push("text-align:left");

      if (/\brich-size-sm\b/.test(classList)) styles.push(`font-size:${RICH_SIZE_EMAIL_PT.sm}pt`);
      else if (/\brich-size-lg\b/.test(classList)) styles.push(`font-size:${RICH_SIZE_EMAIL_PT.lg}pt`);
      else if (/\brich-size-md\b/.test(classList)) styles.push(`font-size:${RICH_SIZE_EMAIL_PT.md}pt`);

      return styles.length ? `<${tag} style="${styles.join(";")}"` : `<${tag}`;
    })
    .replace(/<span\s+class="(rich-size-(?:sm|md|lg))"/gi, (_match, className: string) => {
      const size = className.replace("rich-size-", "") as RichTextSize;
      return `<span style="font-size:${RICH_SIZE_EMAIL_PT[size]}pt"`;
    });
}

export function stripRichHtml(input: string): string {
  if (!input.trim()) return "";
  if (!looksLikeRichHtml(input)) return input;
  return input
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

export function emailBodyToHtml(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  if (looksLikeRichHtml(trimmed)) {
    return richClassesToInlineStyles(sanitizeRichHtml(trimmed));
  }
  return plainTextToHtml(trimmed);
}

export function emailBodyToPlainText(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  if (looksLikeRichHtml(trimmed)) return stripRichHtml(trimmed);
  return trimmed;
}
