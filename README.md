# Boat Spark dashboard

A dark, display-only SvelteKit dashboard for two batteries, Galley/Fridge/Engine Bay temperatures, shore power, and bilge monitoring. All assets are bundled locally. Node 24 is used by Docker and CI.

## Development

```sh
npm ci
cp .env.example .env
# Set BOATSPARK_BASE_URL in .env, without committing it.
npm run dev
```

`BOATSPARK_BASE_URL` is the HTTPS shared-boat base URL ending at its boat identifier, **not** `/current` or `/history`. Only `https://web.boatspark.com/api/shared/boats/<identifier>` is accepted. It is read on the Node server at runtime and never sent to the browser. Do not use a `PUBLIC_` variable, build argument, or workflow secret for it. Do not paste the real URL into code, fixtures, logs, or issue reports.

```sh
npm run check
npm run lint
npm run test:unit -- --run
npx playwright install chromium
npm run test:e2e
npm run build
```

The browser tests use synthetic data and do not require the real endpoint. `npm run format` formats project files.

## Docker and Traefik

```sh
docker build -t boatspark-dashboard .
docker run --rm --name boatspark-dashboard \
  --env-file /path/to/private/dashboard.env \
  -p 127.0.0.1:3000:3000 boatspark-dashboard
```

Local builds use the host architecture, so arm64 is supported for development and testing. CI publishes only `linux/amd64` (x64). The build stage runs natively and produces platform-independent JavaScript; the final stage selects the requested Node runtime platform.

The private environment file contains `BOATSPARK_BASE_URL` and `ORIGIN`, where `ORIGIN` is the browser-facing origin, for example `https://dashboard.example.com`. `TRMNL_API_TOKEN` is optional and enables the authenticated live TRMNL endpoint. Supply these at runtime; the image builds without secrets. Keep the file outside source control and restrict its filesystem permissions.

Attach the container to the existing Traefik Docker network. Configure an HTTPS router for the dashboard hostname and a service pointing to container port `3000`. The container serves **HTTP**; Traefik terminates TLS. `GET /health` checks server readiness without depending on upstream availability. The runtime uses the non-root `node` user.

The main dashboard and its `/api/dashboard` route do not authenticate viewers. Protect them with your Traefik access policy if the boat data should not be public. The hidden upstream URL is not dashboard access control. The separate live `/api/trmnl` endpoint requires its own bearer token.

## Display behavior

- Refresh current and 48-hour history every minute while visible, immediately catching up after an overdue return to the tab. Background timers may be throttled by the browser.
- Separate battery charts have fixed 11-15 V scales. Dials and values are green above 12.75 V, amber at 12.25-12.75 V inclusive, and red below 12.25 V. Voltages show two decimals. Values outside chart limits remain visible numerically and trigger an overflow notice.
- Three separate temperature charts share a range calculated from the available 48-hour history. Temperatures are converted from hundredths of Celsius to Fahrenheit and displayed to one decimal.
- Shore power on is good; bilge pump off is good. Unknown values are never presented as zero or healthy.
- Changed current displays highlight together for 1.5 seconds. Initial data, timestamp-only updates, and invisible precision changes do not flash. Reduced-motion settings use a static change outline.
- Measurements and refresh timestamps are distinct and rendered in Pacific time with daylight-saving adjustment.
- The entire dashboard automatically dims to 10% CSS brightness from 10:00 PM inclusive until 5:00 AM exclusive, Pacific time (including daylight saving), in both normal and fullscreen modes. Switching is immediate, checked by the existing one-second clock and on returning to the tab. Warnings and change highlights dim too; there is no manual override. The initial server render follows the same schedule, then the browser clock takes over. This does not change the physical screen backlight or browser/system UI.
- Failed refreshes retain valid readings, visibly marked stale. Upstream source stale flags are honored. Twelve hours without a valid source measurement produces a prominent warning; an initially unavailable source escalates after twelve hours on the page.
- Fullscreen hides the entry button and requests Screen Wake Lock where supported. Exiting restores the button and releases the lock. The lock is reacquired on returning to a visible fullscreen page. HTTPS is generally required; unsupported or denied capabilities are indicated without interrupting the display.

