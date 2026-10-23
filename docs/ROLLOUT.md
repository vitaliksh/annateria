# Rollout on Anna's PC (phase 8)

Step 8.1 of `WORK_PLAN.md`: the set-up checklist, done by Vitalik together with Anna. Interface labels are quoted exactly as
`web/index.html` has them. Tick each box on paper during the visit and note anything that differed in `HANDOFF.md`.

Written 23 October 2026, for the app version after `8eb7064` and Worker `2026.10.23.2` or later (the baton names the store of
its last copy). Not yet followed on Anna's PC.

## Bring

- [ ] The recovery code on paper (the one already used on Vitalik's PC: both PCs **must** have the same code).
- [ ] Anna's own access code (see "Before the visit").
- [ ] A USB flash drive for the second copy.
- [ ] Anna's Google account password is hers: she types it herself.

## Before the visit (Vitalik, on his PC)

- [ ] **Access codes.** If Anna has no code of her own yet, make one for each person in a terminal of Vitalik's PC
  (`worker/README.md`): `node scripts/access-codes.mjs C:\secrets\annateria anna vitalik`, then load the two secrets as that file
  says. This replaces **both** codes: Vitalik's old code stops working too. The codes appear only in that terminal; write Anna's on
  paper for her, never in a chat or an e-mail. A shared code also works, but separate codes let one be turned off alone.
- [ ] **A new shared folder** for the real data, not the test one (`annateria-sync-test` held test clients). In Vitalik's Google
  Drive (web): create `ANNATERIA` in My Drive and share it with Anna's Google account as **Editor**.
- [ ] **Vitalik's PC leaves the test folders** in step 6 below. Until then it may stay as it is: since Worker `2026.10.23.2` the
  baton says in which shared folder its last copy lives, and a PC with another folder does not wait for it.

## On Anna's PC

1. **Browser.** Chrome or Edge, up to date (File System Access is needed; Chrome 122 or later asks "Allow on every visit", which
   saves a click after every restart:
   <https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api>).
   - [ ] Open <https://vitaliksh.github.io/annateria/>, press Ctrl+F5, check the build marker at the bottom of the sidebar.
   - [ ] Bookmark it on the bookmarks bar.
2. **Google Drive for desktop.**
   - [ ] Installed and signed in with **Anna's** Google account ("Stream files" is fine: spike 7.1).
   - [ ] In Drive on the web, as Anna: "Shared with me" → `ANNATERIA` → ⋮ → "Organize" → "Add shortcut" → "My Drive".
   - [ ] In File Explorer the folder appears as `<her drive letter>:\My Drive\ANNATERIA` (wait a minute if it is not there yet).
3. **The data folder (local, never inside Google Drive or OneDrive).**
   - [ ] Create `C:\ANNATERIA` (or `D:\ANNATERIA` if there is a D: drive).
   - [ ] If she worked in the old ocr app: copy her old data folder into it first (step 8.2 checks it); the old folder stays as it
     was, untouched, as a fallback.
   - [ ] In ANNATERIA: "בחירת תיקיית נתונים" → that folder → allow ("Allow on every visit" when Chrome offers it).
   - [ ] "הגדרות" → "נתיב מלא" → type the full path (the browser does not reveal it).
4. **Access code.**
   - [ ] The dialog "קוד גישה" at every opening: Anna types her code → "כניסה".
   - [ ] "הגדרות" → "בדיקת חיבור ל‑AI" answers that the connection works.
   - [ ] The plate in the top bar is green "עובדים כאן". (Should it ever stay blue "מקבל נתונים…" on this first opening, click it
     → "לעבוד כאן": there is nothing to take on a new PC.)
5. **Recovery code and the shared folder** ("גיבוי" in the sidebar).
   - [ ] "קוד שחזור": "כבר יש לך קוד שחזור (למשל מהמחשב השני)?" → type the code from paper → "שימוש בקוד". Do **not** press
     "יצירת קוד שחזור": a new code would not open the copies of the other PC.
   - [ ] "תיקייה משותפת" → "בחירת תיקייה" → `<her drive letter>:\My Drive\ANNATERIA`. The ☁ in the top bar turns "✓" with the time.
     If it says instead that the other PC's copy has not arrived ("…עוד לא הגיע לתיקייה המשותפת…"), the folder is new: click ☁ once.
6. **Vitalik's PC takes Anna's data** (after step 5).
   - [ ] Anna closes the ANNATERIA tab (or clicks the green plate → "סיום"); wait 3 to 4 minutes, or less after "סיום".
   - [ ] On Vitalik's PC, first wait until his shortcut of `ANNATERIA` shows the folder `annateria-sync` in File Explorer (Drive
     has brought Anna's copy; choosing the folder earlier is safe too: no copy leaves his PC until hers has arrived).
   - [ ] Then: "בחירת תיקיית נתונים" → a **new empty** folder (for example `D:\ANNATERIA-ANNA`); "גיבוי" → "תיקייה
     משותפת" → "בחירת תיקייה" → his shortcut of `ANNATERIA`. The plate turns blue "מקבל נתונים…", then green: her clients appear.
   - [ ] Edit nothing real there yet; close the tab.
7. **The flash copy.**
   - [ ] On Anna's PC: plug in the drive, "גיבוי" → "כונן נייד (USB)" → "בחירת תיקייה" → a folder on the drive → "גיבוי עכשיו",
     then "בדיקת תקינות" (both must say all is well); eject the drive. The dot at "גיבוי" turns green.
   - [ ] Tell Anna: once a week the status bar asks for it ("הגיבוי האחרון לכונן נייד היה לפני … ימים").
8. **The phone.**
   - [ ] "תיבת קלט" → "איך מעבירים מהטלפון?": go through the guide with her phone once (send one document to herself in WhatsApp
     as a document, drag it from WhatsApp Desktop into "תיבת קלט").
9. **What Anna needs to know** (one page for her, in Hebrew, to be written with her words after the visit):
   - [ ] Open the bookmark, type the code. Green plate: work. Red plate "פתוח אצל …": Vitalik is working; wait, it turns green by
     itself after he closes ANNATERIA.
   - [ ] Nothing to save by hand: every change is saved, and a copy goes to Drive ten seconds later (☁ ✓).
   - [ ] Closing the tab is enough; the green plate's click "סיום" frees the place at once.
   - [ ] Never put the data folder into Google Drive, OneDrive or the desktop.

## After the visit

- [ ] Step 8.2: her old data opened in ANNATERIA, the reports equal to the old app (`WORK_PLAN.md`).
- [ ] Record in `HANDOFF.md`: date, browser and Drive versions, drive letter, anything that differed from this list (no client
  names, no amounts, no codes).
