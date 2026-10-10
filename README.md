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

The private environment file contains `BOATSPARK_BASE_URL` and `ORIGIN`, where `ORIGIN` is the browser-facing origin, for example `https://dashboard.example.com`. Supply both at runtime; the image builds without the upstream secret. Keep the file outside source control and restrict its filesystem permissions.

Attach the container to the existing Traefik Docker network. Configure an HTTPS router for the dashboard hostname and a service pointing to container port `3000`. The container serves **HTTP**; Traefik terminates TLS. `GET /health` checks server readiness without depending on upstream availability. The runtime uses the non-root `node` user.

The application does not authenticate viewers. Protect the dashboard and its `/api/dashboard` route with your Traefik access policy if the boat data should not be public. The hidden upstream URL is not dashboard access control.

## Display behavior

- Refresh current and 48-hour history every minute while visible, immediately catching up after an overdue return to the tab. Background timers may be throttled by the browser.
- Separate battery charts have fixed 11-15 V scales. Dials and values are green above 12.75 V, amber at 12.25-12.75 V inclusive, and red below 12.25 V. Voltages show two decimals. Values outside chart limits remain visible numerically and trigger an overflow notice.
- Three separate temperature charts share a range calculated from the available 48-hour history. Temperatures are converted from hundredths of Celsius to Fahrenheit and displayed to one decimal.
- Shore power on is good; bilge pump off is good. Unknown values are never presented as zero or healthy.
- Changed current displays highlight together for 1.5 seconds. Initial data, timestamp-only updates, and invisible precision changes do not flash. Reduced-motion settings use a static change outline.
- Measurements and refresh timestamps are distinct and rendered in Pacific time with daylight-saving adjustment.
- Failed refreshes retain valid readings, visibly marked stale. Upstream source stale flags are honored. Twelve hours without a valid source measurement produces a prominent warning; an initially unavailable source escalates after twelve hours on the page.
- Fullscreen hides the entry button and requests Screen Wake Lock where supported. Exiting restores the button and releases the lock. The lock is reacquired on returning to a visible fullscreen page. HTTPS is generally required; unsupported or denied capabilities are indicated without interrupting the display.

### Observed bilge cycles

The device counter is cumulative since reboot. We sum counter increases within the available rolling history; after a detected decrease we add the new counter value. Newer current observations are retained in memory during this browser session and merged without duplicate timestamps. We **do not** count sampled pump on/off transitions.

The upstream history is sampled at 15-minute intervals. The first sample is not assumed to start at zero; a counter increase crossing the exact window boundary cannot be allocated accurately and is omitted. Missing observations, gaps, and detected resets are marked as incomplete coverage. With fewer than two usable window observations, the count is unavailable, not zero.

The count is always **observed**, not exact: cycles before a reset may be lost, and a reset that has already caught up to the old counter can be invisible. Reloading the browser discards its extra observations. An exact total requires upstream event data or exact boundary/reset information.

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