### Observed bilge cycles

The device counter is cumulative since reboot. We sum counter increases within the available rolling history; after a detected decrease we add the new counter value. Newer current observations are retained in memory during this browser session and merged without duplicate timestamps. We **do not** count sampled pump on/off transitions.

The upstream history is sampled at 15-minute intervals. The first sample is not assumed to start at zero; a counter increase crossing the exact window boundary cannot be allocated accurately and is omitted. Missing observations, gaps, and detected resets are marked as incomplete coverage. With fewer than two usable window observations, the count is unavailable, not zero.

The count is always **observed**, not exact: cycles before a reset may be lost, and a reset that has already caught up to the old counter can be invisible. Reloading the browser discards its extra observations. An exact total requires upstream event data or exact boundary/reset information.

## Live TRMNL display

The private TRMNL plugin can poll `/api/trmnl` for real readings. It uses the same server-side Boat Spark normalization and display thresholds as the dashboard; it never exposes `BOATSPARK_BASE_URL`. The endpoint accepts only a bearer token in the `Authorization` header, uses `Cache-Control: private, no-store`, and returns 503 when its token is missing or invalid and 401 for missing or incorrect credentials. It does not change the dashboard API response.

To migrate the tested prototype to live data:

1. Generate a **new, unique** random token with `openssl rand -hex 32`. Add it as `TRMNL_API_TOKEN` to the dashboard's private runtime environment file, then redeploy/restart the container with that file. Keep the token out of source control, URLs, build arguments, logs, and chat; do not reuse the Boat Spark URL or another credential. Omit or clear this variable to disable the endpoint. The token must contain 32–256 printable ASCII characters without spaces; the recommended command produces 64 hexadecimal characters.
2. Verify an unauthenticated request to `https://YOUR-DASHBOARD-HOST/api/trmnl` returns **401**. A **503** means the token is not configured correctly. Any existing Traefik access policy must also allow TRMNL's polling request to reach this route; do not remove protection from the main dashboard or `/api/dashboard`.
3. In the existing private plugin, keep **Polling / GET** and change the single URL to `https://YOUR-DASHBOARD-HOST/api/trmnl`. Add `Authorization: Bearer YOUR_TOKEN` in **Polling Headers**, using the same token from the runtime environment. Treat the plugin settings as sensitive; TRMNL receives the selected boat data.
4. Replace the **Full** markup with the updated [`src/lib/trmnl/screen.liquid`](src/lib/trmnl/screen.liquid), save, and force-refresh the plugin. Keep **Remove Bleed Margin** enabled and use the full-screen playlist item. Press the device's next-screen button to request an update.

