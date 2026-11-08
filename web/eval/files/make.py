# Writes the synthetic documents of the eval's reading mode (run-eval --read). Every name, number and amount is invented and
# matches the records of its case in eval/cases. Run with a Python that has pymupdf (the lab's venv):
#   D:\ANNATERIA-LAB\venv\Scripts\python web/eval/files/make.py
import pathlib

import pymupdf

HERE = pathlib.Path(__file__).parent


def receipt(name, lines):
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    for x, y, size, text in lines:
        page.insert_text((x, y), text, fontsize=size)
    doc.set_metadata({"title": "synthetic eval document"})
    doc.save(str(HERE / name))


# foreign-currency.json: an invoice in USD, no VAT, addressed to the client.
receipt("saas-sep.pdf", [
    (50, 60, 22, "Overseas Soft Inc"),
    (50, 85, 10, "100 Example Road, Austin, TX 78701, USA"),
    (50, 130, 18, "Invoice"),
    (50, 160, 11, "Invoice number: US-551"),
    (50, 178, 11, "Invoice date: September 3, 2026"),
    (50, 196, 11, "Currency: USD"),
    (50, 230, 11, "Bill to: Levi Plumbing Ltd, Israel"),
    (50, 280, 11, "Software subscription, monthly        1        $50.00        $50.00"),
    (50, 320, 11, "Subtotal  $50.00"),
    (50, 338, 11, "Tax (0%)  $0.00"),
    (50, 356, 12, "Total  USD 50.00"),
    (50, 420, 9, "Synthetic document for a software test."),
])
print("written")
