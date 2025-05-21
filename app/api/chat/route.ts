import { retrieve } from '@/lib/rag';

export async function POST(req: Request) {
  const { messages } = await req.json();
  const userQuestion = messages[messages.length - 1]?.content ?? '';

  // 1️⃣  fetch top articles
  const topDocs = await retrieve(userQuestion);

  // 2️⃣  build system prompt
  const context = topDocs
    .map(
      (d) => `Article ${d.id} – ${d.title}\n${d.text}`,
    )
    .join('\n\n---\n\n');

  const openaiRes = await fetch(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              'You are a legal assistant. Answer ONLY from the provided Cyprus Companies Law (Cap 113) context. Quote the article number when relevant.',
          },
          { role: 'system', content: context },
          ...messages,
        ],
      }),
    },
  ).then((r) => r.json());

  const answer =
    openaiRes.choices?.[0]?.message?.content ??
    'Sorry, I could not find a relevant article.';

  return new Response(answer, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
