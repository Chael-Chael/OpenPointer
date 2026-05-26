export type VoiceCommandKind = 'execute' | 'cancel' | 'summarize' | 'translate' | 'rewrite' | 'fill' | 'compare' | 'add-context' | 'unknown';

export type VoiceCommand = {
  kind: VoiceCommandKind;
  text: string;
  confidence: number;
};

const COMMANDS: Array<{ kind: VoiceCommandKind; patterns: RegExp[] }> = [
  { kind: 'execute', patterns: [/^(execute|confirm|run|do it)$/i, /^(执行|确认|运行)$/] },
  { kind: 'cancel', patterns: [/^(cancel|stop|never mind)$/i, /^(取消|停止|算了)$/] },
  { kind: 'summarize', patterns: [/\b(summarize|summary)\b/i, /(总结|概括)/] },
  { kind: 'translate', patterns: [/\btranslate\b/i, /(翻译)/] },
  { kind: 'rewrite', patterns: [/\b(rewrite|polish|improve)\b/i, /(改写|润色|正式一点)/] },
  { kind: 'fill', patterns: [/\b(fill|insert|put it here)\b/i, /(填到这里|填入|放这里)/] },
  { kind: 'compare', patterns: [/\b(compare|contrast)\b/i, /(比较|对比)/] },
  { kind: 'add-context', patterns: [/\b(add|capture).*(context|region)\b/i, /(加入上下文|把这个区域)/] }
];

export function parseVoiceCommand(text: string): VoiceCommand {
  const normalized = text.trim();
  for (const command of COMMANDS) {
    if (command.patterns.some((pattern) => pattern.test(normalized))) {
      return { kind: command.kind, text: normalized, confidence: 0.86 };
    }
  }
  return { kind: 'unknown', text: normalized, confidence: normalized.length > 0 ? 0.35 : 0 };
}
