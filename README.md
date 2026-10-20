![InkMotion Studio](docs/inkmotion.jpg)

# InkMotion Studio

An open-source, browser-based whiteboard animation editor for creating illustrated explainers with images, text, animated GIFs, drawing effects, keyframes, and audio.

Build compositions across multiple scenes, preview their animation, and export video using browser-side rendering. Work locally with browser-saved projects or run the Express application for accounts and database-backed project storage. **The current export interface requires signing in through the backend.**

Developed by **Cleyverson Costa**, based on [Inkplainer by Nadir](https://github.com/NadirWeb-App/Inkplainer-OS). Licensed under [Apache 2.0](LICENSE).

## Features

### Content and canvas editing

- Import PNG, JPEG, GIF, and SVG files into a reusable media library, then place assets on the canvas.
- Play animated GIF frames in previews and video rendering.
- Create and edit text with font, color, size, alignment, spacing, and styling controls.
- Move, resize, crop, duplicate, and arrange layers; adjust visibility and opacity.
- Select multiple objects with a selection rectangle or Shift selection, move them together, and organize them into groups.
- Split images into separate layers using grid, rectangle, or freehand slicing.
- Use solid or textured backgrounds, landscape, portrait, or square compositions, and an expanding infinite canvas.
- Undo and redo edits, and add, duplicate, reorder, or delete scenes.

### Drawing and motion

- Whiteboard effects including Chunk Jump, Scanner, Contour, Outline Chunks, Outline Fill, Outline Only, illustration coloring, and text drawing.
- Specialized drawing orders for human, animal, portrait, vehicle, building, landscape, and spiral compositions.
- Customizable hand assets, drawing speeds, stroke styles, edge detection, coloring, and image reveal effects.
- Sequential or parallel drawing through layer animation order.
- An object timeline with draggable clips, duration controls, scrubbing, frame stepping, zoom, and layer locking.
- Position, scale, rotation, and opacity keyframes, with motion presets such as fade, slide, rotate, pop, and zoom.
- Virtual camera pan and zoom animation with framing controls.
- Native SVG stroke drawing for supported geometry, with wipe or fade fallbacks for unsupported SVG content.

### Audio

- Import multiple audio files into the project audio timeline.
- View waveforms, move clips, trim their edges, and adjust individual volume and playback speed.
- Mix clips for synchronized preview and video export.

### Projects and accounts

- Local projects stored in IndexedDB with automatic saving.
- Email/password registration, sign-in, and session management.
- Optional Google sign-in and email-based password reset through SMTP.
- Account-backed project creation, saving, renaming, and deletion using Prisma and MySQL.
- Project-specific Studio URLs.
- English, Portuguese, and Spanish interfaces.

### Export

- MP4 with H.264 and WebM with browser-supported codecs.
- Source resolution, 720p, 1080p, 1440p, and 4K output options.
- 24, 30, or 60 FPS, adjustable bitrate, and codec preferences.
- Fast, Balanced, High Quality, and Maximum Quality presets.
- Optional final-frame PNG export.
- Frame-by-frame video rendering with progress reporting and cancellation.

Export currently uses the active scene. Codec availability depends on the browser and device. Audio muxing can fall back to real-time WebM recording if the primary audio export path fails.

## Run locally

### Full application

You need Node.js with npm, MySQL, and a browser with the APIs needed for your chosen export format. No frontend build step is required.

1. Install dependencies from the repository directory:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env`:

   ```sh
   cp .env.example .env
   ```

   In PowerShell, use `Copy-Item .env.example .env`.

3. Create a MySQL database:

   ```sql
   CREATE DATABASE IF NOT EXISTS inkmotion
     CHARACTER SET utf8mb4
     COLLATE utf8mb4_unicode_ci;
   ```

4. Set your database credentials and application URL in `.env`:

   ```dotenv
   DATABASE_URL="mysql://USER:PASSWORD@localhost:3306/inkmotion"
   PORT=3000
   APP_BASE_URL="http://localhost:3000"
   NODE_ENV="development"
   ```

5. Generate the Prisma client, apply the checked-in migrations, and start the server:

   ```sh
   npm run db:generate
   npm run db:migrate
   npm run dev
   ```

Open **http://localhost:3000/en** for the home page or **http://localhost:3000/en/studio** for the editor. The example environment sets port 3000; without `PORT`, the server defaults to 8080.

| Route | Purpose |
| --- | --- |
| `/en`, `/pt`, `/es` | Localized home pages |
| `/en/studio` | Studio; replace `en` with `pt` or `es` for another language |
| `/en/docs` | In-app documentation; also available in Portuguese and Spanish |
| `/health` | Application/database health endpoint |

### Optional configuration

Use [.env.example](.env.example) as the complete configuration template.

| Settings | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | Enable Google OAuth; register the matching `/api/auth/google/callback` URL with Google |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_ENCRYPTION` | Configure SMTP delivery for password reset emails |
| `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`, `APP_NAME` | Set email sender and application identity |
| `SESSION_COOKIE_NAME` | Customize the session cookie name |
| `JSON_LIMIT`, `PROJECT_STATE_LIMIT_BYTES` | Configure request and saved-project limits; defaults are `150mb` and 125829120 bytes respectively |

For deployment, set `NODE_ENV=production`, configure `APP_BASE_URL` and any OAuth callback for your domain, serve over HTTPS, apply migrations, and start with `npm start`. Keep `.env` out of version control.

### Static editor preview

To explore local editing without a database or account server, serve the repository over HTTP:

```sh
npx serve .
```

Open `/studio.html` on the address printed by the server. Static mode supports browser-local editing and project storage. Account synchronization, password reset, and the authenticated export interface require the full application.

## Create an animation

1. Open the Studio and create a project.
2. Upload media to the Content library, then click an asset to place it on the canvas, or add text.
3. Arrange layers, choose backgrounds, and organize your scenes.
4. Set drawing effects and animation order. Use the object timeline for precise clip timing, motion keyframes, and camera movement.
5. Add audio clips and adjust their timing, trim, volume, and speed.
6. Generate and preview the animation, using the timeline to inspect timing.
7. Sign in, select the scene to export, choose the format and quality settings, and export.

Use HTTPS or localhost for browser APIs that require a secure context. Some media search, fonts, and export dependencies load from external services, so static hosting does not make every feature available offline.

## Development

The frontend uses plain HTML, CSS, JavaScript, and Canvas 2D. The backend uses Express, Prisma, MySQL, bcrypt, and Nodemailer. Video export uses WebCodecs, container muxers, and optional FFmpeg WASM for audio muxing.

| File or directory | Responsibility |
| --- | --- |
| `index.html`, `home.js`, `home.css` | Home page and account/project entry points |
| `studio.html` | Editor UI, project persistence, preview, and export integration |
| `animations.js` | Whiteboard drawing algorithms |
| `animation-model.js` | Keyframes, motion presets, camera math, and document adaptation |
| `animation-editor.js`, `animation-editor.css` | Object timeline and animation controls |
| `audio-timeline.js` | Audio clips, waveform editing, and mixing |
| `gif-animation.js` | GIF decoding and timestamp-based frame selection |
| `svg-drawing.js` | SVG geometry compilation and stroke animation |
| `server.js` | HTTP server, authentication, email, and project APIs |
| `prisma/` | Database schema and migrations |
| `i18n.js`, `locales/` | Localization runtime and catalogs |
| `tests/` | Node unit tests and Playwright browser regressions |

### Validation commands

```sh
npm run check
npm run test:unit
npx playwright install chromium
npm run test:browser
```

`npm run test:all` runs the syntax check, unit tests, and browser suite. Playwright starts the application on port 18083 by default; set `PLAYWRIGHT_BASE_URL` to test an existing server. Real database, OAuth, SMTP, and encoded-media integrations need their own configured validation beyond mocked browser tests.

Database utilities include `npm run db:studio`, `npm run db:push` for schema synchronization during development, and `npm run prisma:migrate` to create development migrations. `npm run db:migrate` deploys existing migrations.

See [architecture notes](ARCHITECTURE.md), [validation notes](docs/validation-report.md), and [export performance notes](docs/export-performance.md) for implementation details and recorded checks. Some audit sections describe historical behavior; consult the current source when extending the editor.

## Storage and privacy

Rendering and media processing run in the browser. Local projects live in that browser's IndexedDB; clearing site data removes those local copies. Account-backed saves send project data, including embedded media, to the configured application server. External media and dependency requests contact their respective providers.

See [PRIVACY.md](PRIVACY.md) for the project's privacy documentation.

## Contributing and credits

Contributions to editing, animation, compatibility, localization, and documentation are welcome. Keep changes focused, describe the resulting behavior, and run the checks relevant to your change.

InkMotion Studio is developed and maintained by **Cleyverson Costa** and builds on **Inkplainer**, originally created by **Nadir**. Thanks to the [original project](https://github.com/NadirWeb-App/Inkplainer-OS) for the browser-based whiteboard animation foundation.

Distributed under the [Apache License, Version 2.0](LICENSE). Preserve the original copyright notices and attribution when redistributing this derivative work.
