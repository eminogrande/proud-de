// Allowlist, content types and header rules for /assets/issues/. Shared by the
// Worker and the local server so the two cannot drift.
//
// Paths arrive still percent encoded: an encoded slash is not a separator and
// must not match. The number in the PDF file name has to equal the folder.

export const ISSUES_PREFIX = "/assets/issues/";

const ISSUE_ASSET_PATTERN = /^([0-9]{2})\/(pages\/[0-9]{3}-[sml]\.webp|proud-\1\.pdf)$/;

const SHORT_CACHE_CONTROL = "public, max-age=3600";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function parseIssueAsset(pathname) {
  if (!pathname.startsWith(ISSUES_PREFIX)) {
    return null;
  }

  const relative = pathname.slice(ISSUES_PREFIX.length);
  const match = ISSUE_ASSET_PATTERN.exec(relative);
  if (!match) {
    return null;
  }

  const issue = match[1];
  const pdf = relative.endsWith(".pdf");

  return {
    issue,
    relative,
    key: `issues/${relative}`,
    contentType: pdf ? "application/pdf" : "image/webp",
    pdf,
    filename: pdf ? `proud-${issue}.pdf` : null,
  };
}

// ?v= is the content hash, so only that variant may be immutable.
export function issueCacheControl(hasVersion) {
  return hasVersion ? IMMUTABLE_CACHE_CONTROL : SHORT_CACHE_CONTROL;
}

// Real R2 sets object.range on every get that was handed a range option, even
// for a plain request, so `"range" in object` cannot decide 206. Only a real
// sub-range may answer 206; a whole object goes out as 200.
// A failed precondition comes back without a body: 304 when If-None-Match or
// If-Modified-Since asked, 412 when If-Match is the only condition.
export function issueResponseStatus(object, headers) {
  if (!object.body) {
    if (headers.get("if-match") && !headers.get("if-none-match") && !headers.get("if-modified-since")) {
      return 412;
    }
    return 304;
  }

  const range = object.range;
  if (range && headers.get("range") && (range.offset > 0 || range.length < object.size)) {
    return 206;
  }

  return 200;
}

export function issueContentDisposition(asset, download) {
  return `${download ? "attachment" : "inline"}; filename="${asset.filename}"`;
}
