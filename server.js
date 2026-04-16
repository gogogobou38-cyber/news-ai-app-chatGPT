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

async function fetchRSS(url) {
  try {
    const res = await fetch(
      `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`
    );
    const data = await res.json();

    if (!data.items || !Array.isArray(data.items)) {
      return [];
    }

    return data.items.slice(0, 5).map((i) => ({
      title: i.title || "",
      link: i.link || "",
    }));
  } catch (e) {
    console.error("RSS fetch error:", url, e);
    return [];
  }
}

function parseArticle(text) {
  const get = (key) => {
    const m = text.match(new RegExp(`【${key}】([\\s\\S]*?)(?=【|$)`));
    return m ? m[1].trim() : "";
  };

  return {
    title: get("タイトル"),
    summary: get("要約"),
    body: get("本文"),
    points: get("ポイント"),
  };
}

app.get("/api/news", async (req, res) => {
  try {
    const tag = req.query.tag || "AI";

    const sources = [
      { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews" },
      { name: "BBC", url: "https://feeds.bbci.co.uk/news/rss.xml" },
      {
        name: "Google News",
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(tag)}&hl=ja&gl=JP&ceid=JP:ja`,
      },
    ];

    const all = await Promise.all(sources.map((s) => fetchRSS(s.url)));

    const cleaned = all.map((items) =>
      items
        .map((a) => a.title)
        .filter((t) => typeof t === "string" && t.length > 10)
        .slice(0, 3)
    );

    const text = sources
      .map(
        (s, i) =>
          `[${i + 1}] ${s.name}\n` +
          (cleaned[i].length ? cleaned[i].map((t) => `- ${t}`).join("\n") : "- 該当ニュースなし")
      )
      .join("\n\n");

    const prompt = `
あなたはプロのニュース編集者です。
以下の複数ニュースを読み、1本の読みやすい記事に整理してください。

${text}

必ず次の形式で返してください。

【タイトル】
30文字以内

【要約】
80文字以内

【本文】
3〜5段落

【ポイント】
・重要点を3つ
`;

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const aiText = await aiRes.text();

    if (!aiRes.ok) {
      console.error("Gemini API error:", aiRes.status, aiText);
      return res.status(500).json({
        title: "Geminiエラー",
        summary: `APIエラー: ${aiRes.status}`,
        body: aiText.slice(0, 500),
        points: "・APIキーや利用制限を確認してください",
        sources,
      });
    }

    let aiData;
    try {
      aiData = JSON.parse(aiText);
    } catch (e) {
      console.error("Gemini JSON parse error:", aiText);
      return res.status(500).json({
        title: "AIレスポンス解析エラー",
        summary: "Geminiの返答をJSONとして読めませんでした",
        body: aiText.slice(0, 500),
        points: "・ログを確認してください",
        sources,
      });
    }

    const raw =
      aiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const parsed = parseArticle(raw);

    res.json({
      title: parsed.title || `${tag}の最新ニュース`,
      summary: parsed.summary || "AIの要約を取得できませんでした。",
      body: parsed.body || raw || "本文を生成できませんでした。",
      points: parsed.points || "・AI出力形式が想定と異なりました",
      sources,
    });
  } catch (e) {
    console.error("Server route error:", e);
    res.status(500).json({
      title: "サーバーエラー",
      summary: "ニュースの生成に失敗しました。",
      body: String(e),
      points: "・server.js のログを確認してください",
      sources: [],
    });
  }
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
