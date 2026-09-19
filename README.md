# Display connector — spike and card loop

Two things in one project: the socket-lifetime spike, and the real card
loop it was blocking.

## Layout

```
api/             Vercel route handlers, thin wrappers over lib/
lib/store.mjs    session state, memory or Redis, never a module variable
lib/api.mjs      MCP tools + the glasses endpoints, as pure functions
server.mjs       local Node fallback (same handlers, optional ws)
public/          the 600x600 Web App, served at the site root
mockup/          the six-screen design comp, not deployed
```

Nothing stateful lives in `server.mjs`. That is the whole point: on
serverless, `show_card` and the wearer's poll land on different instances,
so the card must be a record, not an object in memory.

## Run it

```
npm install
npm start
```

With no Redis configured it uses the in-memory store, which is fine on one
process. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (Vercel
KV exposes the same names) and it switches automatically — the startup log
says which one is live.

## Pair the page

Identity comes from the per-user credential, since nothing documents Muse
passing a stable user id. Ask the server which display id a credential maps
to, then open the page at that id:

```
curl -H "Authorization: Bearer my-test-key" http://localhost:8080/api/whoami
```

Open `http://localhost:8080/?s=<the session it returns>`. The page
remembers it. QR pairing replaces this step later and mints the same URL
shape.

## Drive a card

```
curl -X POST http://localhost:8080/api/mcp \
  -H "Authorization: Bearer my-test-key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ask_approval","arguments":{"action":"Send the revised quote to Dana?","detail":"£4,200"}}}'
```

The card appears within a couple of seconds. Arrow keys move the focus
ring, Enter answers, and the answer comes back through `wait_for_answer`
with the same ticket.

## Why short-poll

The page polls every 2s, backing off to 6s after a quiet minute and 12s
after three. Long-polling would fight the function duration cap for no
benefit — a second or two of latency is nothing against an agent whose
cadence is minutes, and short-poll behaves identically on a long-lived
process and on serverless.

`wait_for_answer` waits up to 25s, then returns `status: "pending"` with
the ticket. It also reports whether the card was actually delivered, so an
agent can fall back to chat instead of reading silence as a refusal.

## The socket test

Less critical than it was — the card loop is plain HTTP now, so
WebSockets are not on the product's path. Still worth running, because it
tells you whether the page keeps executing while out of view, which is
what decides how long a queued card waits.

The page probes `WebSocket`, `EventSource` and `fetch` on load and logs
`ws-never-opened` separately from `ws-close`, so a socket that never
worked on-device cannot be misread as a backgrounding failure.

Watch `spike.log` while you:

1. Leave it in view for ~2 min
2. Middle-pinch to the app grid, wait 2 min
3. Let the display sleep, wait 2 min
4. Relaunch

| Pings stop | Beacons stop | Meaning |
| --- | --- | --- |
| no | no | Alive out of view. Best case. |
| yes | no | Socket dropped, JS still running. |
| yes | yes | Suspended. Cards wait for relaunch. |

Events buffer to `localStorage` and POST to `/flush` on reconnect, so a
kill-and-relaunch still yields a record of the dark period.

## Porting to Vercel

`lib/` moves unchanged. Each route in `server.mjs` becomes a handler that
calls the same function. Drop the WebSocket block and the `ws` dependency;
it exists only for the spike and has no role in the product.

Configure KV before deploying — the in-memory fallback will appear to work
on a single warm instance and then fail intermittently as it scales.

## Load on the glasses

Meta AI app: Settings > App Info, tap the version five times for Developer
Mode (glasses v125+, app v272+). Then App Settings > App Connections >
Web Apps > Add a Web App, paste the HTTPS URL including `?s=<session>`.
