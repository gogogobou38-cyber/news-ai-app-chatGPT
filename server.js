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

    return data.items.slice(0, 6).map((item) => ({
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

// GeminiレスポンスからJSON抽出
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

// 見出し整形
function cleanupItems(items) {
  return items
    .filter((item) => item.title && item.title.length >= 8)
    .map((item) => ({
      ...item,
      title: item.title.replace(/\s+/g, " ").trim(),
    }))
    .slice(0, 14);
}

// Gemini呼び出し
async function callGemini(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
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
      sources.map((source) => fetchRSS(source.url, source.name))
    );

    const allItems = cleanupItems(fetched.flat());

    if (!allItems.length) {
      return res.json({
        topics: [
          {
            id: `${tag}-empty`,
            tag,
            title: `${tag}のニュースを取得できませんでした`,
            summary: "ソース取得に失敗したか、該当ニュースがありませんでした。",
            body: "しばらくしてから再読み込みしてください。",
            points: "・RSS取得に失敗した可能性\n・該当ニュースが少ない可能性",
            sources: [],
          },
        ],
      });
    }

    const headlinesText = allItems
      .map((item, idx) => `[${idx + 1}] ${item.source} | ${item.title}`)
      .join("\n");

    const prompt = `
あなたはニュース整理AIです。
以下のニュース見出しを読み、同じ話題ごとに最大3トピックへ分類してください。
その上で、各トピックについて短い要約を作ってください。

ルール:
- 別の話題は絶対に混ぜない
- 似ているニュースだけを同じトピックにまとめる
- 最大3トピック
- 日本語
- 長文記事は書かない
- 簡潔に
- 出力はJSONのみ
- コードブロックなし

入力見出し:
${headlinesText}

返却JSON形式:
{
  "topics": [
    {
      "topic_title": "話題タイトル",
      "summary": "短い要約",
      "points": "・ポイント1\\n・ポイント2\\n・ポイント3",
      "headline_numbers": [1,2,5]
    }
  ]
}
`;

    const raw = await callGemini(prompt);
    const jsonText = extractJson(raw);

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      console.error("JSON parse error:", raw);
      throw new Error("AIレスポンスの解析に失敗しました");
    }

    let topicList = Array.isArray(parsed.topics) ? parsed.topics : [];

    // 保険：1個しか返ってこなかった時の最低限分割
    if (topicList.length <= 1 && allItems.length >= 6) {
      topicList = [
        {
          topic_title: "主要トピック 1",
          summary: "注目ニュースを整理した要約です。",
          points: "・主要見出しを整理\n・同テーマを集約\n・詳細は元記事参照",
          headline_numbers: [1, 2]
        },
        {
          topic_title: "主要トピック 2",
          summary: "関連ニュースをまとめた要約です。",
          points: "・関連見出しを整理\n・別トピックとして分離\n・詳細は元記事参照",
          headline_numbers: [3, 4]
        },
        {
          topic_title: "主要トピック 3",
          summary: "別の話題として整理した要約です。",
          points: "・独立した話題を分離\n・重要点を抽出\n・詳細は元記事参照",
          headline_numbers: [5, 6]
        }
      ];
    }

    const topics = topicList.slice(0, 3).map((topic, index) => {
      const nums = Array.isArray(topic.headline_numbers)
        ? topic.headline_numbers
            .map((n) => Number(n))
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= allItems.length)
        : [];

      const groupedItems = nums.map((n) => allItems[n - 1]).filter(Boolean);

      return {
        id: `${tag}-${index + 1}`,
        tag,
        title: topic.topic_title || `${tag}の話題`,
        summary: topic.summary || "",
        body: topic.summary || "",
        points: topic.points || "・詳細は元記事を確認してください",
        sources: groupedItems.map((item) => ({
          name: item.source,
          url: item.link,
          title: item.title,
        })),
      };
    }).filter((topic) => topic.sources.length > 0);

    if (!topics.length) {
      return res.json({
        topics: [
          {
            id: `${tag}-fallback`,
            tag,
            title: `${tag}の主要ニュース`,
            summary: "AI分類に失敗したため、ニュース一覧を表示しています。",
            body: "AI分類に失敗したため、ニュース一覧を表示しています。",
            points: allItems.slice(0, 5).map((item) => `・${item.title}`).join("\n"),
            sources: allItems.slice(0, 5).map((item) => ({
              name: item.source,
              url: item.link,
              title: item.title,
            })),
          },
        ],
      });
    }

    return res.json({ topics });
  } catch (error) {
    console.error("Server route error:", error);
    return res.status(500).json({
      topics: [
        {
          id: "error",
          tag: "error",
          title: "サーバーエラー",
          summary: "ニュースの生成に失敗しました。",
          body: String(error),
          points: "・server.js のログを確認してください",
          sources: [],
        },
      ],
    });
  }
});

app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
