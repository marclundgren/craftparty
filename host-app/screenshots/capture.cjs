/*
 * Regenerates the pictures of the app that the website shows.
 *
 * The renderer is the real one from ../renderer; only the preload bridge
 * is swapped for the stub in mock-bridge.js, so what ends up on the site
 * is the actual UI rather than a mockup that drifts from it. Run it after
 * any change to how the app looks:
 *
 *   npm run screenshots        (from host-app/)
 *
 * Electron renders offscreen, so nothing appears on your desktop.
 */
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const RENDERER = path.join(__dirname, "..", "renderer");
const SITE = path.join(__dirname, "..", "..", "app");
const PORT = 4317;

/**
 * Each picture the site uses. `zoom` renders the same layout at a higher
 * pixel density. The hero images are displayed wider than they are
 * captured, so at 1x they would be visibly soft.
 *
 * The site shows the two screens a new person meets, both as they look on
 * a fresh install: no saved worlds, no remembered parties. Nothing here is
 * a real world of anyone's.
 */
const SHOTS = [
  {
    out: path.join(SITE, "craftparty-host.png"),
    url: `http://localhost:${PORT}/?s=host&worlds=0`,
    width: 760,
    height: 1000,
    zoom: 2,
  },
  {
    out: path.join(SITE, "craftparty-join.png"),
    url: `http://localhost:${PORT}/?s=join&parties=0`,
    width: 760,
    height: 1000,
    zoom: 2,
  },
  {
    // Link previews. 1.9:1 is the shape social cards crop to. The join
    // form is the one that fits that shape without scrolling.
    out: path.join(SITE, "opengraph-image.png"),
    url: `http://localhost:${PORT}/?s=join&parties=0`,
    width: 1440,
    height: 756,
    zoom: 1,
  },
];

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

/**
 * Serves the renderer over http rather than file://, and injects the stub
 * bridge ahead of app.js. The page's own CSP allows neither, so it is
 * dropped for the capture. Nothing here is ever shipped.
 */
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/mock-bridge.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        return res.end(fs.readFileSync(path.join(__dirname, "mock-bridge.js")));
      }
      const name = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = path.join(RENDERER, path.normalize(name));
      if (!file.startsWith(RENDERER) || !fs.existsSync(file)) {
        res.writeHead(404);
        return res.end("not found");
      }
      let body = fs.readFileSync(file, "utf8");
      if (file.endsWith(".html")) {
        body = body
          .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
          .replace(
            '<script src="app.js">',
            '<script src="/mock-bridge.js"></script>\n  <script src="app.js">',
          );
      }
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file)] ?? "text/plain",
        "cache-control": "no-store",
      });
      res.end(body);
    });
    server.on("error", (err) => {
      // Almost always something else already on the port. Say so rather
      // than sitting there with nothing on stdout.
      console.error(`Could not serve the renderer on port ${PORT}: ${err.message}`);
      process.exit(1);
    });
    server.listen(PORT, () => resolve(server));
  });
}

// Offscreen rendering needs the GPU out of the way, and these sandboxes
// are not available to a headless run.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("in-process-gpu");

app.whenReady().then(async () => {
  const server = await serve();
  for (const shot of SHOTS) {
    const win = new BrowserWindow({
      width: shot.width * shot.zoom,
      height: shot.height * shot.zoom,
      useContentSize: true,
      show: false,
      backgroundColor: "#a5d9f2",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true,
        zoomFactor: shot.zoom,
      },
    });
    await win.loadURL(shot.url);
    // Zoom is remembered per origin across a session, so the second shot
    // would otherwise inherit the first one's. Set it after every load.
    win.webContents.setZoomFactor(shot.zoom);
    // The renderer settles asynchronously: the version lookup, the world
    // list and the preflight verdict all land after first paint.
    await new Promise((r) => setTimeout(r, 2500));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(shot.out, image.toPNG());
    const { width, height } = image.getSize();
    console.log(`${path.relative(process.cwd(), shot.out)}  ${width}x${height}`);
    // Left open until quit on purpose: destroying an offscreen window
    // takes the shared render context with it and the next load aborts.
  }
  server.close();
  app.quit();
});
