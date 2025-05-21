import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/* ───────────────────────────── paths ───────────────────────────── */
const articlesDir = path.join(process.cwd(), 'data/articles');
const embedDir    = path.join(process.cwd(), '.embeddings');

/* ───────────────────── cosine-similarity helper ─────────────────── */
function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] ** 2;
    nb  += b[i] ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

/* ───────────────────── text normaliser helper ──────────────────── */
function norm(text: string | string[]) {
  return Array.isArray(text) ? text.join('\n') : text;
}

/* ───────────────── embed(text) with disk cache ─────────────────── */
async function embed(textIn: string | string[]): Promise<number[]> {
  const text = norm(textIn);

  await fs.mkdir(embedDir, { recursive: true });
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  const file = path.join(embedDir, `${hash}.json`);

  /* cached? */
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { /* cache miss */ }

  /* request OpenAI */
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-ada-002',
      input: text.slice(0, 8000),          // trim huge inputs
    }),
  });

  /* handle non-JSON (e.g. HTML 404/401) */
  const raw = await res.text();
  let j: any = {};
  try { j = JSON.parse(raw); }
  catch {
    console.error('OpenAI returned non-JSON:\n', raw);
    throw new Error('Embedding request failed (non-JSON response).');
  }

  /* handle JSON error */
  if (!j.data) {
    console.error('Embedding API error:\n', j);
    throw new Error('Embedding request failed – see log.');
  }

  const vec: number[] = j.data[0].embedding;
  await fs.writeFile(file, JSON.stringify(vec));
  return vec;
}

/* ─────────────────────── load & embed docs ─────────────────────── */
type Doc = { id: string; title: string; text: string; vec: number[] };
let docsP: Promise<Doc[]> | null = null;

export async function getDocs(): Promise<Doc[]> {
  if (docsP) return docsP;
  docsP = (async () => {
    const files = await fs.readdir(articlesDir);
    const out: Doc[] = [];

    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const raw = JSON.parse(
        await fs.readFile(path.join(articlesDir, f), 'utf8'),
      ) as {
        article_number: string;
        title: string;
        content: string | string[];
      };

      const vec = await embed(raw.content);
      out.push({
        id:   raw.article_number,
        title: raw.title,
        text: norm(raw.content),
        vec,
      });
    }
    return out;
  })();
  return docsP;
}

/* ───────────────────── top-k similarity search ─────────────────── */
export async function retrieve(query: string, k = 3) {
  const qVec = await embed(query);
  const docs = await getDocs();
  return docs
    .map((d) => ({ d, score: cosine(qVec, d.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.d);
}
