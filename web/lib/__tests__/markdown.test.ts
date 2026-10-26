import { describe, it, expect } from "vitest";
import { marked } from "marked";
import { renderMarkdown, isSafeUrl } from "../markdown";

describe("renderMarkdown", () => {
  it("renders ordinary markdown exactly like the default marked instance", () => {
    const samples = [
      "# Title\n\nSome **bold** and _italic_ text with `code`.",
      "- one\n- two\n\n1. first\n2. second",
      "| a | b |\n|---|---|\n| 1 | 2 |",
      "[link](https://example.com/path?x=1) and ![img](/images/x.png \"t\")",
      "> quote\n\n```ts\nconst x = a < b && c > d;\n```",
      "Relative [doc](./notes.md), [anchor](#section), [mail](mailto:a@example.com)",
    ];
    for (const s of samples) {
      expect(renderMarkdown(s)).toBe(marked.parse(s, { async: false }) as string);
    }
  });

  it("shows raw HTML as text instead of passing it through", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"> and <script>alert(1)</script>');
    expect(html).not.toMatch(/<img|<script/i);
    expect(html).toContain("&lt;img src=x onerror=");

    const block = renderMarkdown('<div onmouseover="alert(1)">x</div>\n\ntext');
    expect(block).not.toMatch(/<div/i);
  });

  it("neutralises script-capable link and image URLs", () => {
    for (const md of [
      "[c](javascript:alert(1))",
      "[c](JAVASCRIPT:alert(1))",
      "[c](java\tscript:alert(1))",
      "[c](data:text/html;base64,PHNjcmlwdD4=)",
      "[c](vbscript:msgbox(1))",
      "![i](javascript:alert(1))",
    ]) {
      const out = renderMarkdown(md);
      expect(out).not.toMatch(/(javascript|vbscript|data):/i);
    }
  });

  it("classifies URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("/relative/path")).toBe(true);
    expect(isSafeUrl("#frag")).toBe(true);
    expect(isSafeUrl("mailto:a@example.com")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl(" javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("&#106;avascript:alert(1)")).toBe(false);
  });

  it("handles empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });
});
