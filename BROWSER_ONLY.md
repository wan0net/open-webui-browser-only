# Open WebUI browser-only fork

This fork runs the Open WebUI frontend as a static site. It has no FastAPI process, server login, or network socket. A small browser-side compatibility layer implements the subset of Open WebUI's HTTP and socket contracts that the retained frontend uses.

## What works

- One implicit `Local User`; there is no login or sign-out flow.
- Direct OpenAI-compatible connections, including providers that expose Bedrock models through an OpenAI-compatible gateway.
- Provider model discovery through `GET /models`, or a manually configured model list.
- Streaming chat completions through the existing Open WebUI Direct Connections implementation.
- Chats, chat titles, folders, tags, pinned chats, archives, search, settings, connection details, and favourites saved by chat updates.
- Static production builds and GitHub Pages deployment.

Chats and folders use IndexedDB (`open-webui-browser`). User settings and direct-connection credentials use the browser's local storage (`open-webui-browser-settings`). Nothing is synchronized between browsers or devices.

## Run and build

Use Node.js 22, which is the current upstream-supported build version.

```sh
npm ci
npm run test:frontend -- --run
npm run build:static
npm run preview
```

Open the site, choose **Settings → Connections → Add Connection**, then enter the base URL of an OpenAI-compatible endpoint. The base normally ends in `/v1`. A key can be omitted when the endpoint does not require one. If model discovery is unavailable, use the connection's advanced settings to supply model IDs explicitly.

## GitHub Pages

The included `deploy-static.yml` workflow builds and deploys every push to `main`. In the repository settings, select **GitHub Actions** as the Pages source. The workflow supplies `BASE_PATH=/<repository-name>` for a project Pages site. For a root site or a custom-domain deployment, build without `BASE_PATH`.

The build copies `index.html` to `404.html` so direct links can enter the single-page app. Hosts other than GitHub Pages should be configured to fall back to `index.html` for unknown paths.

## Deliberately unavailable

These require a trusted shared server and are disabled in the capability response rather than left as broken controls:

- server accounts, authentication, user administration, groups, and permissions management;
- shared/public chats, channels, calendars, automations, and community sync;
- server workspaces, models, prompts, tools, functions, and knowledge bases;
- server file ingestion/RAG, web search, image generation, memories, analytics, and admin settings;
- server-managed tool execution and terminal servers;
- cross-device sync, multi-user collaboration, and server-side background tasks.

Browser-native display features such as Markdown, diagrams, code formatting, local audio controls, and the retained Pyodide code path remain available where they do not depend on a disabled server API.

## Security and limitations

- API keys are browser data. Anyone with access to the browser profile or a script running in this origin may be able to access them. Use a dedicated origin and a narrowly scoped/revocable key.
- Clearing site data removes local chats, settings, and credentials. Export important chats periodically.
- Private browsing and managed-browser policies may restrict or erase IndexedDB/local storage.
- Direct providers must permit browser requests (CORS) and streaming responses.
- OpenAI-compatible gateways vary. Basic chat-completions streaming is covered; provider-specific server plugins and Open WebUI backend filters are not.

## Updating from upstream

The intended update boundary is small:

1. Merge or rebase a new Open WebUI tag into this fork.
2. Resolve the few intentional frontend integration points: `src/routes/+layout.svelte`, the local-user sign-out guard, static adapter configuration, and package scripts.
3. Run the unit test and static build.
4. In a browser, verify boot, connection save/reload, model discovery, a streaming completion, chat reload, pin/archive, and folder movement.
5. Watch the browser log for `[browser backend] unsupported ...`; a new call there identifies the exact virtual endpoint a new upstream version expects.

Most routine updates should therefore be a small merge plus contract verification. Changes to Open WebUI's boot, chat-completion event format, settings schema, or chat persistence schema are the updates most likely to need adapter work. Major API changes can still require a non-trivial compatibility update, but they stay concentrated under `src/lib/virtual-backend/`.
