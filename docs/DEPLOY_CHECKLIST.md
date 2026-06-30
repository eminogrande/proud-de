# deploy checklist

Use this checklist before every public deploy.

## Required local checks

1. Build the site:

```sh
PROUD_PUBLIC_DOMAIN=proud.xn--wp9h.tk npm run build:site
```

2. Deploy with Wrangler:

```sh
npm run cf:deploy
```

3. Run the live audit:

```sh
npm run audit:live -- https://proud.xn--wp9h.tk
```

## Required live checks

1. Agent readiness: `https://isitagentready.com/`
2. PageSpeed mobile and desktop: `https://pagespeed.web.dev/`
3. SEO crawl sanity: `https://www.seobility.net/en/seocheck/`
4. GEO visibility sanity: `https://www.lightsite.ai/generative-engine-optimization-checker`

## Release gate

1. Agent readiness target is 100%.
2. PageSpeed target is 100 for Performance, Accessibility, Best Practices, and SEO.
3. No broken images, PDFs, canonicals, alternates, sitemap, robots, `llms.txt`, MCP, OAuth, or search endpoints.
4. Visible article pages must read like a modern magazine, not a technical archive export.
5. If any score is below target, document the exact failing check before release.

## Secret handling

Never commit or paste Cloudflare API tokens into files. Rotate any token that was exposed in chat, screenshots, logs, or shell history.
