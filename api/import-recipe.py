# User-initiated fetch only. Do not crawl, scrape sites in bulk, or follow links.
# Python urllib is used because Allrecipes (Akamai) blocks Node's TLS fingerprint.

from http.server import BaseHTTPRequestHandler
from html import unescape
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import ipaddress
import json
import re
import socket

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
FETCH_SEC = 8
MAX_HTML_BYTES = 1_500_000


def json_bytes(body):
    return json.dumps(body, ensure_ascii=False).encode("utf-8")


def parse_allowed_url(value):
    try:
        parsed = urlparse(str(value or "").strip())
    except Exception:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.hostname or "").strip("[]").lower()
    if not host or host == "localhost" or host.endswith(".localhost") or host == "::1":
        return None
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            return None
    except ValueError:
        pass
    if re.match(r"^(127\.|10\.|192\.168\.|169\.254\.)", host):
        return None
    if re.match(r"^172\.(1[6-9]|2\d|3[0-1])\.", host):
        return None
    if not parsed.netloc:
        return None
    return parsed.geturl()


def strip_html(value):
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def type_list(node):
    if not isinstance(node, dict):
        return []
    raw = node.get("@type") or []
    if not isinstance(raw, list):
        raw = [raw]
    return [str(t).lower() for t in raw]


def is_recipe_node(node):
    return any(t == "recipe" or t.endswith("/recipe") for t in type_list(node))


def find_recipe(node, seen=None):
    if not isinstance(node, (dict, list)):
        return None
    if seen is None:
        seen = set()
    oid = id(node)
    if oid in seen:
        return None
    seen.add(oid)
    if isinstance(node, list):
        for item in node:
            found = find_recipe(item, seen)
            if found:
                return found
        return None
    if is_recipe_node(node):
        return node
    for value in node.values():
        if isinstance(value, (dict, list)):
            found = find_recipe(value, seen)
            if found:
                return found
    return None


def extract_json_ld(html):
    blocks = []
    for match in re.finditer(
        r'<script[^>]*type\s*=\s*["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>',
        html,
        re.I,
    ):
        raw = match.group(1).strip()
        raw = re.sub(r"^\s*<!--[\s\S]*?-->", "", raw)
        raw = re.sub(r"<!--[\s\S]*?-->", "", raw)
        raw = re.sub(r"<!\[CDATA\[([\s\S]*?)\]\]>", r"\1", raw).strip()
        if not raw:
            continue
        try:
            blocks.append(json.loads(raw))
        except json.JSONDecodeError:
            try:
                blocks.append(json.loads(re.sub(r",(\s*[}\]])", r"\1", raw)))
            except json.JSONDecodeError:
                pass
    return blocks


