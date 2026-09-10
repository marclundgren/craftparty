# Screenshots

The pictures of the app on the website are generated from the app itself,
so they can't drift from it. Regenerate them whenever the UI changes:

```
npm run screenshots
```

(from `host-app/`). It writes three files:

| File | Used for |
| --- | --- |
| `app/craftparty-host.png` | the Host screen, in the website's hero |
| `app/craftparty-join.png` | the Join screen, beside it |
| `app/opengraph-image.png` | the link preview, via Next's `opengraph-image` file convention |

Every scene is a fresh install with invented data. Nothing captured here
is anyone's real world or invite.

## How it works

`capture.cjs` serves the real `../renderer` over http and swaps in
`mock-bridge.js` for the preload bridge, so the renderer draws a party
that isn't running. Electron then loads each scene offscreen, so nothing
appears on your desktop, and writes the captured page to a PNG.

Scenes are chosen with the query string the mock understands:
`?s=host|join|running`, `?net=independent|independent-maybe|assisted|error`,
`?worlds=N`, `?parties=N`. Add an entry to `SHOTS` in `capture.cjs` to
capture another one.

The stub is only ever loaded by this script. Nothing here is bundled into
the shipped app: `package.json`'s `build.files` lists `renderer/**`, not
this directory.
