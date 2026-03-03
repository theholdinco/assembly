import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

interface PdfPage {
  page: number;
  text: string;
}

interface PdfTextResult {
  pages: PdfPage[];
  totalPages: number;
}

function resolveScriptPath(): string {
  // Try __dirname first (works in CJS / compiled worker)
  if (typeof __dirname !== "undefined") {
    // Compiled: worker/dist/lib/clo/extraction/ → scripts is at web/scripts/
    const fromDirname = path.resolve(__dirname, "../../../../scripts/extract_pdf_text.py");
    if (existsSync(fromDirname)) return fromDirname;
    // Also try: relative to __dirname for dev mode (lib/clo/extraction/ → scripts/)
    const fromDirname2 = path.resolve(__dirname, "../../../scripts/extract_pdf_text.py");
    if (existsSync(fromDirname2)) return fromDirname2;
  }
  // Fallback: relative to cwd (works when running from web/ directory)
  return path.resolve(process.cwd(), "scripts/extract_pdf_text.py");
}

function findPython(): string {
  // In Docker/production, python binary may be "python" not "python3"
  return process.env.PYTHON_BIN || "python3";
}

export async function extractPdfText(base64: string): Promise<PdfTextResult> {
  const scriptPath = resolveScriptPath();
  const pythonBin = findPython();

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin, [scriptPath], {
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
      reject(new Error(`Failed to spawn ${pythonBin}: ${err.message}`));
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
