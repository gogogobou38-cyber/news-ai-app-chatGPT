server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const PORT = 3000;

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
    const m = text.match(new RegExp(`【${key}】([\\s\\S]*?)(?=
