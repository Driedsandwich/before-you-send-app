# Before You Send

**What does your photo file reveal before you send it?**

Before You Send is a single-page, offline prototype. Drop a JPEG (or try the fictional sample) to inspect hidden GPS, date/time, device identifiers and previews. Select fields to remove, create a separate copy, and **re-read the copy** to see what remains. The original is never changed.

When an otherwise supported JPEG contains unknown metadata, **Remove all hidden data** offers an explicit alternative: remove every APP0–APP15 and COM region, including EXIF, XMP, Photoshop/IPTC, MakerNotes, ICC profiles, JFIF and thumbnails. It preserves the image's JPEG tables, frame, scan headers, compressed scan bytes and end marker. It walks all scans, including metadata between scans. A fresh full inspection must find **0 APP/COM regions**, 0 supported groups and no unknown regions before bytes can be saved. The result table distinguishes region counts from supported field-group counts.

Photos stay on the device; there are no uploads, accounts, CDN assets, web fonts, analytics, runtime network calls or third-party packages. Unknown is never displayed as a verified zero. This checks hidden file regions, not what is visible in a picture, and never declares a photo safe.

## Try it and build

Open the committed `index.html` directly. It works as a single offline file. Use **Try sample photo** for the generated bicycle illustration with fictional metadata. Only the Unknown fallback and its result display have been added to the existing screen flow.

Development and local interfaces require Node 22 or later. No installation step is necessary:

```sh
npm run build
npm test
```

`core.mjs` is the single source of inspection, removal and verification logic: pure JavaScript, byte input and value output, no DOM, filesystem, network or image decoder. `scripts/build.mjs` embeds it between `<!-- core:start -->` and `<!-- core:end -->` in `index.html`, retaining the existing worker boundary. Commit the built HTML. Do not edit its generated core directly. `npm test` first rejects a stale embedded copy. Build is deterministic and works from any working directory. `.npmrc` disables network access and update notifications for the package commands.

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
- No real macOS `sips` output, phone files, external MCP host, browser rendering or manual accessibility behavior was tested in this revision. No browser automation or extensions were used. Tests generate synthetic APP13/XMP/ICC/MakerNote/COM payloads and JPEG fixtures. This is broader tested metadata handling, not a claim that every real-world JPEG is supported.

## Tests and recorded results

`tests/run.cjs` is unchanged: **52 existing tests**. Before implementation, 21 new CLI/MCP tests and 12 core tests were written and run on Node **v22.23.4**. `RESULTS_BEFORE.txt` records **85 total: 52 passed, 33 failed**, because the interfaces/core module were missing. After implementation, 12 additional boundary, progressive-scan and VM UI-wiring tests were added. `RESULTS_AFTER.txt` records **97 total: 97 passed, 0 failed**, including all 52 original tests.

Tests cover binary stdin, selective keep, explicit all-data removal, fresh inspection, unchanged original and image bytes, all 16 APP types, comments between scans, unsupported inputs, file limits, exclusive output creation, MCP schemas/lifecycle/errors/message limits, Unknown UI eligibility, failed verification/decoding and cancellation. VM tests exercise JavaScript wiring without a browser; they do not establish visual usability. The generated core is compared with the imported module. Fixtures use fictional values and an in-test 1×1 gray JPEG plus the original illustration. Raw test logs are committed.

## Work within the build window (2026-10-17–2026-11-22)

This revision was prepared on **2026-11-13** in the supplied workspace. It adds the shared core and deterministic single-file build, local CLI and MCP interfaces, the explicit all-data removal path, test-first logs, further regression coverage and these usage/limitations notes. The starting prototype was supplied as an existing repository snapshot; its earlier creation date and competition eligibility were not independently verified. No claim is made that the entire prototype originated in this revision. All demo/test data used here is fictional. Nothing was published, pushed, submitted to Devpost or written to an external application.

## Credits and AI assistance

- Original prototype disclosure: prototype code and tests were generated with OpenAI Codex from written specifications and design mockups; planning, review, and browser testing used Anthropic Claude.
- This revision's implementation, added tests, documentation and local verification were assisted by OpenAI Codex. No browser testing was performed for this revision. The student remains responsible for reviewing the changes and explaining AI assistance in the submission.
- The sample image is a generated bicycle illustration with fictional metadata. New fixtures are generated locally in tests; no personal photos, secrets or API keys were added.
