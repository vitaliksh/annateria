"""Lets the development agent read an original before it looks at the agent's rows (rule 3 of the bookkeeper skill).

Runs on the lab's own Python: D:\\ANNATERIA-LAB\\venv\\Scripts\\python tools/doc.py ... Pictures go to D:\\ANNATERIA-LAB\\shots\\doc.

  doc.py pages <pdf>                     number of pages, and whether each has a text layer
  doc.py render <pdf|heic|image> [first] [last] [dpi]
  doc.py text <pdf> [first] [last]       the text layer
  doc.py sheet <xlsx> [max rows]         every sheet as tab-separated rows

Install once: python -m venv D:\\ANNATERIA-LAB\\venv, then pip install pymupdf openpyxl pillow pillow-heif.
"""
import pathlib
import sys

OUT = pathlib.Path(r"D:\ANNATERIA-LAB\shots\doc")


def pages(path):
    import fitz

    with fitz.open(path) as pdf:
        print(f"{len(pdf)} pages")
        for index, page in enumerate(pdf, 1):
            print(index, f"{page.rect.width:.0f}x{page.rect.height:.0f}", "text" if page.get_text().strip() else "image")


def render(path, first=1, last=None, dpi=110):
    OUT.mkdir(parents=True, exist_ok=True)
    source = pathlib.Path(path)
    stem = f"{abs(hash(source.name)) % 100000:05d}"
    if source.suffix.lower() == ".pdf":
        import fitz

        with fitz.open(path) as pdf:
            for number in range(first, min(last or first, len(pdf)) + 1):
                target = OUT / f"{stem}-{number:03d}.png"
                pdf[number - 1].get_pixmap(dpi=dpi).save(target)
                print(target)
        return
    from PIL import Image, ImageOps
    import pillow_heif

    pillow_heif.register_heif_opener()
    with Image.open(path) as image:
        picture = ImageOps.exif_transpose(image).convert("RGB")
        picture.thumbnail((1800, 1800))
        target = OUT / f"{stem}.png"
        picture.save(target)
        print(target)


def text(path, first=1, last=None):
    import fitz

    with fitz.open(path) as pdf:
        for number in range(first, min(last or len(pdf), len(pdf)) + 1):
            print(f"--- page {number}")
            print(pdf[number - 1].get_text())


def sheet(path, limit=100000):
    import openpyxl

    book = openpyxl.load_workbook(path, data_only=True)
    for worksheet in book.worksheets:
        print(f"--- {worksheet.title} {worksheet.dimensions}")
        for index, row in enumerate(worksheet.iter_rows(values_only=True)):
            if index >= limit:
                break
            if any(cell is not None for cell in row):
                print("\t".join("" if cell is None else str(cell) for cell in row))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    command, path, *rest = sys.argv[1:]
    numbers = [int(value) for value in rest]
    {"pages": pages, "render": render, "text": text, "sheet": sheet}[command](path, *numbers)


if __name__ == "__main__":
    main()
