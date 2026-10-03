// 題庫匯入解析：Excel(xlsx/xls) / CSV / PDF / TXT → 統一題目格式
// 所有解析都在瀏覽器本機完成，檔案不會上傳到任何第三方
window.Importer = (function () {
  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_ROWS = 2000;
  const LETTERS = 'ABCDE';

  const norm = s => String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const key = s => norm(s).toLowerCase().replace(/[\s_\-]/g, '');

  const ALIASES = {
    content: ['題目', '題幹', '試題', 'question', 'content', 'q'],
    a: ['選項a', 'a', 'optiona', 'option1', '選項1'],
    b: ['選項b', 'b', 'optionb', 'option2', '選項2'],
    c: ['選項c', 'c', 'optionc', 'option3', '選項3'],
    d: ['選項d', 'd', 'optiond', 'option4', '選項4'],
    e: ['選項e', 'e', 'optione', 'option5', '選項5'],
    answer: ['答案', '正確答案', '解答', 'answer', 'ans'],
    explanation: ['解析', '說明', '錯誤說明', '詳解', 'explanation', 'note']
  };

  function parseAnswer(v) {
    const s = norm(v).toUpperCase();
    if (/^[A-E]$/.test(s)) return LETTERS.indexOf(s);
    if (/^[1-5]$/.test(s)) return Number(s) - 1;
    return -1;
  }

  // 組成標準題目並驗證；rawOptions 長度 5（空字串代表沒有該選項）
  function build(lineNo, content, rawOptions, answerRaw, explanation) {
    content = norm(content);
    const err = m => ({ line: lineNo, error: m, content });
    if (!content) return err('缺少題目');
    if (content.length > 2000) return err('題目超過 2000 字');
    const ansIdx = parseAnswer(answerRaw);
    if (ansIdx < 0) return err('答案格式錯誤（需為 A-E 或 1-5）');
    const opts = []; let newAns = -1;
    rawOptions.forEach((o, i) => {
      const t = norm(o);
      if (t) { if (i === ansIdx) newAns = opts.length; opts.push(t.slice(0, 500)); }
    });
    if (opts.length < 2) return err('至少需要 2 個選項');
    if (newAns < 0) return err('答案對應的選項是空的');
    return { line: lineNo, content, options: opts, answer_index: newAns, explanation: norm(explanation).slice(0, 2000) };
  }

  /* ---------- Excel / CSV ---------- */
  async function parseSheet(file) {
    if (typeof XLSX === 'undefined') throw new Error('Excel 解析元件未載入');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    if (rows.length < 2) throw new Error('檔案沒有資料');

    const header = rows[0].map(key);
    const col = {};
    Object.entries(ALIASES).forEach(([f, names]) => {
      const i = header.findIndex(h => names.includes(h));
      if (i >= 0) col[f] = i;
    });
    if (col.content === undefined || col.answer === undefined)
      throw new Error('找不到必要欄位「題目」「答案」，請參考範本檔的欄位名稱');

    return rows.slice(1).map((r, i) => ({ r, line: i + 2 }))
      .filter(x => x.r.some(c => norm(c)))
      .map(({ r, line }) => build(line, r[col.content],
        ['a', 'b', 'c', 'd', 'e'].map(k => col[k] === undefined ? '' : r[col[k]]),
        r[col.answer], col.explanation === undefined ? '' : r[col.explanation]));
  }

  /* ---------- PDF / TXT 純文字 ---------- */
  async function pdfToText(file) {
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF 解析元件未載入');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      const byY = new Map();
      tc.items.forEach(it => {
        if (!it.str) return;
        const y = Math.round(it.transform[5] / 3); // 容許些微高低差
        if (!byY.has(y)) byY.set(y, []);
        byY.get(y).push({ x: it.transform[4], s: it.str });
      });
      [...byY.keys()].sort((a, b) => b - a).forEach(y =>
        lines.push(byY.get(y).sort((a, b) => a.x - b.x).map(i => i.s).join('')));
    }
    return lines.join('\n');
  }

  // 文字格式：
  //   1. 題目…            (編號可用 1. / 1、/ 1) / 第1題)
  //   A. 選項 …  B. …  C. …  D. …
  //   答案：B
  //   解析：…
  function parseText(text) {
    const lines = text.replace(/\r/g, '').split('\n').map(l => l.normalize('NFKC').trim()).filter(Boolean);
    const qStart = /^(?:第\s*)?(\d{1,4})\s*(?:題|[.、)．])\s*(.*)$/;
    const optRe = /^[(（]?([A-Ea-e])[)）.、．:：]\s*(.*)$/;
    const ansRe = /^(?:正確答案|答案|解答|answer|ans)\s*[:：]?\s*\(?([A-Ea-e1-5])\)?/i;
    const expRe = /^(?:解析|說明|錯誤說明|詳解|explanation)\s*[:：]?\s*(.*)$/i;

    const blocks = []; let b = null, field = null;
    for (const line of lines) {
      let m;
      if ((m = line.match(ansRe))) { if (b) { b.answer = m[1]; field = null; } continue; }
      if ((m = line.match(expRe))) { if (b) { b.explanation = m[1]; field = 'explanation'; } continue; }
      if (b && (m = line.match(optRe)) && LETTERS.indexOf(m[1].toUpperCase()) === b.opts.filter(o => o !== undefined).length) {
        b.opts[LETTERS.indexOf(m[1].toUpperCase())] = m[2]; field = 'opt' + LETTERS.indexOf(m[1].toUpperCase()); continue;
      }
      if ((m = line.match(qStart)) && (!b || b.answer !== undefined || b.opts.length === 0 || Number(m[1]) === b.no + 1)) {
        b = { no: Number(m[1]), content: m[2], opts: [], answer: undefined, explanation: '' };
        blocks.push(b); field = 'content'; continue;
      }
      if (!b) continue;
      // 續行
      if (field === 'content') b.content += ' ' + line;
      else if (field === 'explanation') b.explanation += ' ' + line;
      else if (field && field.startsWith('opt')) b.opts[Number(field.slice(3))] += ' ' + line;
    }
    return blocks.map(x => build(x.no, x.content, [0, 1, 2, 3, 4].map(i => x.opts[i] || ''), x.answer || '', x.explanation));
  }

  async function parse(file) {
    if (!file) throw new Error('請選擇檔案');
    if (file.size > MAX_BYTES) throw new Error('檔案超過 10MB');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let items;
    if (['xlsx', 'xls', 'csv'].includes(ext)) items = await parseSheet(file);
    else if (ext === 'pdf') items = parseText(await pdfToText(file));
    else if (ext === 'txt') items = parseText(await file.text());
    else throw new Error('不支援的檔案格式（支援 xlsx / xls / csv / pdf / txt）');
    if (!items.length) throw new Error('沒有解析到任何題目，請確認格式（可下載範本）');
    if (items.length > MAX_ROWS) throw new Error(`單次最多匯入 ${MAX_ROWS} 題，請分檔匯入`);
    return { valid: items.filter(i => !i.error), errors: items.filter(i => i.error) };
  }

  const TEMPLATE = [
    ['題目', '選項A', '選項B', '選項C', '選項D', '答案', '解析'],
    ['公司資訊安全政策中，下列何者是正確的密碼使用方式？', '多個系統共用同一組密碼', '定期更換並使用足夠長度的密碼', '把密碼寫在螢幕旁便利貼', '與同事分享密碼', 'B', '密碼應定期更換、足夠複雜且不與他人共用。'],
    ['收到可疑的釣魚郵件時，應該如何處理？', '點開附件確認內容', '轉寄給所有同事提醒', '不點擊連結並通報資安單位', '直接回覆寄件者詢問', 'C', '可疑郵件不應互動，應通報資安單位處理。']
  ];

  return { parse, parseText, TEMPLATE };
})();
