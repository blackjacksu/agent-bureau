import { createServer, type Server } from "node:http";

export interface MiniSite { server: Server; baseUrl: string; domain: string; requests: string[]; close(): Promise<void> }

const home = `<!doctype html><html><head><title>Mini Auto</title></head><body>
<h1>Mini Auto Parts</h1>
<form action="/search" method="get" data-testid="search-form"><input name="q" type="search"><button>Search</button></form>
<a href="/category/brakes" data-testid="cat-brakes">Brakes</a>
<a href="/vehicle" aria-label="Shop by vehicle">Shop by vehicle</a>
<a href="/private/secret">Private</a>
</body></html>`;
const search = `<!doctype html><html><head><title>Search</title></head><body><h1>Search results</h1>
<a href="/product/123">Brake Pads Front</a><a href="/product/456">Oil Filter</a></body></html>`;
const category = `<!doctype html><html><head><title>Brakes</title></head><body><h1>Brake parts</h1>
<div data-facet="brand"><span data-facet-option="Bosch">Bosch</span><span data-facet-option="Brembo">Brembo</span></div>
<div data-facet="position"><span data-facet-option="front">front</span><span data-facet-option="rear">rear</span></div>
<a href="/product/123">Brake Pads Front</a></body></html>`;
const product = `<!doctype html><html><head><title>Product</title><script type="application/ld+json">{"@type":"Product","name":"Pads","offers":{"price":"49.99","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script></head><body><h1>Brake Pads</h1><p>$49.99 In stock</p></body></html>`;
const vehicle = `<!doctype html><html><head><title>Vehicle</title></head><body><h1>Select vehicle</h1><form action="/vehicle" method="get"><select name="year"></select><select name="make"></select><select name="model"></select></form></body></html>`;

export async function startMiniSite(variant: "normal" | "robots-disallowed" | "bot-wall" = "normal"): Promise<MiniSite> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const url = req.url ?? "/"; requests.push(url);
    res.setHeader("content-type", "text/html");
    if (url === "/robots.txt") {
      res.end(variant === "robots-disallowed" ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nDisallow: /private\nCrawl-delay: 1\nSitemap: /sitemap.xml\n");
      return;
    }
    if (variant === "bot-wall") { res.statusCode = 403; res.end("<html><title>Access denied</title><body>Please complete CAPTCHA</body></html>"); return; }
    if (url === "/" ) return void res.end(home);
    if (url.startsWith("/search")) return void res.end(search);
    if (url.startsWith("/category/brakes")) return void res.end(category);
    if (url.startsWith("/product/")) return void res.end(product);
    if (url.startsWith("/vehicle")) return void res.end(vehicle);
    if (url.startsWith("/private")) { res.statusCode = 200; return void res.end("<html>secret</html>"); }
    res.statusCode = 404; res.end("not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  return { server, baseUrl: `http://127.0.0.1:${port}/`, domain: "mini-auto.example", requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}
