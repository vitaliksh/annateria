# Rollout on Anna's PC (phase 8)

Step 8.1 of `WORK_PLAN.md`: the set-up checklist, done by Vitalik together with Anna. **Writing rule** (owner, 24 October 2026):
a line is either English or Hebrew, never both, because mixed lines turn right-aligned and jumble the words. Each step says
in English what to do; the exact interface labels follow on their own lines, in Hebrew only, as `web/index.html` has them.

First done on 23 October 2026 (evening): all clients arrived on Anna's PC after two problems, now covered by this list and by
the app (see "What went wrong on 23 October" at the end).

## Before the visit (Vitalik)

- [ ] **Decide which PC holds the data.** That PC sends the first copy; the other PC starts with a **new empty** data folder
  and receives. (On 23 October the clients were on Vitalik's PC.)
- [ ] **Access codes.** If Anna has no code of her own, make one per person in a terminal on Vitalik's PC (`worker/README.md`):
  `node scripts/access-codes.mjs C:\secrets\annateria anna vitalik`, then load the two secrets as the README says. This
  replaces both codes, Vitalik's too. Write Anna's code on paper; never send it in a chat or an e-mail.
- [ ] **The shared folder.** In Vitalik's Google Drive (web) create a folder named **`ANNATERIA`** in My Drive and share it
  with Anna's Google account as Editor. Never name it `annateria-sync`: that is the name of the app's own folder inside it,
  and the same name twice is what confused everybody on 23 October.
- [ ] Bring: the recovery code on paper (the one already used on Vitalik's PC), Anna's access code, a USB flash drive.

## On Anna's PC

1. **Browser.** Chrome or Edge, up to date. Open <https://vitaliksh.github.io/annateria/>, press Ctrl+F5, check the build
   marker at the bottom of the sidebar, bookmark the page on the bookmarks bar. When Chrome asks for folder access, choose
   the option that allows it on every visit (Chrome 122 or later:
   <https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api>).
2. **Google Drive for desktop.** Installed and signed in with Anna's account ("Stream files" is fine). In Drive on the web,
   as Anna: "Shared with me", the folder `ANNATERIA`, the menu ⋮, "Organize", "Add shortcut", "My Drive". In File Explorer
   it appears as `<her drive letter>:\My Drive\ANNATERIA` after a minute.
3. **The data folder.** Local, never inside Google Drive, OneDrive or the desktop. If this PC receives the data, create a
   **new empty** folder (for example `C:\ANNATERIA`); if it holds the data, use the folder that has `clients` in it. Choose it
   with the button below and allow the access:
   - בחירת תיקיית נתונים
   Then type the full path of the folder in the settings, field below:
   - הגדרות ← נתיב מלא
4. **Access code.** Anna types her code in the first dialog and presses the button below. The plate in the top bar turns
   green.
   - כניסה
5. **Recovery code.** In the backup dialog, enter the code from paper (never create a new one):
   - גיבוי ← כבר יש לך קוד שחזור (למשל מהמחשב השני)? ← שימוש בקוד
   Never press:
   - יצירת קוד שחזור
6. **The shared folder.** In the backup dialog, section and button below, choose **`ANNATERIA` itself**: go into My Drive,
   select `ANNATERIA`, press "Select folder"; do not go into it. The app refuses a folder one level too deep or too high
   and names the right one.
   - גיבוי ← תיקייה משותפת ← בחירת תיקייה
   - [ ] Check: the line under the section shows the folder name `ANNATERIA`. **The same name must show on both PCs.**
7. **The first copy, from the PC that holds the data.** On that PC (Vitalik's on 23 October) do steps 3 to 6 too if not done,
   press ☁ in the top bar and wait for ✓ with the time, then close the tab and wait 3 to 4 minutes (Drive uploads the copy;
   its tray icon says when all is up to date).
   - [ ] Check in File Explorer: `ANNATERIA\annateria-sync\annateria-backup\snapshots` has a new `snap-….bin` of more than a
     few hundred bytes (a copy of 145 bytes is the copy of an empty folder).
8. **The receiving PC takes it.** Press Ctrl+F5 there and type the code. The plate turns blue, then green, and the clients
   appear. An empty copy is never taken (the status bar says so), so a wrong order loses nothing.
9. **The flash copy.** Plug in the drive and run, in the backup dialog, section and buttons below; then eject the drive.
   - גיבוי ← כונן נייד (USB) ← בחירת תיקייה
   - גיבוי עכשיו ← בדיקת תקינות
10. **The phone.** In the inbox, the guide below; go through it once with her phone.
    - תיבת קלט ← איך מעבירים מהטלפון?
11. **For Anna:** the one-page Hebrew guide (an artifact, shared from its Share menu); go through it with her.

## After the visit

- [ ] Step 8.2 (`WORK_PLAN.md`).
- [ ] Record in `HANDOFF.md`: date, browser and Drive versions, drive letter, anything that differed (no client names, no
  amounts, no codes).

## What went wrong on 23 October

1. Anna's PC began with an empty data folder and sent an empty copy; Vitalik's PC, which held the clients, would have taken
   it. Fixed in the app (2f6bcc3): an empty copy is never taken.
2. The shared folder was named `annateria-sync`; Anna's PC chose it, Vitalik's PC chose the folder above it (My Drive), and
   each PC started its own store. Fixed in the app: such a choice is refused and the right folder is named; and in this list:
   the shared folder is called `ANNATERIA`, and both PCs must show the same name under the section.
