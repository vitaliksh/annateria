# The month cycle

What Anna does, in order, by the real buttons. Labels are from `web/index.html`. Each label stands on its own line, in Hebrew only.
If a label here is not on the screen, the app or this file is wrong: fix it.

**Every step ends with the same three questions.** Was it obvious what to do next? Did the screen say what happened? Would a bookkeeper who
has never seen the code trust it?

## 1. Start

Open the page and check the build marker at the bottom of the sidebar. Choose the data folder, enter the code, and see the plate turn green.

- בחירת תיקיית נתונים
- כניסה

## 2. Open a client and a month

A month you click shows closed until you press reopen; there is no question. It closes by itself when you leave it, or on a reload. A month made today
for a new client starts open. A new client: the form asks for the name and the activity (both required), home or office, the VAT and advance periods,
the VAT number, the advance percent, PCN, and the first month.

- כל הלקוחות
- + לקוח חדש
- פתיחה מחדש

## 3. Bring in the documents

Drop or choose files: photos, HEIC, scanned PDFs, Excel. No AI runs here. A file already seen is skipped by its hash.

- תיבת קלט
- בחר קבצים
- בדוק סריקות מהטלפון

## 4. Run the agent

Press the button, answer the cards. Before you look at its rows, have your own reading ready (rule 3 of the skill).

- בדוק מסמכים חדשים
- מה נשאר?

Check: every document is a row, every file with rows is attached as the original, questions are about real doubts and not about the client or the month.

## 5. Import cards

Rivhit's journal, the codes ledger, the operations ledger and the income report arrive as cards with a wizard. The agent imports nothing.
Drop them into the inbox of the open month and press the check button: each file gets a card with a button. A journal goes into the month it names;
a missing month is created, a closed one is opened after a question and closed again. Rivhit's operations ledger holds the codes too: load them in the
journal wizard's first step, or from the ledger check's own button, before the journals. Then run the ledger check: it lists what the journals miss.

- בדיקה וייבוא
- טעינת כרטסת קודי מיון של הלקוח…
- טעינת קודי המיון מהכרטסת הזו
- הבא
- ייבוא
- הוספה

## 6. Review every row

Open the original of each row and compare it with your reading. Date, supplier, supplier number, document number, allocation number, gross, net, VAT, currency,
account, percentages, active or not. Fix by hand what is wrong, and count each fix.

PCN clients: yellow rows above the ceiling need the tick, and a missing allocation number blocks the file.

VAT month: try the column on a late document. Moving VAT writes a line in the other month.

## 7. Reports

Read each on screen and compare with Rivhit: VAT slip, advances, profit and loss, ledger, documents PDF, PCN874 for a PCN client.

- דוחות
- הצגה והדפסה
- שמירת כל המסמכים
- שמירת קובץ PCN874

## 8. Close

The lock is in the month's menu, the three dots next to the reports button.

- נעילת הצהרה

Then leave the month and return: nothing should change. Try to write into it through the agent: it must refuse.

## 9. Backup and the other PC

In the lab, use the test folders only: `drive` as the shared folder and `usb` as the flash drive. Press the cloud icon and wait for the tick. Then restore into an
empty folder and compare every client with the source. Never make a new recovery code on real data.

- גיבוי
- בחירת תיקייה
- גיבוי עכשיו
- בחירת תיקיית יעד ריקה ושחזור

## 10. Finish

Check that the agent's run log, the copy of the table before the agent and the status line all say what really happened.

## Harder days (use after the first clean exam)

- A new client from nothing, in the order of the trade rules.
- A scan of many pages above the 20 MiB limit; a blurred photo; a HEIC; a rotated page.
- A duplicate across months; a credit note; a mixed invoice; foreign currency; a document of a closed month; another client's invoice.
- A chart of a client that has no vehicle or internet account.
- Internet drops in mid-run; the token expires; folder permission is lost; the tab is reloaded in mid-run; the run is stopped.
- Two PCs: pass the baton, take the other's copy, start anyway.
