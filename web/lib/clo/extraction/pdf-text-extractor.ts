import { spawn } from "child_process";
import path from "path";

interface PdfPage {
  page: number;
  text: string;
}

interface PdfTextResult {
  pages: PdfPage[];
  totalPages: number;
}

export async function extractPdfText(base64: string): Promise<PdfTextResult> {
  const scriptPath = path.resolve(process.cwd(), "scripts/extract_pdf_text.py");

  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pdfplumber extraction failed (exit ${code}): ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout) as { pages: PdfPage[]; total_pages: number };
        resolve({ pages: result.pages, totalPages: result.total_pages });
      } catch (e) {
        reject(new Error(`Failed to parse pdfplumber output: ${(e as Error).message}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn python3: ${err.message}`));
    });

    proc.stdin.write(base64);
    proc.stdin.end();
  });
}

export async function extractPdfTextForPages(
  base64: string,
  startPage: number,
  endPage: number,
): Promise<string> {
  const result = await extractPdfText(base64);
  return result.pages
    .filter((p) => p.page >= startPage && p.page <= endPage)
    .map((p) => p.text)
    .join("\n\n");
}
