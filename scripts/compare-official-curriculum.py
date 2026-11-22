"""Compare the pinned candidate list with the Ministry's local Annex 9 HWP."""

import io
import json
import re
import struct
import zipfile
import zlib
from pathlib import Path

import olefile


ROOT = Path(__file__).resolve().parents[1]
CODE = r"\[9과\d{2}-\d{2}\]"


def paragraphs(hwp):
    with olefile.OleFileIO(io.BytesIO(hwp)) as document:
        compressed = document.openstream("FileHeader").read()[36] & 1
        sections = sorted(
            (path for path in document.listdir() if path[0] == "BodyText"),
            key=lambda path: int(path[1].removeprefix("Section")),
        )
        for path in sections:
            data = document.openstream(path).read()
            if compressed:
                data = zlib.decompress(data, -15)
            offset = 0
            while offset < len(data):
                record = struct.unpack_from("<I", data, offset)[0]
                offset += 4
                size = record >> 20
                if size == 0xFFF:
                    size = struct.unpack_from("<I", data, offset)[0]
                    offset += 4
                if record & 0x3FF == 67:
                    yield data[offset:offset + size].decode("utf-16le").strip()
                offset += size


def normalize(text):
    return re.sub(r"\s+", "", text)


private = ROOT / "data-private"
with zipfile.ZipFile(ROOT / "sources-private/curriculum/moe-2022-33-annexes-5-14.zip",
                     metadata_encoding="cp949") as archive:
    annex = next(name for name in archive.namelist() if "[별책9]" in name)
    lines = list(paragraphs(archive.read(annex)))

official = {}
for line in lines:
    # HWP paragraph text can carry an inline control before the visible code.
    # Anchor the passage after the code and compare the whole remaining text.
    match = re.search(rf"({CODE})\s+([^\r\n]+)$", line)
    if match:
        official.setdefault(match[1], []).append(match[2])

candidates = json.loads((private / "middle-science-review.json").read_text(encoding="utf-8"))
report = []
for row in candidates:
    passages = official.get(row["code"], [])
    equivalent = [text for text in passages if normalize(text) == normalize(row["candidate_text"])]
    report.append({
        "code": row["code"],
        "status": "whitespace-equivalent" if equivalent else "manual-review",
        "candidate_text": row["candidate_text"],
        "official_candidates": passages,
    })
missing_from_upstream = sorted(set(official) - {row["code"] for row in candidates})
(private / "official-curriculum-comparison.json").write_text(
    json.dumps({"comparisons": report, "codes_only_in_annex": missing_from_upstream},
               ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
)
matched = sum(row["status"] == "whitespace-equivalent" for row in report)
print(f"Annex codes: {len(official)}; matched: {matched}/{len(report)}; only in Annex: {len(missing_from_upstream)}")
