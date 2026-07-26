// Vercel serverless function: /api/generate
// Keeps the Anthropic API key on the server. The browser never sees it.
// Requires an environment variable named ANTHROPIC_API_KEY to be set in
// Vercel: Project Settings > Environment Variables.
//
// For calls that need guaranteed structured JSON back (like content pillars),
// pass a "tool" object { name, description, input_schema } instead of relying
// on prefill. Claude's current models don't support assistant-message prefill,
// but forced tool use guarantees a schema-shaped response, which is the
// correct modern approach for this.

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

  const { prompt, maxTokens, tool } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'Missing "prompt" in request body.' });
    return;
  }

  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens || 1500,
    messages: [{ role: 'user', content: prompt }]
  };

  if (tool && tool.name && tool.input_schema) {
    body.tools = [{
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.input_schema
    }];
    body.tool_choice = { type: 'tool', name: tool.name };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({ error: data.error?.message || 'Anthropic API request failed.' });
      return;
    }

    if (tool && tool.name){
      const toolBlock = (data.content || []).find((b) => b.type === 'tool_use');
      if (!toolBlock) {
        res.status(502).json({ error: 'Model did not return the expected structured response.' });
        return;
      }
      res.status(200).json({ toolInput: toolBlock.input });
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
