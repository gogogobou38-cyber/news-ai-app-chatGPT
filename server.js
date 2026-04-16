import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

// RSS取得
async function fetchRSS(url) {
  try {
    const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`);
    const data = await res.json();
    return data.items.slice(0, 5).map(i => ({
      title: i.title
    }));
  } catch {
    return [];
  }
}

// 記事パース
function parseArticle(text){
  const get = (key) => {
    const m = text.match(new RegExp(`【${key}】([\\s\\S]*?)(?=【|$)`));
    return m ? m[1].trim() : "";
  };

  return {
    title: get("タイトル"),
    summary: get("要約"),
    body: get("本文"),
    points: get("ポイント")
  };
}

// API
app.get("/api/news", async (req, res) => {
  const tag = req.query.tag || "AI";

  const sources = [
    { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews" },
    { name: "BBC", url: "https://feeds.bbci.co.uk/news/rss.xml" },
    { name: "Google News", url: `https://news.google.com/rss/search?q=${tag}&hl=ja&gl=JP` }
  ];

  const all = await Promise.all(sources.map(s => fetchRSS(s.url)));

  const cleaned = all.map(items =>
    items
      .map(a => a.title)
      .filter(t => t.length > 20)
      .slice(0, 3)
  );

  const text = sources.map((s, i) =>
    `[${i+1}] ${s.name}\n` + cleaned[i].map(t => "- " + t).join("\n")
  ).join("\n\n");

  const prompt = `
あなたはプロのニュース編集者です。

${text}

以下の形式で記事を作成してください：

【タイトル】
30文字以内

【要約】
80文字以内

【本文】
3〜5段落

【ポイント】
・3つ
`;

  const aiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );

  const aiData = await aiRes.json();
  const raw = aiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

  const parsed = parseArticle(raw);

  res.json({
    ...parsed,
    sources
  });
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
