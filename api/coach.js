// Vercel serverless function.
// Place this file at:  api/coach.js  (in your project root, next to /src)
// Vercel auto-detects anything in /api as a serverless endpoint — no config needed.
//
// In your Vercel project settings, add an environment variable:
//   ANTHROPIC_API_KEY = sk-ant-...your key...
// Never put the key in frontend code — this file runs on Vercel's servers,
// never in the visitor's browser, so the key stays private.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY. Set it in your Vercel project's environment variables." });
    return;
  }

  const { statsBrief } = req.body || {};
  if (!statsBrief) {
    res.status(400).json({ error: "Missing statsBrief in request body." });
    return;
  }

  const prompt = `You are an elite Valorant esports coach reviewing a player's last 25 ranked matches. Be sharp, specific, and non-generic — cite the actual numbers given, don't give vague advice. Data:
${JSON.stringify(statsBrief, null, 2)}

Respond with ONLY raw JSON (no markdown fences, no preamble) in exactly this shape:
{"callsign":"a short tactical nickname (2-4 words) for this player's current playstyle, based on the data","summary":"two sentences on their current form","strengths":[{"title":"short label","detail":"1-2 sentences citing specific numbers"}],"weaknesses":[{"title":"short label","detail":"1-2 sentences citing specific numbers"}],"actionTips":["specific actionable tip","tip 2","tip 3"],"mentalGame":"1-2 sentences of mindset advice tied to their streak or rank pressure"}
Include exactly 2 strengths and exactly 2 weaknesses.`;

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => "");
      res.status(anthropicRes.status).json({ error: `Anthropic API error (${anthropicRes.status}): ${errText.slice(0, 300)}` });
      return;
    }

    const data = await anthropicRes.json();
    const textBlock = data.content?.find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "No analysis text was returned by the model." });
      return;
    }

    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Coach analysis failed on the server." });
  }
}