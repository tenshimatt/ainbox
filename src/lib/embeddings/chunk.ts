/**
 * PRD §7.8 Embedding pipeline — chunking
 *
 * Splits arbitrary text into roughly token-sized chunks before embedding.
 * Token counting is approximated by characters (~4 chars per token, so
 * ~500 tokens ≈ ~2000 chars). This is intentionally a coarse proxy — we
 * don't ship a tokenizer dependency for an offline approximation.
 *
 * Strategy:
 *  1. Normalise whitespace.
 *  2. Try to split on paragraph boundaries (\n\n) first to keep semantic
 *     units intact.
 *  3. If a paragraph is larger than the chunk size, split on sentence
 *     boundaries (./!/?).
 *  4. If still too large, hard-cut by character count.
 *
 * Empty input and whitespace-only input return [].
 */
export interface ChunkOpts {
  /** Target token count per chunk. Defaults to 500. */
  tokens?: number;
  /**
   * Approximate characters per token. Used to convert tokens → char budget.
   * Default 4. (English prose averages ~4 chars/token under bge tokenizers.)
   */
  charsPerToken?: number;
}

export function chunkText(text: string, opts: ChunkOpts = {}): string[] {
  const tokens = opts.tokens ?? 500;
  const cpt = opts.charsPerToken ?? 4;
  const maxChars = Math.max(1, tokens * cpt);

  if (typeof text !== 'string') return [];
  const normalised = text.replace(/\r\n/g, '\n').trim();
  if (!normalised) return [];

  const paragraphs = normalised.split(/\n{2,}/);
  const out: string[] = [];
  let buf = '';

  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  };

  for (const p of paragraphs) {
    const para = p.trim();
    if (!para) continue;

    // If para alone exceeds limit, recurse via sentence/character splitter.
    if (para.length > maxChars) {
      flush();
      for (const piece of splitOversized(para, maxChars)) {
        out.push(piece);
      }
      continue;
    }

    // Add to current buffer if it fits, else flush and start a new one.
    if (buf.length + para.length + 2 <= maxChars) {
      buf = buf ? `${buf}\n\n${para}` : para;
    } else {
      flush();
      buf = para;
    }
  }
  flush();
  return out;
}

function splitOversized(text: string, maxChars: number): string[] {
  // Sentence-aware split first.
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if (s.length > maxChars) {
      // Hard char split.
      if (buf) {
        out.push(buf.trim());
        buf = '';
      }
      for (let i = 0; i < s.length; i += maxChars) {
        out.push(s.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if (buf.length + s.length + 1 <= maxChars) {
      buf = buf ? `${buf} ${s}` : s;
    } else {
      out.push(buf.trim());
      buf = s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}
