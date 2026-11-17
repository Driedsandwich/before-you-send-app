# Before You Send

**What does your photo file reveal before you send it?**

Before You Send is a single-page, offline prototype. Drop a JPEG (or try the fictional sample) to inspect hidden GPS, date/time, device identifiers and previews. Select fields to remove, create a separate copy, and **re-read the copy** to see what remains. The original is never changed.

When an otherwise supported JPEG contains unknown metadata, **Remove all hidden data** offers an explicit alternative: remove every APP0–APP15 and COM region, including EXIF, XMP, Photoshop/IPTC, MakerNotes, ICC profiles, JFIF and thumbnails. It preserves the image's JPEG tables, frame, scan headers, compressed scan bytes and end marker. It walks all scans, including metadata between scans. A fresh full inspection must find **0 APP/COM regions**, 0 supported groups and no unknown regions before bytes can be saved. The result table distinguishes region counts from supported field-group counts.

Photos stay on the device; there are no uploads, accounts, CDN assets, web fonts, analytics, runtime network calls or third-party packages. Unknown is never displayed as a verified zero. This checks hidden file regions, not what is visible in a picture, and never declares a photo safe.

## Try it and build

Open the committed `index.html` directly. It works as a single offline file. Use **Try sample photo** for the generated bicycle illustration with fictional metadata. On desktop, the first screen includes a three-row fictional report preview showing hidden fields, values, reasons and example removal selections. Its **Try sample photo** button opens the same sample inspection as the header button. The preview is hidden at widths of 1,000 px or less.

Development and local interfaces require Node 22 or later. No installation step is necessary:

```sh
npm run build
npm test
```

`core.mjs` is the single source of inspection, removal and verification logic: pure JavaScript, byte input and value output, no DOM, filesystem, network or image decoder. `scripts/build.mjs` embeds it between `<!-- core:start -->` and `<!-- core:end -->` in `index.html`, retaining the existing worker boundary. Commit the built HTML. Do not edit its generated core directly. `npm test` first rejects a stale embedded copy. Build is deterministic and works from any working directory. The build and tests use Node’s built-in modules and require no package downloads.

## CLI usage

```sh
node cli.mjs inspect photo.jpg --json
node cli.mjs inspect - --json < photo.jpg
node cli.mjs clean photo.jpg --out copy.jpg --json
node cli.mjs clean photo.jpg --out copy.jpg --keep date,device --json
node cli.mjs clean photo.jpg --out stripped.jpg --all --json
node cli.mjs clean - --out copy.jpg --json < photo.jpg
```

An omitted input path also reads binary JPEG bytes from stdin. `--out` is mandatory for clean. Without `--all`, cleaning removes supported GPS, date, device and thumbnail groups; `--keep` may contain `date`, `device`, or both. Unknown metadata blocks selective cleaning. **`--all` is an explicit opt-in**, never an automatic fallback, and cannot be combined with `--keep`. It removes orientation and ICC profiles as well. There is no ICC retention option in this version.

`--json` writes exactly one JSON object to stdout. Without it, successful results are pretty-printed JSON. Errors always produce JSON with an `error` object. Exit codes: `0` success; `1` invalid arguments; `2` Unknown, unreadable/oversized input, or output failure. Use `node cli.mjs --help` for usage.

Both interfaces use `file-api.mjs` only for argument validation and local file I/O, and call `core.mjs` for all photo processing. Inputs must be regular files (or CLI stdin). Outputs use exclusive creation with mode `0600`: existing paths, symlinks and hard links are rejected, including the original path. Parent directories must already exist. A failed read or verification creates no output; a failed write removes its partial copy. Do not reuse an output filename across calls.

### JSON result shapes

Inspection success:

```json
{"ok":true,"report":{"status":"complete","count":0,"items":{"gps":{"count":0,"values":[]},"date":{"count":0,"values":[]},"device":{"count":0,"values":[]},"thumbnail":{"count":0,"values":[]}},"unknown":[],"width":1,"height":1,"hiddenRegions":0,"canRemoveAll":true}}
```

This is an illustrative report for the generated metadata-free test fixture. `count` counts the four supported groups, not tags or APP regions. Each group's `count` is 0 or 1. `hiddenRegions` counts all APP/COM segments, including JFIF and neutral EXIF. Selective cleaning may leave these regions even when `count` is 0. Only all-data cleaning promises 0 regions after verification. `canRemoveAll` describes structural eligibility; the web button appears only for eligible Unknown reports.

