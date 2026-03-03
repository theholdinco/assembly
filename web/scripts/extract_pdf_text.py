#!/usr/bin/env python3
import sys, json, base64, tempfile, os
import pdfplumber

def extract(pdf_path):
    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            pages.append({"page": i + 1, "text": text})
    return {"pages": pages, "total_pages": len(pages)}

if __name__ == "__main__":
    b64 = sys.stdin.read()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(base64.b64decode(b64))
        tmp_path = f.name
    try:
        result = extract(tmp_path)
        json.dump(result, sys.stdout)
    finally:
        os.unlink(tmp_path)
