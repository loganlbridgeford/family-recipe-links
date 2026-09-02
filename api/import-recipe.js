// User-initiated fetch only. Do not crawl, scrape sites in bulk, or follow links.

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FETCH_MS = 8000;
const MAX_HTML_BYTES = 1_500_000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseAllowedUrl(input) {
  let parsed;
  try {
    parsed = new URL(String(input || '').trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return null;
  if (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return null;
  }
  return parsed;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function typeList(node) {
  if (!node || typeof node !== 'object') return [];
  return [].concat(node['@type'] || []).map((t) => String(t).toLowerCase());
}

function isRecipeNode(node) {
  return typeList(node).some((t) => t === 'recipe' || t.endsWith('/recipe'));
}

function findRecipe(node, seen) {
  if (!node || typeof node !== 'object') return null;
  const bag = seen || new Set();
  if (bag.has(node)) return null;
  bag.add(node);
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipe(item, bag);
      if (found) return found;
    }
    return null;
  }
  if (isRecipeNode(node)) return node;
  if (node['@graph']) {
    const found = findRecipe(node['@graph'], bag);
    if (found) return found;
  }
  if (node.mainEntity) {
    const found = findRecipe(node.mainEntity, bag);
    if (found) return found;
  }
  return null;
}

function extractJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    let raw = match[1]
      .trim()
      .replace(/^\s*<!--[\s\S]*?-->/, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      try {
        blocks.push(JSON.parse(raw.replace(/,(\s*[}\]])/g, '$1')));
      } catch {
        /* skip malformed JSON-LD */
      }
    }
  }
  return blocks;
}

function durationToMinutes(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const m = s.match(
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
  );
  if (!m) return null;
  const days = Number(m[3] || 0);
  const hours = Number(m[4] || 0);
  const mins = Number(m[5] || 0);
  const secs = Number(m[6] || 0);
  const total = days * 1440 + hours * 60 + mins + secs / 60;
  return total ? Math.round(total) : null;
}

function firstImage(image) {
  if (!image) return null;
  if (typeof image === 'string') return image.trim() || null;
  if (Array.isArray(image)) return firstImage(image[0]);
  if (typeof image === 'object') return firstImage(image.url || image.contentUrl || null);
  return null;
}

function asStringList(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .map((item) => {
      if (item == null) return '';
      if (typeof item === 'string') return stripHtml(item);
      if (typeof item === 'object') {
        return stripHtml(item.name || item.text || item.item || '');
      }
      return stripHtml(item);
    })
    .filter(Boolean);
}

function asSteps(instr) {
  if (!instr) return [];
  if (typeof instr === 'string') return [stripHtml(instr)].filter(Boolean);
  const arr = Array.isArray(instr) ? instr : [instr];
  const steps = [];
  arr.forEach((node) => {
    if (!node) return;
    if (typeof node === 'string') {
      const text = stripHtml(node);
      if (text) steps.push(text);
      return;
    }
    const types = typeList(node);
    if (types.some((t) => t.includes('howtosection')) && node.itemListElement) {
      asSteps(node.itemListElement).forEach((s) => steps.push(s));
      return;
    }
    const text = node.text || node.name;
    if (Array.isArray(text)) {
      text.forEach((t) => {
        const s = stripHtml(t);
        if (s) steps.push(s);
      });
      return;
    }
    if (text) {
      const s = stripHtml(text);
      if (s) steps.push(s);
    }
  });
  return steps;
}

function servingsFrom(recipe) {
  const y = recipe.recipeYield != null ? recipe.recipeYield : recipe.yield;
  if (y == null) return null;
  if (typeof y === 'number' && Number.isFinite(y)) return y;
  if (Array.isArray(y)) return servingsFrom({ recipeYield: y[0] });
  const n = String(y).match(/(\d+(?:\.\d+)?)/);
  return n ? Number(n[1]) : null;
}

function toResult(recipe, sourceUrl) {
  return {
    ok: true,
    name: stripHtml(recipe.name) || null,
    description: stripHtml(recipe.description) || null,
    image: firstImage(recipe.image),
    ingredients: asStringList(recipe.recipeIngredient),
    steps: asSteps(recipe.recipeInstructions),
    prepMinutes: durationToMinutes(recipe.prepTime),
    cookMinutes: durationToMinutes(recipe.cookTime),
    servings: servingsFrom(recipe),
    sourceUrl
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return json(res, 405, { ok: false, reason: 'method_not_allowed' });
    }

    const body = await readJsonBody(req);
    const parsed = parseAllowedUrl(body.url);
    if (!parsed) {
      return json(res, 200, { ok: false, reason: 'invalid_url', hint: 'Paste ingredients instead.' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_MS);
    let html = '';
    try {
      const upstream = await fetch(parsed.href, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
      const buf = await upstream.arrayBuffer();
      const slice = buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf;
      html = new TextDecoder('utf-8', { fatal: false }).decode(slice);
      if (!upstream.ok && !html) {
        return json(res, 200, { ok: false, reason: 'fetch_failed', hint: 'Paste ingredients instead.' });
      }
    } catch (err) {
      const timedOut = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
      return json(res, 200, {
        ok: false,
        reason: timedOut ? 'timeout' : 'fetch_failed',
        hint: 'Paste ingredients instead.'
      });
    } finally {
      clearTimeout(timer);
    }

    let recipe = null;
    for (const block of extractJsonLd(html)) {
      recipe = findRecipe(block);
      if (recipe) break;
    }

    if (!recipe) {
      return json(res, 200, {
        ok: false,
        reason: 'no_schema',
        hint: 'Paste ingredients instead.'
      });
    }

    return json(res, 200, toResult(recipe, parsed.href));
  } catch (err) {
    console.error(err);
    return json(res, 200, { ok: false, reason: 'error', hint: 'Paste ingredients instead.' });
  }
};
