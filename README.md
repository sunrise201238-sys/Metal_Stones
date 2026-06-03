# 地金価値 簡単確認 (Metal & Stone Value Checker)

A clean, static web app that splits a jewelry item's price into **metal value** and **stone value**, using a built‑in daily gold/platinum price database. Runs entirely on GitHub Pages — no server needed.

商品価格を「金属の価値」と「石の価値」に分けて表示するシンプルな静的サイトです。GitHub Pages だけで動きます。

---

## What's in this folder

| File | Upload to GitHub? | Purpose |
|------|:--:|---------|
| `index.html` | ✅ | The page |
| `styles.css` | ✅ | Styling |
| `app.js` | ✅ | Calculator + database + edit logic |
| `prices.json` | ✅ | The gold/platinum price database (195 days) |
| `config.js` | ✅ | **You edit this** — your GitHub repo + edit password |
| `README.md` | ✅ (optional) | This guide |
| `.claude/` | ❌ | Local preview server only — not needed online |

---

## The calculation (how the split works)

```
net metal weight = total weight (g) − total carat × 0.2     (1 carat = 0.2 g)
metal value      = price/g on the date × purity factor × net metal weight
                     · Gold     purity factor = karat ÷ 24   (K18 → 0.75)
                     · Platinum purity factor = parts ÷ 1000 (Pt850 → 0.85)
stone value      = item price − metal value
stone /carat     = stone value ÷ total carat
```

The price for the chosen date uses the most recent entry **on or before** that date (same as the Excel `VLOOKUP`), so weekends/holidays fall back to the latest weekday.

---

## Part A — Put the site online (one time)

> GitHub Pages on a **free** account requires a **public** repository. Since security isn't a concern here, that's fine — just know `config.js` (including the edit password) will be publicly visible. Your GitHub **token is never stored in the repo**.

### 1. Create the repository
1. Go to <https://github.com/new>
2. **Repository name:** e.g. `metal-stone` (remember this — it goes in `config.js`)
3. Choose **Public**
4. Click **Create repository**

### 2. Upload the files
1. On the new repo page click **uploading an existing file**
2. Drag in: `index.html`, `styles.css`, `app.js`, `prices.json`, `config.js` (and `README.md`)
3. Click **Commit changes**

### 3. Fill in `config.js`
1. In the repo, click `config.js` → the **pencil (Edit)** icon
2. Set your values:
   ```js
   owner: 'your-github-username',
   repo:  'metal-stone',
   ```
3. (Optional) change `editPassword` to whatever you like
4. **Commit changes**

### 4. Turn on GitHub Pages
1. Repo **Settings** → **Pages** (left sidebar)
2. **Source:** *Deploy from a branch*
3. **Branch:** `main`, folder `/ (root)` → **Save**
4. Wait ~1 minute. Your site appears at:
   ```
   https://your-github-username.github.io/metal-stone/
   ```

Open that URL — the calculator and database should work immediately. ✅

---

## Part B — Enable the Edit button (GitHub token)

The **編集 (Edit)** screen saves price changes straight back to your repo. For that it needs a GitHub token **once per browser**.

### Create a fine‑grained token
1. Go to <https://github.com/settings/personal-access-tokens/new>
2. **Token name:** `metal-stone-edit`
3. **Expiration:** your choice (e.g. 90 days or longer)
4. **Repository access:** *Only select repositories* → pick your `metal-stone` repo
5. **Permissions** → **Repository permissions** → **Contents** → **Read and write**
6. **Generate token** and **copy it** (you only see it once — starts with `github_pat_`)

### Use it
1. Open your site → **地金価格データベース** tab → **編集**
2. Enter the password (default: `metal2026`)
3. Edit any price, or add a new date with the top row → **行を追加**
4. Paste the token into **GitHub トークン**
   - Tick **このブラウザにトークンを保存** to avoid re‑pasting next time (stored only in *your* browser)
5. Click **GitHubに保存**

You'll see a success message. GitHub Pages rebuilds in **1–2 minutes**, after which everyone sees the new prices. The calculator on your current screen updates instantly.

---

## 使い方（毎日の操作）

1. **計算** タブで、購入日・金属・純度・全体重量・カラット・商品価格を入力 → 自動で「金属価値」と「石の価値」が表示されます。
2. **地金価格データベース** タブで価格一覧を確認できます。
3. 価格を更新するときは **編集** → パスワード → 値を直し → トークンを貼って **GitHubに保存**。

---

## Customizing

- **Change the edit password:** edit `editPassword` in `config.js` and commit.
- **Add more dates regularly:** use the in‑app editor (easiest), or edit `prices.json` directly on GitHub. Keep the format `{ "date": "YYYY-MM-DD", "gold": 0, "platinum": 0 }`.
- **`netJapan` values** (`Au` / `Pt` per gram) in `prices.json` are reserved for the future resale‑value feature.

---

## Preview locally (optional, Windows)

This repo includes a tiny PowerShell static server for testing before you push:

```powershell
powershell -ExecutionPolicy Bypass -File .claude/server.ps1 -Port 8123
# then open http://localhost:8123/
```

(Opening `index.html` directly as a file won't work because the app fetches `prices.json` over HTTP.)

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Edit save says *config.js の owner / repo を設定してください* | You didn't fill `owner`/`repo` in `config.js`. |
| Save says **認証エラー（401）** | Token is wrong/expired, or lacks **Contents: Read and write** on this repo. |
| Save says **HTTP 404** | `owner`/`repo`/`branch` in `config.js` don't match the actual repo. |
| New prices don't show after saving | Wait 1–2 min for GitHub Pages to rebuild, then refresh. |
| Page is blank | Confirm Pages is enabled (Settings → Pages) and you opened the `.../repo-name/` URL. |
