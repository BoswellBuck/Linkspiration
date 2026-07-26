// Vercel serverless function: /api/generate
// Keeps the Anthropic API key on the server. The browser never sees it.
// Requires an environment variable named ANTHROPIC_API_KEY to be set in
// Vercel: Project Settings > Environment Variables.

export const config = {
  maxDuration: 60, // generous timeout; some modules (like the About section) can take a while
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Add it in Vercel project settings.' });
    return;
  }

  const { prompt, maxTokens, prefill } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing "prompt" in request body.' });
    return;
  }

  const messages = [{ role: 'user', content: prompt }];
  if (prefill && typeof prefill === 'string') {
    messages.push({ role: 'assistant', content: prefill });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens || 1500,
        messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({ error: data.error?.message || 'Anthropic API request failed.' });
      return;
    }

    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unexpected server error.' });
  }
}