def duration_to_minutes(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return round(value)
    s = str(value).strip()
    if re.match(r"^\d+(\.\d+)?$", s):
        return round(float(s))
    m = re.match(
        r"^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$",
        s,
        re.I,
    )
    if not m:
        return None
    days = int(m.group(3) or 0)
    hours = int(m.group(4) or 0)
    mins = int(m.group(5) or 0)
    secs = float(m.group(6) or 0)
    total = days * 1440 + hours * 60 + mins + secs / 60
    return round(total) if total else None


def first_image(image):
    if not image:
        return None
    if isinstance(image, str):
        return image.strip() or None
    if isinstance(image, list):
        return first_image(image[0] if image else None)
    if isinstance(image, dict):
        return first_image(image.get("url") or image.get("contentUrl"))
    return None


def as_string_list(value):
    if not value:
        return []
    arr = value if isinstance(value, list) else [value]
    out = []
    for item in arr:
        if item is None:
            continue
        if isinstance(item, str):
            text = strip_html(item)
        elif isinstance(item, dict):
            text = strip_html(item.get("name") or item.get("text") or item.get("item") or "")
        else:
            text = strip_html(item)
        if text:
            out.append(text)
    return out


def as_steps(instr):
    if not instr:
        return []
    if isinstance(instr, str):
        text = strip_html(instr)
        return [text] if text else []
    arr = instr if isinstance(instr, list) else [instr]
    steps = []
    for node in arr:
        if not node:
            continue
        if isinstance(node, str):
            text = strip_html(node)
            if text:
                steps.append(text)
            continue
        if not isinstance(node, dict):
            continue
        types = type_list(node)
        if any("howtosection" in t for t in types) and node.get("itemListElement"):
            steps.extend(as_steps(node.get("itemListElement")))
            continue
        text = node.get("text") or node.get("name")
        if isinstance(text, list):
            for t in text:
                s = strip_html(t)
                if s:
                    steps.append(s)
        elif text:
            s = strip_html(text)
            if s:
                steps.append(s)
    return steps


def servings_from(recipe):
    y = recipe.get("recipeYield")
    if y is None:
        y = recipe.get("yield")
    if y is None:
        return None
    if isinstance(y, (int, float)):
        return y
    if isinstance(y, list):
        return servings_from({"recipeYield": y[0] if y else None})
    m = re.search(r"(\d+(?:\.\d+)?)", str(y))
    return float(m.group(1)) if m else None


def to_result(recipe, source_url):
    return {
        "ok": True,
        "name": strip_html(recipe.get("name")) or None,
        "description": strip_html(recipe.get("description")) or None,
        "image": first_image(recipe.get("image")),
        "ingredients": as_string_list(recipe.get("recipeIngredient")),
        "steps": as_steps(recipe.get("recipeInstructions")),
        "prepMinutes": duration_to_minutes(recipe.get("prepTime")),
        "cookMinutes": duration_to_minutes(recipe.get("cookTime")),
        "servings": servings_from(recipe),
        "sourceUrl": source_url,
    }


def extract_microdata(html):
    ings = []
    for match in re.finditer(
        r'itemprop=["\']recipeIngredient["\'][^>]*>([\s\S]*?)</(?:li|span|p|div|td)>',
        html,
        re.I,
    ):
        text = strip_html(match.group(1))
        if text:
            ings.append(text)
    if not ings:
        for match in re.finditer(
            r'itemprop=["\']recipeIngredient["\'][^>]*content=["\']([^"\']+)["\']',
            html,
            re.I,
        ):
            text = strip_html(match.group(1))
            if text:
                ings.append(text)
    if not ings:
        return None
    name = None
    og = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
    if og:
        name = strip_html(og.group(1))
    if not name:
        t = re.search(r"<title>([\s\S]*?)</title>", html, re.I)
        name = strip_html(t.group(1)) if t else None
    return {
        "name": name,
        "description": None,
        "recipeIngredient": ings,
        "recipeInstructions": [],
        "prepTime": None,
        "cookTime": None,
        "recipeYield": None,
        "image": None,
    }


def fetch_html(url):
    req = Request(
        url,
        headers={
            "User-Agent": BROWSER_UA,
            "Accept": "text/html",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urlopen(req, timeout=FETCH_SEC) as resp:
            data = resp.read(MAX_HTML_BYTES)
            return data.decode("utf-8", "replace")
    except HTTPError as err:
        body = err.read(MAX_HTML_BYTES)
        return body.decode("utf-8", "replace") if body else ""
    except (URLError, TimeoutError, socket.timeout):
        raise


def parse_recipe_html(html, source_url):
    recipe = None
    for block in extract_json_ld(html):
        recipe = find_recipe(block)
        if recipe:
            break
    if not recipe:
        recipe = extract_microdata(html)
    if not recipe:
        return None
    result = to_result(recipe, source_url)
    if not result.get("ingredients"):
        return None
    return result


def import_from_url(url):
    allowed = parse_allowed_url(url)
    if not allowed:
        return 200, {"ok": False, "reason": "invalid_url", "hint": "Paste ingredients instead."}
    try:
        html = fetch_html(allowed)
    except (URLError, TimeoutError, socket.timeout) as err:
        timed_out = isinstance(err, (TimeoutError, socket.timeout)) or "timed out" in str(err).lower()
        return 200, {
            "ok": False,
            "reason": "timeout" if timed_out else "fetch_failed",
            "hint": "Paste ingredients instead.",
        }
    if not html:
        return 200, {"ok": False, "reason": "fetch_failed", "hint": "Paste ingredients instead."}
    result = parse_recipe_html(html, allowed)
    if not result:
        host = (urlparse(allowed).hostname or "").lower()
        hint = "Paste ingredients instead."
        if "allrecipes.com" in host:
            hint = "Allrecipes blocked the automatic pull. Paste ingredients (one per line)."
        return 200, {"ok": False, "reason": "no_schema", "hint": hint}
    return 200, result


class handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _send(self, status, body):
        payload = json_bytes(body)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self._send(405, {"ok": False, "reason": "method_not_allowed"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                body = {}
            if not isinstance(body, dict):
                body = {}
            status, result = import_from_url(body.get("url"))
            self._send(status, result)
        except Exception as err:
            print(err)
            self._send(200, {"ok": False, "reason": "error", "hint": "Paste ingredients instead."})


if __name__ == "__main__":
    import sys

    target = sys.argv[1] if len(sys.argv) > 1 else "https://www.allrecipes.com/recipe/223042/chicken-parmesan/"
    code, payload = import_from_url(target)
    print(code, json.dumps({k: (len(v) if k in ("ingredients", "steps") else v) for k, v in payload.items()}, indent=2))
    if payload.get("ingredients"):
        print("first", payload["ingredients"][0])