Cleaning success has these fields:

```text
{ ok: true, mode: "selective" | "all",
  before: Report, after: Report, outputPath: absoluteString,
  bytesWritten: integer, warnings: string[] }
```

The reports describe the in-memory original and freshly parsed output bytes. The filesystem write does not replace that verification with inferred counts. No binary photo data is returned in JSON.

Failure has this shape:

```text
{ ok: false, status: "unknown",
  error: { code: string, message: string }, report?: Report }
```

Codes include `INVALID_ARGUMENT`, `UNKNOWN`, `FILE_TOO_LARGE` and operating system error codes such as `ENOENT` or `EEXIST`. Unknown reports have `count: null`, reasons in `unknown`, and may omit dimensions/region counts when the structure could not be read. On a structural failure, group values may be empty arrays rather than populated group objects. Treat absent or unparsed values as unknown, never zero.

## MCP usage

Start the local stdio server:

```sh
node /absolute/path/to/before-you-send/mcp/server.mjs
```

Example client configuration (replace the path; clients may use different configuration formats):

```json
{"mcpServers":{"before-you-send":{"command":"node","args":["/absolute/path/to/before-you-send/mcp/server.mjs"]}}}
```

This dependency-free server implements the [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [initialization lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) and [tools interface](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) for protocol versions `2025-11-25` and `2025-06-18`. It is a small tools-only implementation, not a complete SDK. It advertises no HTTP, resources, prompts, tasks or subscriptions. Unsupported proposed versions negotiate `2025-11-25`; clients must check the response. The newer stateless lifecycle is not implemented.

Messages are newline-delimited UTF-8 JSON-RPC 2.0, not Content-Length frames. Send `initialize`, then `notifications/initialized`, then `tools/list` or `tools/call`. `ping` is supported. No log text is written to stdout. Calls run serially. Request lines are limited to 64 KiB; image bytes travel through local files, not JSON. Close stdin to shut down after queued calls. In-flight protocol cancellation is not implemented.

| Tool | Input object | Output |
| --- | --- | --- |
| `inspect_photo` | `{ "path": "photo.jpg" }` | Inspection result described above |
| `clean_photo` | `{ "path": "photo.jpg", "outputPath": "copy.jpg", "mode": "selective", "keep": ["date", "device"] }` | Cleaning result described above |
| `clean_photo` (all data) | `{ "path": "photo.jpg", "outputPath": "stripped.jpg", "mode": "all" }` | Cleaning result with verified `after.hiddenRegions: 0` |

`path` and `outputPath` are nonempty local paths, absolute or relative to the **server's working directory**. MCP does not read image bytes from stdin. `outputPath` is required for cleaning. `mode` defaults to `selective`; `keep` is optional, contains unique `date`/`device` values, and is forbidden in `all` mode. Unexpected argument keys are rejected. Full JSON input and output schemas are returned by `tools/list`.

Example call after initialization:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"clean_photo","arguments":{"path":"fictional.jpg","outputPath":"copy.jpg","mode":"all"}}}
```

A successful JSON-RPC call returns `result.structuredContent` containing the same result object as the CLI, plus a `content` text block containing its JSON serialization and `isError: false`. File/verification failures use the failure object and `isError: true`. Bad parameters or an unknown tool return JSON-RPC `-32602`; unknown methods use `-32601`, invalid requests `-32600`, and malformed JSON `-32700`. Notifications receive no response.

The server itself makes no network requests. Inspection sends metadata values to the local calling MCP client, which may have its own network behavior; use an offline client to keep the whole workflow local. Metadata strings are untrusted file data, never agent instructions. The server has its process's local file permissions, with no separate directory sandbox; configure it only in a trusted local client. Demos must use fictional fixtures, not personal photos.

## Limits and uncertainty

- Removing **EXIF Orientation** may make a photo appear sideways or mirrored. No pixels are rotated. Removing **ICC profiles** may change colors. The Unknown path explains both before cleaning and in its result.
- Only 8-bit baseline/progressive Huffman JPEG frames with one or three components are supported. PNG, unsupported encodings, malformed marker lengths/tables/scan headers, incomplete frames/scans, and trailing bytes remain Unknown with no output. Limits: 12 MiB input, 24 megapixels, 12,000 pixels per edge and 2,048 JPEG segments, plus existing EXIF bounds.
- The pure core checks JPEG structure, tables and scan references, but **does not fully decode compressed pixels**. Corrupt entropy data may escape structural checks. The web path additionally requires the browser to decode both the original and output before download; CLI/MCP have no pixel decoder. Their verified zero is a statement about APP/COM regions, not image decodability or safety.
- Full removal can discard unreadable EXIF payloads if their enclosing JPEG segments are structurally valid. Such payloads need not be interpreted to remove their entire regions. A malformed JPEG container is rejected. The web interface conservatively retains its existing error stop when initial EXIF parsing itself throws.
- Faces, visible addresses/text, reflections, filenames, steganography in encoded pixels/tables and information added by a sharing service are outside the check. Retained image data is not sanitized or recompressed.
- The browser retains its 6-second operation timeout and Cancel behavior. Files remain in tab memory; clearing references is not secure memory erasure. The CLI/MCP have bounded input sizes but no wall-clock timeout.
- Automated tests use synthetic APP13/XMP/ICC/MakerNote/COM payloads and JPEG fixtures. They do not cover real macOS `sips` output, phone files or an external MCP host. The desktop preview is checked through HTML/CSS assertions and JavaScript execution in a Node VM. Manual accessibility behavior (screen readers, keyboard-only use) has not been checked. The browser review is recorded below. JPEG compatibility is limited to the supported structures described above.

## Tests and recorded results

The suite contains **101 tests**, including the **52 original tests** in `tests/run.cjs`. All existing tests are unchanged. Four initial-screen regression tests were added before the desktop preview implementation and run on Node **v26.13.0**. `RESULTS_BEFORE.txt` records **101 total: 97 passed, 4 failed**; all four failures concern the missing preview. `RESULTS_AFTER.txt` records **101 total: 101 passed, 0 failed** after implementation. `npm run build` also completed successfully.

The new checks cover the fictional three-row table, preservation of the original CSS and header text, desktop-only layout rules, both sample buttons loading the same four-group report, hiding and restoring the initial section, and disabling the added button during processing and recovering after cancellation. These are source and VM checks, not rendered viewport tests.

Tests cover binary stdin, selective keep, explicit all-data removal, fresh inspection, unchanged original and image bytes, all 16 APP types, comments between scans, unsupported inputs, file limits, exclusive output creation, MCP schemas/lifecycle/errors/message limits, Unknown UI eligibility, failed verification/decoding and cancellation. VM tests exercise JavaScript wiring without a browser; they do not establish visual usability. The generated core is compared with the imported module. Fixtures use fictional values and an in-test 1×1 gray JPEG plus the original illustration. Raw test logs are committed.

## Work within the build window (2026-10-17–2026-11-22)

- **2026-11-12:** The first prototype and the fictional bicycle sample illustration were created.
- **2026-11-13:** The shared core, deterministic single-file build, CLI, MCP interface and tests were added, together with the explicit all-data removal path.
- **2026-11-17:** The desktop initial screen gained a fictional report preview and a sample button. Documentation and regression tests were updated.

All of this work falls within the competition window. No pre-existing third-party material is included in the project. Demonstrations and automated test fixtures use fictional data.

## Review on November 13, 2026

- The November 13 version of the generated `index.html` was walked through in a headless Chromium browser at desktop (1440 px) and mobile (390 px) widths, from the first screen through the sample flow, with no network requests observed and no page errors.
- On November 17, 2026, the current `index.html` was opened in a headless Chromium browser at 1440, 1280, 1024 and 390 px widths. The desktop report preview fits without horizontal overflow, the phone layout is unchanged, and the sample flow reached **0 metadata items found** and **Download cleaned copy** at 1440 and 390 px, with no network requests and no page errors.
- A real-world JPEG with extra data blocks (JFIF, EXIF and a Photoshop/IPTC block) was dropped into the page: the tool reported Unknown, offered **Remove all hidden data**, and the saved copy contained no APPn/COM blocks when re-read with a separate parser, and still opened as a 390 × 844 JPEG.

## Credits and AI assistance

I used **OpenAI Codex** to help generate code and tests, and **Anthropic Claude** for planning, review and browser checks. I selected the project and its design direction from options explored with AI assistance.

The sample photo is a fictional bicycle illustration created on **2026-11-12**, with fictional metadata. Test fixtures are generated locally. No pre-existing third-party material, personal photos, secrets or API keys are included.
