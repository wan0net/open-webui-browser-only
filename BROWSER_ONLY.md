# Open WebUI browser-only fork

This fork runs the Open WebUI frontend as a static site. It has no FastAPI process, server login, or network socket. A small browser-side compatibility layer implements the subset of Open WebUI's HTTP and socket contracts that the retained frontend uses.

## What works

- One implicit `Local User`; there is no login or sign-out flow.
- Direct OpenAI-compatible connections, including providers that expose Bedrock models through an OpenAI-compatible gateway.
- Provider model discovery through `GET /models`, or a manually configured model list.
- Streaming chat completions through the existing Open WebUI Direct Connections implementation.
- Browser-executed OpenAPI tools, remote MCP tools over Streamable HTTP, and a limited browser-native MCP package runtime.
- Per-call tool confirmation by default, with an explicit **Full access** option in the chat tool menu.
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

### Browser tools and MCP

Choose **Settings → Integrations → Add Connection** and select either **OpenAPI** or **MCP Streamable HTTP**. OpenAPI connections may load `openapi.json` from the server or use a pasted specification. MCP connections currently support no authentication or a bearer token. Enable the server from the Integrations button beside the chat input.

The selected OpenAI-compatible model must implement native `tools` / `tool_calls` chat-completion fields. Tool-enabled turns use non-streaming provider calls while the browser completes the tool loop; ordinary turns continue to stream. The browser asks before every call unless **Full access** is explicitly selected. Tool loops stop after six rounds, and individual results are truncated at 100,000 characters.

Tool servers must permit requests from the static site's origin. Remote MCP servers must also allow the `MCP-Protocol-Version` and `Mcp-Session-Id` request headers and expose the `Mcp-Session-Id` response header through CORS. HTTPS pages can only call HTTPS tool servers under normal browser mixed-content rules.

### Browser MCP packages

Choose **Settings → Integrations → Add browser package** to paste a package name or a common `npx` / `npm exec` command. The app asks an ESM registry/bundler (by default `https://esm.sh`) for a browser build, caches the complete module graph and its SHA-256 integrity hashes in IndexedDB, then loads it from local Blob URLs in an isolated Worker. Normal executable-only MCP packages are also retried at their common `dist/index.js` entry point.

The Worker supplies a narrow `process.stdin`, `process.stdout`, `process.stderr`, `process.env`, `process.argv`, and `process.nextTick` compatibility surface. Open WebUI then speaks MCP JSON-RPC over that simulated stdio channel. Package arguments and optional environment values can be entered in the advanced settings and remain browser-local. Pin a version in the package name, for example `example-mcp@1.2.3`, for reproducible installs.

This is the experimental LLMChef-style shim, not an embedded copy of Node.js. It is suitable only for browser-bundleable, pure JavaScript servers. Network APIs and child workers are disabled inside the Worker. Native modules, subprocesses, Docker, real operating-system files, raw sockets, Node-only built-ins, and packages with unsupported circular module graphs will fail visibly. A package is downloaded only on its first install for that package/entry URL; clear the site's stored data to force a fresh unversioned package download.

## GitHub Pages

The included `deploy-static.yml` workflow builds and deploys every push to `main`. In the repository settings, select **GitHub Actions** as the Pages source. The workflow supplies `BASE_PATH=/<repository-name>` for a project Pages site. For a root site or a custom-domain deployment, build without `BASE_PATH`.

The build copies `index.html` to `404.html` so direct links can enter the single-page app. Hosts other than GitHub Pages should be configured to fall back to `index.html` for unknown paths.

## Deliberately unavailable

These require a trusted shared server and are disabled in the capability response rather than left as broken controls:

- server accounts, authentication, user administration, groups, and permissions management;
- shared/public chats, channels, calendars, automations, and community sync;
- server workspaces, models, prompts, tools, functions, and knowledge bases;
- server file ingestion/RAG, web search, image generation, memories, analytics, and admin settings;
- server-managed tool execution and terminal servers (browser OpenAPI, remote HTTP MCP, and compatible browser MCP packages are available);
- cross-device sync, multi-user collaboration, and server-side background tasks.

Browser-native display features such as Markdown, diagrams, code formatting, local audio controls, and the retained Pyodide code path remain available where they do not depend on a disabled server API.

## Security and limitations

- API keys are browser data. Anyone with access to the browser profile or a script running in this origin may be able to access them. Use a dedicated origin and a narrowly scoped/revocable key.
- Clearing site data removes local chats, settings, and credentials. Export important chats periodically.
- Private browsing and managed-browser policies may restrict or erase IndexedDB/local storage.
- Direct providers must permit browser requests (CORS) and streaming responses.
- OpenAI-compatible gateways vary. Basic chat-completions streaming is covered; provider-specific server plugins and Open WebUI backend filters are not.
- Browser MCP is an early subset: Streamable HTTP with JSON or SSE responses works, plus compatible JavaScript packages can use the isolated Worker stdio shim. OAuth, server-initiated notifications, resumable streams, elicitation, sampling, real local processes, and arbitrary Node stdio servers remain unavailable.
- Tool connections and bearer tokens are browser data, subject to the same origin/profile risks as model API keys. Prefer narrowly scoped, revocable credentials and read-only tools where possible.
- Tool-call rendering is currently limited to the final assistant answer; the approval prompt and result loop work, but Open WebUI's richer server-side tool progress cards are not reproduced yet.

## Updating from upstream

The intended update boundary is small:

1. Merge or rebase a new Open WebUI tag into this fork.
2. Resolve the few intentional frontend integration points: `src/routes/+layout.svelte`, the local-user sign-out guard, static adapter configuration, and package scripts.
3. Run the unit tests and static build.
4. In a browser, verify boot, connection save/reload, model discovery, a streaming completion, an approved and declined OpenAPI tool call, an MCP connection/call, chat reload, pin/archive, and folder movement.
5. Watch the browser log for `[browser backend] unsupported ...`; a new call there identifies the exact virtual endpoint a new upstream version expects.

Most routine updates should therefore be a small merge plus contract verification. Changes to Open WebUI's boot, chat-completion event format, settings schema, or chat persistence schema are the updates most likely to need adapter work. Major API changes can still require a non-trivial compatibility update, but they stay concentrated under `src/lib/virtual-backend/`.
