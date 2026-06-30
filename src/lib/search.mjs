function normalizeText(value) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/[^a-z0-9äöüß]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function countMatches(haystack, needle) {
  if (!haystack || !needle) {
    return 0;
  }

  let count = 0;
  let offset = 0;

  while (true) {
    const index = haystack.indexOf(needle, offset);
    if (index === -1) {
      return count;
    }

    count += 1;
    offset = index + needle.length;
  }
}

function buildSnippet(text, queryTokens) {
  const normalized = normalizeText(text);
  let bestIndex = -1;

  for (const token of queryTokens) {
    const index = normalized.indexOf(token);
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
    }
  }

  if (bestIndex === -1) {
    return (text ?? "").slice(0, 260).trim();
  }

  const start = Math.max(0, bestIndex - 80);
  const end = Math.min(text.length, bestIndex + 180);
  const snippet = text.slice(start, end).trim();
  return start > 0 ? `…${snippet}` : snippet;
}

export function formatSearchResults(library, query, options = {}) {
  const limit = options.limit ?? 10;
  return searchArticles(library, query, { limit }).map((result) => ({
    score: result.score,
    slug: result.article.slug,
    title: result.article.title,
    magazineTitle: result.article.magazineTitle,
    summary: result.article.summary,
    snippet: result.snippet,
    pages: result.article.pages,
  }));
}

export function searchArticles(library, query, options = {}) {
  const limit = options.limit ?? 10;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return [];
  }

  const scored = [];

  for (const article of library.articles) {
    const title = normalizeText(article.title);
    const summary = normalizeText(article.summary);
    const authors = normalizeText((article.authors ?? []).join(" "));
    const tags = normalizeText((article.tags ?? []).join(" "));
    const body = normalizeText(article.bodyText);
    let score = 0;

    for (const token of queryTokens) {
      score += countMatches(title, token) * 8;
      score += countMatches(summary, token) * 5;
      score += countMatches(authors, token) * 4;
      score += countMatches(tags, token) * 3;
      score += countMatches(body, token);
    }

    if (score > 0) {
      scored.push({
        score,
        article,
        snippet: buildSnippet(article.bodyText ?? article.summary ?? "", queryTokens),
      });
    }
  }

  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, limit);
}
