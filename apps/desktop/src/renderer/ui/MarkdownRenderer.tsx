import { useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import mermaid from 'mermaid';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  themeVariables: {
    primaryColor: '#eef6ff',
    primaryTextColor: '#14213d',
    primaryBorderColor: '#6aa8ff',
    lineColor: '#3478f6',
    secondaryColor: '#f7fbff',
    tertiaryColor: '#ffffff',
    fontFamily: 'DM Sans, Segoe UI, system-ui, sans-serif'
  }
});

export function MarkdownRenderer({ value }: { value: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {value}
    </ReactMarkdown>
  );
}

const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const language = /language-([\w-]+)/.exec(className ?? '')?.[1];
    const content = String(children).replace(/\n$/, '');
    if (language === 'mermaid') return <MermaidDiagram chart={content} />;
    if (language) {
      return (
        <code className={`code-block language-${language}`} data-language={language} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="inline-code" {...props}>
        {children}
      </code>
    );
  }
};

function MermaidDiagram({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, '');
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setError(null);
    mermaid.render(`omp-mermaid-${id}`, chart)
      .then(({ svg }) => {
        if (canceled || !ref.current) return;
        ref.current.innerHTML = svg;
      })
      .catch((reason: unknown) => {
        if (canceled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      canceled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <pre className="mermaid-error">
        <code>{chart}</code>
      </pre>
    );
  }

  return <div ref={ref} className="mermaid-diagram" />;
}
