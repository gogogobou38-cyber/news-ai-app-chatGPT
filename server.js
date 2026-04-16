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
async function fetchRSS(url, sourceName) {
  try {
    const res = await fetch(
      `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`
    );
    const data = await res.json();

    if (!data.items || !Array.isArray(data.items)) return [];

    return data.items.slice(0, 8).map((item) => ({
      title: item.title || "",
      link: item.link || "",
      pubDate: item.pubDate || "",
      source: sourceName,
    }));
  } catch (error) {
    console.error("RSS fetch error:", sourceName, error);
    return [];
  }
}

// AIレスポンスからJSONだけ抜く
function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const plain = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (plain) return plain[0].trim();

  return text.trim();
}

// タグごとのソース
function getSourcesByTag(tag) {
  const map = {
    "AI": [
      { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
      { name: "BBC Tech", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
      { name: "Google News", url: `https://news.google.com/rss/search?q=${encodeURIComponent(tag)}&hl=ja&gl=JP&ceid=JP:ja` }
    ],
    "半導体": [
      { name: "Reuters", url: "https://feeds.reuters.com/reuters/businessNews" },
      { name: "Bloomberg", url: "https://feeds.bloomberg.com/technology/news.rss" },
      { name: "Google News", url: `https://news.google.com/rss/search?q=${encodeURIComponent(tag)}&hl=ja&gl=JP&ceid=JP:ja` }
    ],
    "経済": [
      { name: "Reuters", url: "https://feeds.reuters.com/reuters/businessNews" },
      { name: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
      { name: "Google News", url: `https://news.google.com/rss/search?q=${encodeURIComponent(tag)}&hl=ja&gl=JP&ceid=JP:ja` }
    ],
    "日本": [
      { name: "NHK", url: "https://www3.nhk.or.jp/rss/news/cat0.xml" },
      { name: "Google News", url: `https://news.google.com/rss/search?q=${encodeURIComponent(tag)}&hl=ja&gl=JP&ceid=JP:ja` },
      { name: "Reuters", url: "https://feeds.reuters.com/reuters/worldNews" }
    ],
    "国内": [
      { name: "NHK", url: "https://www3.nhk.or.jp/rss/news/cat0.xml" },
      { name: "Google News", url: `https://news.google.com/rss/search?q=${encodeURIComponent(tag)}&hl=ja&gl=JP&ceid=JP:ja` },
      { name: "Reuters", url: "https://feeds.reuters.com/reuters/worldNews" }
    ],
    "国際": [
      { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
      { name: "Reuters", url: "https://feeds.reuters.com/reuters/worldNews" },
      { name: "Google News", url: `https://news.google.com/rss/search?q=${encodeURIComponent(tag)}&hl=ja&gl=JP&ceid=JP:ja` }
    ],
    "テクノロジー": [
      { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
      { name: "BBC Tech", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
      { name: "Google News", url: `https://news.google.com/rss/search?q=${encodeURIComponent(tag)}&hl=ja&gl=JP&ceid=JP:ja` }
    ],
    "ビジネス": [
      { name: "Reuters", url: "https://feeds.reuters.com/reuters/businessNews" },
      { name: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
      { name: "Google News", url: `https://news.google.com/rss/search?q=${encodeURIComponent(tag)}&hl=ja&gl=JP&ceid=JP:ja` }
    ]
  };

  return map[tag] || [
    { name: "Google News", url: `https://news.google.com/rss/search?q=${encodeURIComponent(tag)}&hl=ja&gl=JP&ceid=JP:ja` },
    { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews" },
    { name: "BBC", url: "https://feeds.bbci.co.uk/news/rss.xml" }
  ];
}

// 見出しの簡易整形
function cleanupItems(items) {
  return items
    .filter(item => item.title && item.title.length >= 8)
    .map(item => ({
      ...item,
      title: item.title.replace(/\s+/g, " ").trim()
    }))
    .slice(0, 20);
}

// Gemini呼び出し
async function callGemini(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Gemini JSON parse error: ${text}`);
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// API
app.get("/api/news", async (req, res) => {
  try {
    const tag = req.query.tag || "AI";
    const sources = getSourcesByTag(tag);

    const fetched = await Promise.all(
      sources.map(source => fetchRSS(source.url, source.name))
    );

    const allItems = cleanupItems(fetched.flat());

    if (!allItems.length) {
      return res.json({
        topics: [{
          id: `${tag}-empty`,
          tag,
          title: `${tag}のニュースを取得できませんでした`,
          summary: "ソース取得に失敗したか、該当ニュースがありませんでした。",
          body: "しばらくしてから再読み込みしてください。",
          points: "・RSS取得に失敗\n・ニュースが少ない可能性\n・タグ名を変えると改善する場合があります",
          sources: []
        }]
      });
    }

    const headlinesText = allItems
      .map((item, idx) => `[${idx + 1}] ${item.source} | ${item.title}`)
      .join("\n");

    const prompt = `
あなたは優秀なニュース編集者です。
以下の見出し群を、「同じ話題ごと」に3〜5個のトピックへ分類してください。

条件:
- 別の話題は絶対に混ぜない
- 似ているニュースだけ同じトピックにまとめる
- 1トピックにつき最低2件、できれば複数ソースを含める
- 日本語で返す
- 出力はJSONのみ
- コードブロックなし

入力見出し:
${headlinesText}

返却JSON形式:
{
  "topics": [
    {
      "topic_title": "トピック名",
      "headline_numbers": [1,2,5]
    }
  ]
}
`;

    const clusterRaw = await callGemini(prompt);
    const clusterJson = extractJson(clusterRaw);

    let clustered;
    try {
      clustered = JSON.parse(clusterJson);
    } catch (e) {
      console.error("cluster parse error:", clusterRaw);
      throw new Error("トピック分類の解析に失敗しました");
    }

    const topics = [];
    const topicList = Array.isArray(clustered.topics) ? clustered.topics : [];

    for (let i = 0; i < topicList.length; i++) {
      const topic = topicList[i];
      const nums = Array.isArray(topic.headline_numbers)
        ? topic.headline_numbers
            .map(n => Number(n))
            .filter(n => Number.isInteger(n) && n >= 1 && n <= allItems.length)
        : [];

      const groupedItems = nums.map(n => allItems[n - 1]).filter(Boolean);

      if (groupedItems.length === 0) continue;

      const groupedText = groupedItems
        .map((item, idx) => {
          return `[${idx + 1}] ${item.source}\nタイトル: ${item.title}\nURL: ${item.link}`;
        })
        .join("\n\n");

      const articlePrompt = `
あなたはプロのニュース編集者です。
以下は「${topic.topic_title || tag}」に関する同一トピックの複数ニュースです。
別話題は混ぜず、同一テーマだけで1本の記事を作成してください。

入力:
${groupedText}

条件:
- 日本語
- 同じ話題だけで書く
- 事実ベース
- 憶測で話を広げない
- 読みやすく簡潔
- 出力はJSONのみ
- コードブロックなし

返却JSON形式:
{
  "title": "記事タイトル",
  "summary": "80文字前後の要約",
  "body": "本文。2〜4段落。",
  "points": "・ポイント1\\n・ポイント2\\n・ポイント3"
}
`;

      const articleRaw = await callGemini(articlePrompt);
      const articleJson = extractJson(articleRaw);

      let parsedArticle;
      try {
        parsedArticle = JSON.parse(articleJson);
      } catch {
        parsedArticle = {
          title: topic.topic_title || `${tag}の話題`,
          summary: "記事生成に失敗しました。",
          body: articleRaw || "記事本文を生成できませんでした。",
          points: "・AI出力の解析に失敗しました"
        };
      }

      topics.push({
        id: `${tag}-${i + 1}`,
        tag,
        title: parsedArticle.title || topic.topic_title || `${tag}の話題`,
        summary: parsedArticle.summary || "",
        body: parsedArticle.body || "",
        points: parsedArticle.points || "",
        sources: groupedItems.map(item => ({
          name: item.source,
          url: item.link,
          title: item.title
        }))
      });
    }

    if (!topics.length) {
      return res.json({
        topics: [{
          id: `${tag}-fallback`,
          tag,
          title: `${tag}の主要トピック`,
          summary: "トピック分類に失敗したため、暫定記事を表示しています。",
          body: allItems.map(item => `・${item.source}: ${item.title}`).join("\n"),
          points: "・分類処理に失敗\n・見出し一覧を表示\n・再試行で改善する場合があります",
          sources: allItems.slice(0, 5).map(item => ({
            name: item.source,
            url: item.link,
            title: item.title
          }))
        }]
      });
    }

    return res.json({ topics });
  } catch (error) {
    console.error("Server route error:", error);
    return res.status(500).json({
      topics: [{
        id: "error",
        tag: "error",
        title: "サーバーエラー",
        summary: "ニュースの生成に失敗しました。",
        body: String(error),
        points: "・server.js のログを確認してください",
        sources: []
      }]
    });
  }
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
