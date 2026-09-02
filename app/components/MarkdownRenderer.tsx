'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  // Pre-process content:
  let cleanContent = content
    // 1. Unescape literal \n into real newlines
    .replace(/\\n/g, '\n')
    // 2. Fix broken LaTeX escapes like '$\ ' or '\$' that create '$\' artifacts
    .replace(/\\\$/g, '$')
    // 3. Fix dangling '$\' or '$ \'
    .replace(/\$\s*\\(?!\w)/g, '$')
    // 4. Ensure space after closing bold/code if needed
    .replace(/\*\*([^*]+)\*\*/g, '**$1**');

  // Convert raw backtick code blocks inside table rows into inline formatted text so they don't break markdown tables
  cleanContent = cleanContent.split('\n').map(line => {
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      return line.replace(/```(?:text|cpp|java|python|c|js)?([\s\S]*?)```/g, (_match, code) => {
        return code.trim().replace(/\n/g, '<br/>');
      });
    }
    return line;
  }).join('\n');

  return (
    <div className="prose-message">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={{
          table: ({ children }) => (
            <div className="table-container">
              <table className="markdown-table">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="markdown-thead">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="markdown-tr">{children}</tr>,
          th: ({ children }) => <th className="markdown-th">{children}</th>,
          td: ({ children }) => <td className="markdown-td">{children}</td>,
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !className && typeof children === 'string' && !children.includes('\n');
            if (isInline) {
              return <code className="markdown-inline-code" {...props}>{children}</code>;
            }
            return (
              <div className="code-block-wrapper">
                {match && <span className="code-lang-tag">{match[1]}</span>}
                <pre className="markdown-pre">
                  <code className="markdown-code" {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },
          h1: ({ children }) => <h3 className="markdown-h1">{children}</h3>,
          h2: ({ children }) => <h4 className="markdown-h2">{children}</h4>,
          h3: ({ children }) => <h5 className="markdown-h3">{children}</h5>,
          ul: ({ children }) => <ul className="markdown-ul">{children}</ul>,
          ol: ({ children }) => <ol className="markdown-ol">{children}</ol>,
          li: ({ children }) => <li className="markdown-li">{children}</li>,
          p: ({ children }) => <p className="markdown-p">{children}</p>,
          blockquote: ({ children }) => <blockquote className="markdown-blockquote">{children}</blockquote>,
          strong: ({ children }) => <strong className="markdown-strong">{children}</strong>,
          br: () => <br />,
        }}
      >
        {cleanContent}
      </ReactMarkdown>
    </div>
  );
}
