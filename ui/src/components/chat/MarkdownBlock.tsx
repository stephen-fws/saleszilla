/**
 * Lightweight markdown renderer used by both per-potential ChatTab and the
 * global GlobalChatPanel. Handles headings (h1-h6), horizontal rules, fenced
 * code blocks, ASCII/unicode box-drawing diagrams, pipe tables, bullet/numbered
 * lists, paragraphs and inline bold (**text**).
 */

import type React from "react";

// Render bold markup inside a plain-text chunk (no URL parsing here — URLs are
// handled one level up in renderInline).
function renderBold(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let k = 0;
  while (remaining.length > 0) {
    const bi = remaining.indexOf("**");
    if (bi === -1) { parts.push(remaining); break; }
    if (bi > 0) parts.push(remaining.slice(0, bi));
    const end = remaining.indexOf("**", bi + 2);
    if (end === -1) { parts.push(remaining); break; }
    parts.push(<strong key={`${keyPrefix}-b${k++}`}>{remaining.slice(bi + 2, end)}</strong>);
    remaining = remaining.slice(end + 2);
  }
  return parts;
}

const LINK_CLS = "text-blue-600 hover:text-blue-700 underline underline-offset-2 break-all";

/**
 * Render inline markup: **bold**, [text](url) links, and bare http(s) URLs.
 * Bare URLs are made clickable automatically — important for agent responses
 * that often include citation links as plain text.
 */
export function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Combined: markdown link [text](url)  OR  bare http(s)://url
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>\]()]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(...renderBold(text.slice(last, m.index), `p${k}`));
    }
    if (m[1] && m[2]) {
      parts.push(
        <a key={`l${k++}`} href={m[2]} target="_blank" rel="noopener noreferrer" className={LINK_CLS}>
          {m[1]}
        </a>
      );
    } else if (m[3]) {
      // Trim trailing punctuation that's typically NOT part of the URL
      let url = m[3];
      const trailing = url.match(/[.,;:!?]+$/);
      let suffix = "";
      if (trailing) {
        suffix = trailing[0];
        url = url.slice(0, -suffix.length);
      }
      parts.push(
        <a key={`l${k++}`} href={url} target="_blank" rel="noopener noreferrer" className={LINK_CLS}>
          {url}
        </a>
      );
      if (suffix) parts.push(suffix);
    }
    last = re.lastIndex;
  }
  if (last < text.length) {
    parts.push(...renderBold(text.slice(last), `p${k}`));
  }
  return parts;
}

/**
 * compact=true — smaller, lighter style used in Panel 3 agent cards.
 *   Base: text-xs, text-slate-600 (matches Panel 1 filter item palette)
 *   Headings: same size but semibold/medium with slightly darker slate
 *
 * compact=false (default) — standard chat style: text-sm, heavier headings
 */
export default function MarkdownBlock({ content, compact = false }: { content: string; compact?: boolean }) {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // Skip orphan bullet markers / stray asterisks anywhere (e.g. "*", "**", "-")
    // Note: HR ("---", "***") is handled below and uses 3+ chars, so we cap here at 2.
    if (/^\s*[-*]{1,2}\s*$/.test(line)) { i++; continue; }

    // Headings (h1–h6). Accept both "# Heading" and "#Heading" (no space).
    const headingMatch = line.match(/^(#{1,6})\s*(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const cls = compact
        ? level <= 2
          ? "font-semibold text-slate-700 mt-2"
          : level === 3
            ? "font-medium text-slate-600 mt-1.5"
            : "font-medium text-slate-500 mt-1"
        : level <= 2
          ? "font-bold text-slate-900 mt-1"
          : level === 3
            ? "font-semibold text-slate-800 mt-1"
            : "font-medium text-slate-700 mt-0.5";
      nodes.push(<p key={i} className={cls}>{renderInline(text)}</p>);
      i++; continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      nodes.push(<hr key={i} className="border-slate-200 my-1" />);
      i++; continue;
    }

    // Fenced code block (``` ... ```)
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (lines[i]?.startsWith("```")) i++;
      nodes.push(
        <pre key={`code-${i}`} className="bg-slate-800 text-slate-100 rounded-lg px-3 py-2.5 text-xs overflow-x-auto whitespace-pre font-mono leading-relaxed">
          {codeLines.join("\n")}
        </pre>
      );
      continue;
    }

    // Box-drawing / diagram lines
    const BOX_RE = /[┌┐└┘│─┬┴┼┤├▶◀◁▷←→↑↓]/;
    if (BOX_RE.test(line)) {
      const diagramLines: string[] = [];
      while (i < lines.length && (BOX_RE.test(lines[i]) || (lines[i].trim() === "" && i + 1 < lines.length && BOX_RE.test(lines[i + 1])))) {
        diagramLines.push(lines[i]);
        i++;
      }
      nodes.push(
        <pre key={`diag-${i}`} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-xs overflow-x-auto whitespace-pre font-mono text-slate-700 leading-relaxed">
          {diagramLines.join("\n")}
        </pre>
      );
      continue;
    }

    // Pipe tables
    if (line.startsWith("|")) {
      const PIPE = "\u0000PIPE\u0000";
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        // Respect escaped pipes (\|) in cell content
        const escaped = lines[i].replace(/\\\|/g, PIPE);
        const cells = escaped
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim().split(PIPE).join("|"));
        rows.push(cells);
        i++;
      }
      const isseparator = (row: string[]) => row.every((c) => /^[-:\s]+$/.test(c));
      const [headerRow, ...bodyRows] = rows.filter((r) => !isseparator(r));
      if (headerRow) {
        nodes.push(
          <div key={`tbl-${i}`} className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  {headerRow.map((cell, ci) => (
                    <th key={ci} className="text-left px-2 py-1.5 bg-slate-200 font-semibold text-slate-700 border border-slate-300 whitespace-nowrap">
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2 py-1.5 border border-slate-200 text-slate-700 align-top">
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length) {
        const l = lines[i];
        // Skip orphan bullet markers ("*" or "-" alone) — treat as noise, not a new paragraph
        if (/^\s*[-*]\s*$/.test(l)) { i++; continue; }
        if (!/^\s*[-*]\s+/.test(l)) break;
        // Strip ONLY the leading bullet marker, preserve markdown (e.g. **bold**) in content
        items.push(
          <li key={i}>{renderInline(l.replace(/^\s*[-*]\s+/, ""))}</li>
        );
        i++;
      }
      nodes.push(<ul key={`ul-${i}`} className="list-disc pl-5 space-y-0.5 marker:text-slate-400">{items}</ul>);
      continue;
    }

    // Numbered list
    if (/^\d+[\.\)]\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\d+[\.\)]\s/.test(lines[i])) {
        items.push(
          <li key={i}>{renderInline(lines[i].replace(/^\d+[\.\)]\s+/, ""))}</li>
        );
        i++;
      }
      nodes.push(<ol key={`ol-${i}`} className="list-decimal pl-5 space-y-0.5 marker:text-slate-400">{items}</ol>);
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,6}/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\d+[\.\)]\s/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      nodes.push(
        <p key={`p-${i}`}>
          {paraLines.flatMap((l, j) => [
            ...renderInline(l),
            j < paraLines.length - 1 ? <br key={`br-${i}-${j}`} /> : null,
          ]).filter(Boolean)}
        </p>
      );
    } else {
      i++;
    }
  }

  return (
    <div className={compact ? "space-y-1 text-xs leading-relaxed text-slate-600" : "space-y-1.5 text-sm leading-normal"}>
      {nodes}
    </div>
  );
}
