# 員工線上測驗系統（純靜態 + Supabase）

## 部署步驟

1. **建立資料庫**：Supabase → SQL Editor → 貼上 `sql/schema.sql` 全部內容 → Run。
2. **填入連線資訊**：編輯 `js/config.js`，填入 Project URL 與 **anon / publishable key**（Project Settings → API）。
   - 絕對不要放 `service_role` key。
3. **Auth 設定**：Authentication → URL Configuration，把 Site URL 設為你的 GitHub Pages 網址。若不想做 Email 驗證，可在 Providers → Email 關閉 Confirm email。
4. **建立管理者**：先在網站註冊一個帳號，再到 SQL Editor 執行：
   ```sql
   update public.profiles set role = 'admin' where email = '你的管理者Email';
   ```
5. 把整個資料夾內容用網頁上傳到 GitHub，開啟 Settings → Pages 即可。
6. 登入管理後台 → 「科目與及格分數」新增科目 → 「題庫匯入與管理」匯入考古題。

## 資安設計
| 風險 | 對策 |
|---|---|
| API key 外洩 | 前端只放公開的 anon key；資料權限完全由資料庫 RLS 控管，沒有任何 secret 在前端 |
| 題庫/答案被偷看 | `questions` 資料表只有管理者可讀；考試中的考卷由 `start_exam()` 產生，不含答案；交卷後才能讀自己的明細 |
| 分數被竄改 | 評分在資料庫 `submit_exam()` 完成，前端只能送出作答 |
| 自行升級為管理者 | `profiles.role` 無更新權限，註冊一律為 user，管理者只能在 SQL Editor 指定 |
| 看到別人成績 | RLS：使用者只能讀自己的考試與紀錄 |
| 刷題庫 | 同科目 24 小時最多開考 10 次（`schema.sql` 的 `c_max_per_day` 可調整） |
| XSS | 所有動態內容經 `App.esc()` 跳脫；CSP 限制只載入同源腳本與 Supabase；第三方函式庫已下載到 `js/vendor/`，不依賴 CDN |
| CSV 公式注入 | 匯出 CSV 時自動防護 |
| 登入狀態 | 使用 sessionStorage，關閉分頁即登出 |

> GitHub Pages 無法設定 HTTP 標頭，因此 CSP 以 `<meta>` 設定。請定期到 Supabase 的 Security Advisor 檢查。

## 不重複出題機制
- 每次開考動態抽題，**優先抽該員工沒考過的題目**，題庫用完才重複。
- 題目順序、選項順序每次隨機打亂；答案位置會跟著重新計算。
- 以「題目＋選項順序」雜湊產生卷別碼（如 `B-3F9A2C`），與該員工過去卷別相同會自動重抽。

## 題庫匯入格式
- **Excel / CSV**：欄位 `題目、選項A、選項B、選項C、選項D、（選項E）、答案、解析`，後台可下載範本。
- **PDF / TXT**：需為可選取文字的檔案（掃描圖片無法解析），格式：
  ```
  1. 題目文字
  A. 選項一
  B. 選項二
  C. 選項三
  D. 選項四
  答案：B
  解析：說明（可省略）
  ```
- 匯入前會預覽並列出有問題的題目；同科目內容相同的題目會自動略過。
