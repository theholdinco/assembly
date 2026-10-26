"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { parseFollowUpResponse, getLoadingMessage } from "@/lib/follow-up-rendering";
import { findAvatarUrl } from "@/lib/character-utils";
import AttachmentWidget, { type AttachedFile } from "@/components/AttachmentWidget";
import { useAssemblyAccess } from "@/lib/assembly-context";

interface HighlightChatProps {
  assemblyId: string;
  characters: string[];
  avatarUrlMap?: Record<string, string>;
  currentPage: string;
  defaultCharacter?: string;
  defaultMode?: "ask-assembly" | "ask-character" | "ask-library" | "debate";
}

export default function HighlightChat({
  assemblyId,
  characters,
  avatarUrlMap = {},
  currentPage,
  defaultCharacter,
  defaultMode = "ask-assembly",
}: HighlightChatProps) {
  const accessLevel = useAssemblyAccess();
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedText, setHighlightedText] = useState("");
  const [question, setQuestion] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isChallenge, setIsChallenge] = useState(false);
  const [responseText, setResponseText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  const handleSelection = useCallback((e: MouseEvent) => {
    if (panelRef.current?.contains(e.target as Node)) return;

    const sel = window.getSelection()?.toString().trim();
    if (sel && sel.length > 5) {
      const target = e.target as HTMLElement;
      if (target.closest?.(".markdown-content")) {
        setHighlightedText(sel);
        setIsOpen(true);
        setResponseText("");
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener("mouseup", handleSelection);
    return () => document.removeEventListener("mouseup", handleSelection);
  }, [handleSelection]);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) setIsOpen(false);
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen]);

  const mode = defaultCharacter ? "ask-character" : defaultMode;

  async function handleSubmit(challengeOverride?: boolean) {
    if (!question.trim() || isStreaming) return;

    const useChallenge = challengeOverride ?? isChallenge;
    setIsStreaming(true);
    setIsChallenge(useChallenge);
    setResponseText("");

    let fileRefs: { name: string; type: string; content: string }[] = [];
    if (attachedFiles.length > 0) {
      fileRefs = await Promise.all(
        attachedFiles.map(async (af) => ({
          name: af.file.name,
          type: af.file.type || "text/plain",
          content: await af.file.text(),
        }))
      );
    }

    const body = {
      question: question.trim(),
      mode,
      characters: defaultCharacter ? [defaultCharacter] : [],
      context: { page: currentPage },
      highlightedText: highlightedText || undefined,
      challenge: useChallenge,
      files: fileRefs.length > 0 ? fileRefs : undefined,
    };

    const res = await fetch(`/api/assemblies/${assemblyId}/follow-ups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) {
      setResponseText("Error: Failed to get response");
      setIsStreaming(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "searching") {
            setIsSearching(true);
          }
          if (data.type === "text") {
            setIsSearching(false);
            accumulated += data.content;
            setResponseText(accumulated);
          }
          if (data.type === "done") {
            setIsStreaming(false);
          }
        } catch {
          // skip
        }
      }
    }

    setIsStreaming(false);
  }

  const speakerBlocks = responseText
    ? parseFollowUpResponse(responseText, characters)
    : [];

  const loadingMsg = getLoadingMessage(mode, isChallenge);

  if (accessLevel === "read") return null;

  return (
    <>
      <div
        ref={panelRef}
        className={`highlight-chat-panel ${isOpen ? "open" : ""}`}
        id="highlight-chat-panel"
      >
        <div className="panel-header">
          <h3>
            {defaultCharacter
              ? `Ask ${defaultCharacter}`
              : currentPage === "references"
                ? "Explore Babylon's Library"
                : "Ask the Panel"}
          </h3>
          <button
            className="panel-collapse-btn"
            onClick={() => setIsOpen(false)}
            title="Collapse panel"
          >
            &#8250;
          </button>
        </div>

        {highlightedText && (
          <div className="panel-quote">{highlightedText}</div>
        )}

        <div style={{ padding: "0 0.75rem 0.75rem" }}>
          <AttachmentWidget files={attachedFiles} onChange={setAttachedFiles} disabled={isStreaming} />

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <textarea
              ref={textareaRef}
              className="follow-up-input"
              value={question}
              onChange={(e) => { setQuestion(e.target.value); autoResize(); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={
                defaultCharacter
                  ? `Ask ${defaultCharacter} about this...`
                  : "Ask about this text..."
              }
              rows={2}
              style={{ resize: "none", overflow: "hidden" }}
              disabled={isStreaming}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <button
                className="follow-up-button"
                onClick={() => handleSubmit(false)}
                disabled={isStreaming || !question.trim()}
              >
                {isStreaming ? loadingMsg : "Ask"}
              </button>
              {defaultCharacter && (
                <button
                  className="follow-up-button"
                  onClick={() => handleSubmit(true)}
                  disabled={isStreaming || !question.trim()}
                  style={{
                    background: "var(--color-low)",
                    fontSize: "0.78rem",
                    padding: "0.4rem 0.8rem",
                  }}
                  title="Challenge this character to defend their position"
                >
                  {isStreaming && isChallenge ? "Preparing defense\u2026" : "\u2694 Challenge"}
                </button>
              )}
            </div>
          </div>
        </div>

        {isSearching && !responseText && (
          <div style={{ padding: "0.75rem", color: "var(--color-text-muted)", fontStyle: "italic", fontSize: "0.85rem" }}>
            Searching the web...
          </div>
        )}

        {responseText && (
          <div className={`panel-response-area${isStreaming ? " follow-up-streaming" : ""}`}>
            {speakerBlocks.length === 1 && !speakerBlocks[0].speaker ? (
              <div
                className="markdown-content"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(responseText),
                }}
              />
            ) : (
              speakerBlocks.map((block, i) => {
                const url = findAvatarUrl(block.speaker, avatarUrlMap);
                return (
                <div key={i} className="follow-up-exchange">
                  <div className="debate-speaker">
                    {url ? (
                      <img src={url} alt={block.speaker} style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover" }} />
                    ) : (
                      <span className="debate-speaker-dot" style={{ background: block.color }} />
                    )}
                    {block.speaker}
                  </div>
                  <div
                    className="debate-content"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(block.content),
                    }}
                  />
                </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <button
        className="panel-expand-tab"
        onClick={() => setIsOpen(true)}
        title="Expand chat panel"
        style={{ display: isOpen ? "none" : undefined }}
      >
        <span className="tab-icon">&#8249;</span> Ask
      </button>
    </>
  );
}
