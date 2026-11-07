# The lab

A safe copy of the real work. It lives outside the repository and outside any synced folder.

```text
D:\ANNATERIA-LAB\
  materials-map.md   real names against client letters (never commit)
  clean\             the copy of D:\ANNATERIA, read only by habit, restored from
  work\              the data root of the run
  drive\             stands for the shared Google Drive folder
  usb\               stands for the flash drive
  runs\              scorecards, kept here
  findings.md        defects and why no check caught them
```

## Boundaries

- `D:\ANNATERIA` is only read, to make `clean`. Refresh `clean` only with the owner's word, because the owner's own tests go on there.
- Browser folder permissions belong to the page's address. Work on the local address only. Do not open the published page and point it at real folders.
- Choosing `G:\My Drive\...` is not allowed until the plan's last milestone, and then only a dedicated test folder.
- The local Worker keeps its own baton and lock-out, so it cannot disturb the real baton of Anna's and Vitalik's PCs.

## Running it

To be built in milestone M0 as one committed command. The parts already known:

- **Page:** serve `web/` on `http://127.0.0.1:8000` with `Cache-Control: no-store` (the embedded browser caches modules otherwise). Serve a replaced `config.js` that
  points `window.ANNATERIA_API` at the local Worker, so the repository's file stays untouched. Port 8000 is in `ALLOWED_ORIGINS`.
- **Worker:** `npx wrangler dev` in `worker/`. Secrets come from `worker/.dev.vars`.
- **The key:** the owner puts `GEMINI_API_KEY` in `.dev.vars`. Never read or print that file. Check for it only by asking whether the line exists, with no value shown.
- **Test login:** `node scripts/access-codes.mjs D:\ANNATERIA-LAB\secrets lab` makes a code and a signing key. Append `ACCESS_CODES` and `TOKEN_SIGNING_KEY` to `.dev.vars`
  without reading the file. The test code may be typed in the lab, on the local address only. The owner's real code is never used.
- **Browser:** the built-in browser is real Chromium with the folder picker (checked 7 November 2026). Whether the Windows folder and file dialogs can be driven from it is a hypothesis: test it first.
- **Fallbacks, in order:** the owner picks the lab folder once at the PC, if the permission then holds across reloads; drive Chromium with Playwright and answer
  the folder picker with a handle over the real disk. Everything but that one dialog stays real. Record which was used, because folder permission bugs then stay unseen.

## Known traps

- While the pane is hidden Chrome holds back a dialog's `close` event until the page draws again, and timers run as in a background page. Prefer the pane shown, or a real window.
- A cloned `<dialog>` keeps its `open` attribute and refuses `showModal()`.
- `npm ci` warns that install scripts of `esbuild` and `workerd` are blocked; tests still run.
