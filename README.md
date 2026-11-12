# Before You Send

**What does your photo file reveal before you send it?**

Before You Send is a single-page, offline prototype. Drop a JPEG (or try the sample) to see hidden file data such as GPS coordinates, date and time, device model, and an embedded thumbnail — each with a one-line reason. Choose what to remove, and the tool writes a separate copy and then **re-reads that copy** to show what is left. Your original file is never changed.

- Photos stay on your device. No upload. No sign-up. No cost. Works offline.
- If the check cannot confirm everything, it says **Unknown** and does not offer a "clean" copy.
- It checks hidden file data only. It does not check what is visible in the picture.

> Status: prototype built for SafeSpace Hacks (build window October 17 – November 22, 2026). Currently only the fictional sample photo completes the full flow; many real JPEGs contain extra data blocks that the prototype reports as Unknown. Wider format support is in progress.

## Try it
Open `index.html` and press **Try sample photo**.

## Tests
```
node --test tests/
```

## Credits and AI assistance
- Prototype code and tests were generated with OpenAI Codex from written specifications and design mockups; planning, review, and browser testing used Anthropic Claude.
- The sample image is a generated bicycle illustration with fictional metadata.
