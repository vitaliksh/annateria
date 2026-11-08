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
  shots\             pictures of the screen and of originals
  secrets\           the test code of the local Worker
  browser-profile\   the lab window's Chrome profile
  venv\              Python for reading originals
  findings.md        defects and why no check caught them
```

## Boundaries

- `D:\ANNATERIA` is only read, to make `clean`. Refresh `clean` only with the owner's word, because the owner's own tests go on there.
- Browser folder permissions belong to the page's address. Work on the local address only. Do not open the published page and point it at real folders.
- On the real Drive only `G:\My Drive\ANNATERIA-TEST` (owner, 8 November 2026); the dialog helper refuses any other Drive path.
- The local Worker keeps its own baton and lock-out, so it cannot disturb the real baton of Anna's and Vitalik's PCs.

## Running it

Built in M0 and proved on 7 November 2026. Everything below is real: the Windows dialogs open and are answered, Chrome's own prompt is pressed.

```bash
node tools/lab.mjs restore
node tools/lab.mjs serve
node tools/browser.mjs start
```

Run `serve` and `browser.mjs start` in the background; `preview_start` with the name `lab` also starts `serve`. Install once: `npm install` in `tools/`, and the reading tools named at the head of `tools/doc.py`.

- **Page:** `http://127.0.0.1:8000`, no-store, a replaced `config.js` that points at the local Worker, a build marker `lab <commit>`. The repository's files stay untouched.
- **Worker:** `wrangler dev` on port 8787, with its own baton and lock-out. Secrets come from `worker/.dev.vars`. Never read or print that file.
- **Test login:** the code is in `D:\ANNATERIA-LAB\secrets\lab-code.txt`. Made by `worker/scripts/access-codes.mjs` and appended to `.dev.vars`. It may be typed in the lab, on the local address only. The owner's real code is never used.
- **Browser:** a separate Chrome with its own profile in the lab, driven by `tools/browser.mjs`: `shot`, `text`, `buttons`, `click`, `type`, `press`, `until`, `look`. Pictures go to `D:\ANNATERIA-LAB\shots`; read them with the Read tool.
- **Windows dialogs:** `powershell -File tools/windows-dialog.ps1 choose <path>` answers the folder, open and save dialogs, for lab paths only. `prompt` lists Chrome's own buttons and `prompt Allow` presses one.
- **A folder step:** click the button, `choose D:\ANNATERIA-LAB\work`, then `prompt Allow`.
- **A second PC (the baton):** `LAB_PROFILE=browser-profile-2 LAB_CHROME_PORT=9334` before `browser.mjs` and `windows-dialog.ps1`
  gives a second Chrome with its own device id. Give it a data folder restored from the backup, the same shared folder and the
  recovery code (`secrets\lab-recovery-code.txt` holds the whole dialog text; take the 14 groups of four).
- **Reading originals yourself:** `tools/doc.py` renders PDF and HEIC to pictures and prints Excel, with the lab's Python.

The built-in browser of the desktop app is not used. It answers the folder picker with `AbortError` at once (tried with the pane hidden, 7 November 2026), and a second Worker device there takes the baton.

## The gate

`node tools/gate/anna-day.mjs` is the short day of M3: synthetic, scripted model, headless, about 10 seconds. It runs before every push that changes `web/`. It proves the
page still opens, a month opened by a click takes the agent's rows, and a scan above the request limit is read. It never replaces an exam.
`node tools/gate/prove.mjs` puts the three bugs of 6 November back into a copy and expects the gate to fail on each.

## Known traps

- While the pane is hidden Chrome holds back a dialog's `close` event until the page draws again, and timers run as in a background page. Prefer the pane shown, or a real window.
- A cloned `<dialog>` keeps its `open` attribute and refuses `showModal()`.
- After a reload Chrome may show its own "Allow" bubble for a folder; until it is answered (`prompt Allow`) keys typed into the page are lost.
- Every folder picker and folder permission answered `AbortError` at once (8 November 2026, afternoon) while a Windows shell surface
  (`ShellHost`) held the foreground and the lab window could not be brought forward; a Chrome restart did not help. A person's click
  on the lab window is needed; ask, do not loop.
- `until` waits on animation frames, which stop in a window hidden behind the other lab window; poll with `look` instead.
- `npm ci` warns that install scripts of `esbuild` and `workerd` are blocked; tests still run.
