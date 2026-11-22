"""Extract selected pages locally for edition, contents and page-number review."""

import argparse
from pathlib import Path

import pymupdf


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("pdf", type=Path)
parser.add_argument("pages", metavar="PDF_PAGE", type=int, nargs="+")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = root / "data-private" / "textbook-review"
output.mkdir(parents=True, exist_ok=True)

with pymupdf.open(args.pdf) as document:
    if any(number < 1 or number > len(document) for number in args.pages):
        parser.error(f"Choose PDF page numbers between 1 and {len(document)}")
    print(f"{args.pdf.name}: {len(document)} PDF pages")
    for number in sorted(set(args.pages)):
        page = document[number - 1]
        name = f"{args.pdf.stem}-pdf-{number:03d}"
        text = page.get_text()
        (output / (name + ".txt")).write_text(text, encoding="utf-8")
        if not text.strip():
            page.get_pixmap(dpi=100).save(output / (name + ".png"))
        print(f"PDF page {number}: {len(text.strip())} extracted characters")
