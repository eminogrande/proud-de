function escapeHtmlChar(char) {
  switch (char) {
    case "&":
      return "&amp;";
    case "<":
      return "&lt;";
    case ">":
      return "&gt;";
    case '"':
      return "&quot;";
    default:
      return "&#39;";
  }
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, escapeHtmlChar);
}

function sanitizeHref(rawHref) {
  const href = String(rawHref ?? "").trim();
  if (!href) {
    return null;
  }

  if (/^(https?:\/\/|mailto:|\/|#)/i.test(href)) {
    return href;
  }

  if (/^www\./i.test(href) || /^(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:[/?#][^\s]*)?$/i.test(href)) {
    return `https://${href}`;
  }

  return null;
}

function renderAnchor(label, rawHref) {
  const href = sanitizeHref(rawHref);
  if (!href) {
    return escapeHtml(label);
  }

  const rel = /^https?:\/\//i.test(href) ? ' rel="noreferrer"' : "";
  return `<a href="${escapeHtml(href)}"${rel}>${escapeHtml(label)}</a>`;
}

function renderImage(alt, rawHref) {
  const href = sanitizeHref(rawHref);
  if (!href) {
    return escapeHtml(alt);
  }

  return `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}">`;
}

function renderTextWithAutoLinks(text) {
  const value = String(text ?? "");
  const parts = [];
  const pattern =
    /\b((?:https?:\/\/|www\.)[^\s<]+|(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/[^\s<]*)?)/gi;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(value)) !== null) {
    const matched = match[0];
    const offset = match.index;
    parts.push(escapeHtml(value.slice(lastIndex, offset)));

    let linkText = matched;
    let trailing = "";
    while (/[),.;:!?]$/.test(linkText)) {
      trailing = linkText.slice(-1) + trailing;
      linkText = linkText.slice(0, -1);
    }

    parts.push(renderAnchor(linkText, linkText));
    parts.push(escapeHtml(trailing));
    lastIndex = offset + matched.length;
  }

  parts.push(escapeHtml(value.slice(lastIndex)));
  return parts.join("");
}

export function renderInlineMarkdown(text) {
  const placeholders = [];
  const pushPlaceholder = (value) => {
    const token = `@@HTML_PLACEHOLDER_${placeholders.length}@@`;
    placeholders.push({ token, value });
    return token;
  };

  let rendered = String(text ?? "");
  rendered = rendered.replace(/`([^`]+)`/g, (_match, code) => pushPlaceholder(`<code>${escapeHtml(code)}</code>`));
  rendered = rendered.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, href) => pushPlaceholder(renderImage(alt, href)));
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => pushPlaceholder(renderAnchor(label, href)));
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, (_match, value) => pushPlaceholder(`<strong>${renderTextWithAutoLinks(value)}</strong>`));
  rendered = renderTextWithAutoLinks(rendered);

  for (const placeholder of placeholders) {
    rendered = rendered.replaceAll(placeholder.token, placeholder.value);
  }

  return rendered;
}

export function renderMarkdownToHtml(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let listType = null;

  function flushParagraph() {
    if (paragraph.length === 0) {
      return;
    }

    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!listType) {
      return;
    }

    html.push(listType === "ol" ? "</ol>" : "</ul>");
    listType = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    if (trimmed.startsWith("# ")) {
      flushParagraph();
      closeList();
      html.push(`<h1>${renderInlineMarkdown(trimmed.slice(2))}</h1>`);
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph();
      closeList();
      html.push(`<h2>${renderInlineMarkdown(trimmed.slice(3))}</h2>`);
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushParagraph();
      closeList();
      html.push(`<h3>${renderInlineMarkdown(trimmed.slice(4))}</h3>`);
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${renderInlineMarkdown(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${renderInlineMarkdown(trimmed.slice(2))}</li>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${renderInlineMarkdown(trimmed.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();

  return html.join("\n");
}
