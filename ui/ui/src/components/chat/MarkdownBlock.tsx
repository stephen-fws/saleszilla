/**
 * Markdown renderer used by per-potential ChatTab, GlobalChatPanel, and the
 * agent result tabs (Research, Solution, NextAction).
 *
 * Backed by `react-markdown` + `remark-gfm` so the heavy lifting (parsing
 * headings, lists, tables, code, blockquotes, strikethrough, autolinks, etc.)
 * is done by a real markdown engine. Visual styling is overlaid via the
 * `components` prop to match Salezilla's two density modes.
 *
 * Same exported interface as before:
 *   <MarkdownBlock content={...} compact={...} />
 * so all callers (ChatTab, GlobalChatPanel, AgentResultTab, MeetingBriefOverlay)
 * keep working unchanged.
 */

import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const LINK_CLS = "text-blue-600 hover:text-blue-700 underline underline-offset-2 break-all";

type CodeProps = ComponentPropsWithoutRef<"code"> & { inline?: boolean };

interface MarkdownBlockProps {
  content: string;
  /**
   * compact=true — smaller, lighter style used in Panel 3 agent cards.
   * compact=false (default) — standard chat style: text-sm, heavier headings.
   */
  compact?: boolean;
}

export default function MarkdownBlock({ content, compact = false }: MarkdownBlockProps) {
  // Sentinel-strip: if the agent wrapped the whole reply in a single ```md / ```markdown
  // fence (some do), unwrap so the parser sees the actual markdown.
  const cleaned = stripOuterMarkdownFence(content);

  // Density-aware class lookup. Each element gets explicit Tailwind classes
  // so we don't depend on a `prose` plugin and styling is local + predictable.
  const cls = compact ? COMPACT_CLS : DEFAULT_CLS;

  return (
    <div className={cls.root}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className={cls.h1}>{children}</h1>,
          h2: ({ children }) => <h2 className={cls.h2}>{children}</h2>,
          h3: ({ children }) => <h3 className={cls.h3}>{children}</h3>,
          h4: ({ children }) => <h4 className={cls.h4}>{children}</h4>,
          h5: ({ children }) => <h5 className={cls.h4}>{children}</h5>,
          h6: ({ children }) => <h6 className={cls.h4}>{children}</h6>,
          p: ({ children }) => <p className={cls.p}>{children}</p>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLS}>
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className={cls.ul}>{children}</ul>,
          ol: ({ children }) => <ol className={cls.ol}>{children}</ol>,
          li: ({ children }) => <li className={cls.li}>{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-slate-800">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          hr: () => <hr className="border-slate-200 my-2" />,
          blockquote: ({ children }) => (
            <blockquote className={cls.blockquote}>{children}</blockquote>
          ),
          code: ({ inline, className, children, ...props }: CodeProps) => {
            if (inline) {
              return (
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] font-mono text-slate-800" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="bg-slate-800 text-slate-100 rounded-lg px-3 py-2.5 text-xs overflow-x-auto whitespace-pre font-mono leading-relaxed">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead>{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="even:bg-slate-50">{children}</tr>,
          th: ({ children }) => (
            <th className="text-left px-2 py-1.5 bg-slate-200 font-semibold text-slate-700 border border-slate-300 whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-2 py-1.5 border border-slate-200 text-slate-700 align-top">
              {children}
            </td>
          ),
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}

// ── Density-aware style maps ────────────────────────────────────────────────

const COMPACT_CLS = {
  root: "space-y-1.5 text-xs leading-relaxed text-slate-600 [&>*:first-child]:mt-0",
  h1: "text-sm font-semibold text-slate-800 mt-3 mb-1",
  h2: "text-sm font-semibold text-slate-800 mt-3 mb-1",
  h3: "text-xs font-semibold text-slate-700 mt-2.5 mb-0.5",
  h4: "text-[11px] font-semibold uppercase tracking-wide text-slate-500 mt-2 mb-0.5",
  p: "",
  ul: "list-disc pl-5 space-y-0.5 marker:text-slate-400",
  ol: "list-decimal pl-5 space-y-0.5 marker:text-slate-400",
  li: "",
  blockquote: "border-l-2 border-slate-300 pl-3 text-slate-500 italic",
};

const DEFAULT_CLS = {
  root: "space-y-2 text-sm leading-normal text-slate-700 [&>*:first-child]:mt-0",
  h1: "text-base font-bold text-slate-900 mt-3 mb-1",
  h2: "text-base font-bold text-slate-900 mt-3 mb-1",
  h3: "text-sm font-semibold text-slate-800 mt-2.5 mb-1",
  h4: "text-xs font-semibold uppercase tracking-wide text-slate-600 mt-2 mb-0.5",
  p: "",
  ul: "list-disc pl-5 space-y-1 marker:text-slate-400",
  ol: "list-decimal pl-5 space-y-1 marker:text-slate-400",
  li: "",
  blockquote: "border-l-2 border-slate-300 pl-3 text-slate-600 italic",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Some agents wrap their entire reply in a fenced block tagged `markdown` /
 * `md`. The fence is meta — strip it so the parser sees the real content.
 * (If the model produces normal markdown, this is a no-op.)
 */
function stripOuterMarkdownFence(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : s;
}

/**
 * Re-export for callers that previously imported `renderInline` from this
 * module to render an arbitrary string with bold/link parsing. Now backed by
 * the full markdown parser — pass through and let it figure things out. The
 * compact wrapper keeps the line-level visual the same.
 */
export function renderInline(text: string) {
  return <MarkdownBlock content={text} compact />;
}
