export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || text.length > 2000) {
    return res.status(400).json({ error: 'טקסט חסר או ארוך מדי' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const prompt = `אתה מנתח רשימות קניות בעברית. נתח את הטקסט הבא וחלץ כל מוצר.

קטגוריות אפשריות (השתמש רק בהן בדיוק):
ירקות ופירות, מוצרי חלב וביצים, לחם ומאפים, בשר עוף ודגים, שימורים ויבשים, קפואים, משקאות, ניקיון ותכשירים, טיפוח ובריאות, אחר

טקסט: "${text.replace(/"/g, "'")}"

החזר אך ורק מערך JSON בלי שום טקסט נוסף:
[{"name":"שם המוצר","quantity":1,"unit":"יח'","category":"קטגוריה"}]

כללים:
- אם אין כמות → quantity=1
- אם אין יחידה → unit="יח'"
- שמות מוצרים בעברית בלבד
- רק JSON, ללא markdown`;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!upstream.ok) {
    const err = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json({ error: err.error?.message || 'שגיאת AI' });
  }

  const data  = await upstream.json();
  const raw   = data.content[0].text.trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return res.status(500).json({ error: 'תשובה לא תקינה מה-AI' });

  let items;
  try { items = JSON.parse(match[0]); }
  catch { return res.status(500).json({ error: 'JSON לא תקין מה-AI' }); }

  return res.status(200).json({ items });
}