The endpoint fetches current and history in parallel with a seven-second upstream timeout to stay below [TRMNL's ten-second polling timeout](https://help.trmnl.com/en/articles/17434705-plugin-strategies). On failure it returns a screen with the last available values/history marked stale, or `--` if none are available. Measurement times and the snapshot time are distinct. A twelve-hour lack of valid measurements is prominent; if a source was unavailable from the beginning, that interval starts with the first server observation.

Last-good readings, history, and extra bilge counter observations are retained **in the Node process's memory**, populated by both dashboard and TRMNL requests while the token is configured. A restart loses this state; an unavailable source then displays `--` until a successful fetch. Each server process maintains separate state. The browser still maintains its own session observations, so the two observed-cycle counts can differ due to timing, reloads, or resets; neither is an exact count.

TRMNL is a periodically refreshed display, **not an immediate bilge alarm**. A disconnected device cannot update its stale warning; check the snapshot and measurement times. Actual refresh also depends on device, plugin, and playlist settings.

## TRMNL prototype (synthetic data only)

This is an unpublished, full-screen 800×480 monochrome prototype for a TRMNL OG. It does **not** read Boat Spark, retain live readings, or change the existing dashboard. The prototype URLs contain only generated example data and intentionally have no application-level authentication; any existing Traefik policy still applies.

Run `npm run dev` and open `/trmnl/prototype`. Add `?scenario=low-voltage`, `stale`, `missing-history`, `counter-reset`, or `unavailable` to exercise warnings, chart gaps, counter resets, and missing readings. `normal` is the default. Every screen is labelled synthetic. The browser preview renders the same Liquid file used on TRMNL, with no client-side scripts or external assets. Black/white CSS still has browser/device text antialiasing; physical-device readability must be checked.

### Manual TRMNL configuration

Deploy this prototype using the normal dashboard deployment, then:

1. Enable Developer Edition on your TRMNL OG if it is not already enabled.
2. Add a **Private Plugin**, name it `Boat Spark prototype`, and choose **Polling** with **GET**.
3. Set its single polling URL to `https://YOUR-DASHBOARD-HOST/api/trmnl/prototype`. Leave polling body and headers empty unless your existing access policy requires authentication headers. Do not change the upstream Boat Spark URL or make `/api/dashboard` public for this prototype.
4. Save the plugin. In **Edit Markup**, paste the complete contents of [`src/lib/trmnl/screen.liquid`](src/lib/trmnl/screen.liquid) into **Full**. Leave **Shared** and the other layouts empty. Enable **Remove Bleed Margin**: this custom layout already includes its own padding and uses the whole 800×480 canvas.
5. Select TRMNL OG / landscape / monochrome in the preview where offered. Force-refresh the plugin to load its variables. Add it as one **full-screen** playlist item, not a mashup. Use 15-minute plugin and device refresh settings for this trial.
6. To test a warning screen, append one of the scenario queries above to the polling URL, save, and force-refresh. The device still needs to check in; press its next-screen button after refreshing the plugin to test immediately.

Do **not** publish a Recipe or share the plugin. The prototype requires no API key, webhook URL, OAuth app, or live boat credentials. TRMNL receives only synthetic data when polling this prototype URL. If fetching fails, inspect your existing access policy and TRMNL's plugin variables/error rather than disabling dashboard protection. The prototype's stale scenario is simulated, not live-data retention.

Focused validation: `npm run test:unit -- --run src/lib/trmnl/data.test.ts` and `npm run test:e2e -- tests/trmnl.e2e.ts`. Browser tests save 800×480 screenshots for every scenario under `test-results/`.

## Automated image publishing

`.github/workflows/docker.yml` runs on every push to `main`, checks the application and tests, then builds `linux/amd64` and publishes:

- `ghcr.io/boatspark/dashboard:latest`
- `ghcr.io/boatspark/dashboard:sha-<full-commit-SHA>`

Official GitHub and Docker actions are pinned to immutable commits for their latest stable releases resolved during implementation. Dependabot checks GitHub Actions references weekly. Buildx uses GitHub Actions cache, and image labels link the image to its source/revision.

The workflow authenticates with `GITHUB_TOKEN`; it needs repository-content read and package-write permissions. Ensure the repository's Actions settings permit those permissions and that an existing GHCR package grants this repository write access. Package visibility remains operator-controlled. Private image pulls need appropriate GHCR credentials.

Publishing is serialized with `cancel-in-progress: false` so an active build is not interrupted. GitHub may replace superseded pending concurrency runs, so not every rapid intermediate commit is guaranteed its own image. The final published image carries its commit-specific tag.

```sh
docker pull ghcr.io/boatspark/dashboard:latest
# Use the same runtime configuration and Traefik settings described above.
```

Use `gh run list --repo boatspark/dashboard` to check publishing runs. A successful run publishes both tags; use the commit-specific tag when an immutable deployment reference is needed.
