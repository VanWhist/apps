/*
 * 体験申込ページ（apply.html）の動き
 * ------------------------------------------------------------
 * ・日程と残り人数は GAS（Google Apps Script）から読みます。
 * ・申込は GAS に送り、GAS が「その瞬間の空き」で 確定／キャンセル待ち を決めます。
 *   （画面の残り人数は目安。最終判断は必ず GAS 側）
 * ・data/apply-config.js の api が空のあいだは「確認モード」：
 *   見本の日程で動き、送信はこの画面の中だけで判定します（どこにも送りません）。
 *   確認モードでは URL の後ろに付けて、運営ルールの違いを試せます：
 *     ?confirm=manual  … コーチが確認してから確定（1B）
 *     ?full=waitlist   … 満員でもキャンセル待ちで受ける（2B）
 *     ?full=accept     … 満員でも受けてコーチが調整（2C）
 *     ?race=1          … 送信の直前に、最初に選んだ枠が他の人で埋まった場合
 */
(function () {
  'use strict';

  var CFG = window.APPLY_CONFIG || {};
  var API = String(CFG.api || '').trim();
  var DEMO = !API;
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var GRADES = ['年少', '年中', '年長', '小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', 'その他'];

  var state = {
    step: 1, settings: null, slots: [], byId: {}, picked: [], month: null,
    kids: [{ name: '', kana: '', grade: '' }],
    startedAt: Date.now(), requestId: null, requestKey: null, sending: false
  };

  // ---------- 小物 ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // 日付は 'YYYY-MM-DD' の文字のまま扱う（new Date('2026-12-05') は海外設定の端末で1日ずれるため使わない）
  function ymd(s) { var p = String(s).split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function wday(s) { var p = ymd(s); return new Date(p.y, p.m - 1, p.d).getDay(); }
  function md(s) { var p = ymd(s); return p.m + '/' + p.d + '（' + WD[wday(s)] + '）'; }
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ---------- 判定（GAS の Code.gs と同じ考え方。確認モードで使う） ----------
  var Core = {
    // 1つの枠について、空き rem・人数 need・設定 から状態を決める
    decide: function (rem, need, settings) {
      if (rem >= need) return settings.confirmMode === 'manual' ? '仮受付' : '確定';
      return settings.fullMode === 'accept' ? '要調整' : 'キャンセル待ち';
    },
    // 画面に出す枠の見え方
    view: function (slot, settings) {
      if (slot.status === '中止') return { cls: 'off', label: 'お休み', selectable: false };
      if (!slot.open) return { cls: 'off', label: '受付終了', selectable: false };
      var r = slot.remaining;
      if (r <= 0) {
        if (settings.fullMode === 'waitlist') return { cls: 'wait', label: '待ちで申込', selectable: true };
        if (settings.fullMode === 'accept') return { cls: 'wait', label: '満員・相談', selectable: true };
        return { cls: 'full', label: '満員', selectable: false };
      }
      return { cls: r <= 1 ? 'few' : 'ok', label: '残り' + r + '名', selectable: true };
    }
  };

  // ---------- 確認モード用の見本データ ----------
  var Demo = (function () {
    var q = new URLSearchParams(location.search);
    var settings = {
      confirmMode: q.get('confirm') === 'manual' ? 'manual' : 'auto',
      fullMode: ['waitlist', 'accept'].indexOf(q.get('full')) >= 0 ? q.get('full') : 'block',
      maxSlots: 3, maxKids: 4
    };
    var race = q.get('race') === '1';
    var slots = [];
    var seen = {};
    function todayJst() {
      var t = new Date(Date.now() + 9 * 3600e3); // 日本時間の「今日」
      return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
    }
    function fmt(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
    (function build() {
      var t = todayJst();
      var base = new Date(Date.UTC(t.y, t.m - 1, t.d));
      var n = 0;
      for (var i = 2; i <= 44; i++) { // 2日後〜約6週間（前日締切の想定）
        var dt = new Date(base.getTime() + i * 864e5);
        var s = fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
        var w = dt.getUTCDay();
        var times = w === 6 ? [['09:00', '10:00'], ['10:00', '11:00'], ['11:00', '12:00']] : w === 3 ? [['16:30', '17:30']] : [];
        times.forEach(function (tm) {
          n++;
          var cap = 2;
          var taken = (n % 5 === 0) ? 2 : (n % 3 === 0 ? 1 : 0); // 見本として 満員・残り1 を混ぜる
          var stopped = (w === 3 && n % 4 === 2);                  // 見本として お休み を混ぜる
          slots.push({ id: s.replace(/-/g, '') + '-' + tm[0].replace(':', ''), date: s, start: tm[0], end: tm[1],
            cls: 'キッズ', kind: '体験', capacity: cap, taken: taken, status: stopped ? '中止' : '公開', open: true });
        });
      }
    })();
    function pub() {
      return slots.map(function (s) {
        return { id: s.id, date: s.date, start: s.start, end: s.end, cls: s.cls, kind: s.kind,
          status: s.status, open: s.open, remaining: Math.max(0, s.capacity - s.taken) };
      });
    }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    return {
      slots: function () { return wait(400).then(function () { return { ok: true, settings: settings, slots: pub() }; }); },
      apply: function (p) {
        return wait(900).then(function () {
          if (seen[p.requestId]) return seen[p.requestId];         // 同じ送信は同じ結果
          if (race && p.slots.length) { var f = slots.find(function (s) { return s.id === p.slots[0]; }); if (f) f.taken = f.capacity; }
          var need = p.kids.length, results = [];
          p.slots.forEach(function (id) {
            var s = slots.find(function (x) { return x.id === id; });
            if (!s || s.status === '中止' || !s.open) { results.push({ id: id, status: '受付不可' }); return; }
            var st = Core.decide(s.capacity - s.taken, need, settings);
            if (st === '確定' || st === '仮受付' || st === '要調整') s.taken += need;
            results.push({ id: id, status: st });
          });
          var res = { ok: true, demo: true, appId: 'DEMO-' + String(Date.now()).slice(-6), results: results, settings: settings };
          seen[p.requestId] = res;
          return res;
        });
      }
    };
  })();

  // ---------- 通信 ----------
  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function apiSlots() { return DEMO ? Demo.slots() : getJson(API + '?action=slots'); }
  function apiApply(payload) {
    if (DEMO) return Demo.apply(payload);
    // text/plain で送ると、ブラウザの事前確認（CORS preflight）が起きず GAS がそのまま受け取れる
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  // ---------- 1. 日にち ----------
  function loadSlots() {
    return apiSlots().then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'load');
      state.settings = res.settings;
      state.slots = res.slots.slice().sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start); });
      state.byId = {};
      state.slots.forEach(function (s) { state.byId[s.id] = s; });
      state.picked = state.picked.filter(function (id) { var s = state.byId[id]; return s && Core.view(s, state.settings).selectable; });
      var months = monthsOf();
      if (!state.month || months.indexOf(state.month) < 0) {
        var firstOpen = state.slots.find(function (s) { return Core.view(s, state.settings).selectable; });
        state.month = firstOpen ? firstOpen.date.slice(0, 7) : months[0];
      }
      renderRule(); renderMonths(); renderSlots(); renderPicked(); renderBar();
    }).catch(function () {
      $('ap-slots').innerHTML = '<p class="ap-empty">日程を読み込めませんでした。時間をおいて開き直すか、下のお問合せからご連絡ください。</p>';
    });
  }
  function monthsOf() {
    var m = [];
    state.slots.forEach(function (s) { var k = s.date.slice(0, 7); if (m.indexOf(k) < 0) m.push(k); });
    return m;
  }
  function renderRule() {
    var st = state.settings, t = [];
    t.push('最大' + st.maxSlots + 'コマまで選べます（第1・第2希望をまとめて選べます）。');
    if (st.confirmMode === 'manual') t.push('お申込みのあと、コーチから確定のご連絡をします。');
    else t.push('空いていれば、申し込んだその場で確定します。');
    $('ap-rule').textContent = t.join('');
  }
  function renderMonths() {
    $('ap-months').innerHTML = monthsOf().map(function (k) {
      var p = ymd(k + '-01');
      return '<button type="button" role="tab" data-m="' + k + '" aria-selected="' + (k === state.month) + '">' + p.y + '年' + p.m + '月</button>';
    }).join('');
  }
  function renderSlots() {
    var days = {}, order = [];
    state.slots.forEach(function (s) {
      if (s.date.slice(0, 7) !== state.month) return;
      if (!days[s.date]) { days[s.date] = []; order.push(s.date); }
      days[s.date].push(s);
    });
    if (!order.length) { $('ap-slots').innerHTML = '<p class="ap-empty">この月の体験日程はまだありません。</p>'; return; }
    $('ap-slots').innerHTML = order.map(function (d) {
      var w = wday(d), p = ymd(d);
      var head = '<div class="ap-dd' + (w === 6 ? ' sat' : w === 0 ? ' sun' : '') + '">' + p.m + '/' + p.d + '<small>（' + WD[w] + '）</small></div>';
      var btns = days[d].map(function (s) {
        var v = Core.view(s, state.settings), on = state.picked.indexOf(s.id) >= 0;
        return '<button type="button" class="slot ' + v.cls + '" data-id="' + esc(s.id) + '"' +
          (v.selectable ? ' aria-pressed="' + on + '"' : ' disabled') +
          ' aria-label="' + esc(md(d) + ' ' + s.start + '〜 ' + s.cls + ' ' + v.label) + '">' +
          '<b>' + esc(s.start) + '〜</b><span>' + esc(v.label) + '</span></button>';
      }).join('');
      return '<div class="ap-day">' + head + '<div class="ap-times">' + btns + '</div></div>';
    }).join('');
  }
  function togglePick(id) {
    var i = state.picked.indexOf(id);
    if (i >= 0) state.picked.splice(i, 1);
    else {
      if (state.picked.length >= state.settings.maxSlots) { flashBar('選べるのは' + state.settings.maxSlots + 'コマまでです'); return; }
      state.picked.push(id);
    }
    state.picked.sort(function (a, b) { var x = state.byId[a], y = state.byId[b]; return (x.date + x.start).localeCompare(y.date + y.start); });
    renderSlots(); renderPicked(); renderBar();
  }
  function pickedText() {
    return state.picked.map(function (id) { var s = state.byId[id]; return md(s.date) + ' ' + s.start; }).join('、');
  }

  // ---------- 2. 参加する人 ----------
  function renderKids() {
    var max = state.settings ? state.settings.maxKids : 4;
    $('ap-kids').innerHTML = state.kids.map(function (k, i) {
      var opts = '<option value="">選んでください</option>' + GRADES.map(function (g) { return '<option' + (k.grade === g ? ' selected' : '') + '>' + g + '</option>'; }).join('');
      return '<fieldset class="ap-box" data-kid="' + i + '"><legend>参加するお子さま' + (state.kids.length > 1 ? '（' + (i + 1) + '人目）' : '') + '</legend>' +
        (i > 0 ? '<div class="ap-kid-h"><span></span><button type="button" class="ap-del" data-del="' + i + '">この人を外す</button></div>' : '') +
        '<label class="f">お名前<em>必須</em><input data-k="name" value="' + esc(k.name) + '" autocomplete="off" maxlength="40"></label>' +
        '<label class="f">ふりがな<em>必須</em><input data-k="kana" value="' + esc(k.kana) + '" autocomplete="off" maxlength="40"></label>' +
        '<label class="f">学年<em>必須</em><select data-k="grade">' + opts + '</select></label>' +
        '</fieldset>';
    }).join('');
    $('ap-add').hidden = state.kids.length >= max;
  }
  function readForm() {
    var f = $('ap-form');
    return {
      parentName: f.parentName.value.trim(), tel: f.tel.value.trim(), email: f.email.value.trim(), note: f.note.value.trim(),
      agreeTerms: f.agreeTerms.checked, agreePrivacy: f.agreePrivacy.checked, company: f.company.value
    };
  }
  function validate() {
    var errs = [], f = $('ap-form');
    Array.prototype.forEach.call(f.querySelectorAll('[aria-invalid]'), function (el) { el.removeAttribute('aria-invalid'); });
    function bad(el, msg) { if (el) el.setAttribute('aria-invalid', 'true'); if (errs.indexOf(msg) < 0) errs.push(msg); }
    Array.prototype.forEach.call(f.querySelectorAll('[data-kid]'), function (box) {
      ['name', 'kana', 'grade'].forEach(function (k) { var el = box.querySelector('[data-k="' + k + '"]'); if (!el.value.trim()) bad(el, 'お子さまのお名前・ふりがな・学年を入れてください'); });
    });
    var v = readForm();
    if (!v.parentName) bad(f.parentName, '保護者のお名前を入れてください');
    if (!/^[0-9０-９+\-－ー()（） ]{9,}$/.test(v.tel)) bad(f.tel, '電話番号を確認してください');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) bad(f.email, 'メールアドレスを確認してください');
    if (!v.agreeTerms || !v.agreePrivacy) bad(null, '「確認と同意」の2つにチェックを入れてください');
    $('ap-err2').textContent = errs.join('\n');
    if (errs.length) { var first = f.querySelector('[aria-invalid=true]'); if (first) first.focus(); }
    return !errs.length;
  }

  // ---------- 3. 確認・送信 ----------
  function payload() {
    var v = readForm();
    return {
      slots: state.picked.slice(),
      kids: state.kids.map(function (k) { return { name: k.name.trim(), kana: k.kana.trim(), grade: k.grade }; }),
      parent: { name: v.parentName, tel: v.tel, email: v.email, note: v.note },
      agree: v.agreeTerms && v.agreePrivacy, company: v.company,
      elapsedMs: Date.now() - state.startedAt
    };
  }
  function slotLine(id) { var s = state.byId[id]; return md(s.date) + ' ' + s.start + '〜' + s.end + ' ' + s.cls; }
  function group(title, body, step, focus) {
    return '<section class="ap-grp"><div class="ap-grp-h"><h3>' + title + '</h3>' +
      (step ? '<button type="button" class="ap-fix" data-goto="' + step + '"' + (focus ? ' data-focus="' + focus + '"' : '') + '>修正</button>' : '') + '</div>' + body + '</section>';
  }
  function renderConfirm() {
    var p = payload();
    var slots = '<ul class="ap-list">' + p.slots.map(function (id) { return '<li>' + esc(slotLine(id)) + '</li>'; }).join('') + '</ul>';
    var kids = '<ul class="ap-list">' + p.kids.map(function (k) { return '<li>' + esc(k.name) + '（' + esc(k.kana) + '）・' + esc(k.grade) + '</li>'; }).join('') + '</ul>';
    var parent = '<dl class="ap-dl"><dt>お名前</dt><dd>' + esc(p.parent.name) + '</dd><dt>電話</dt><dd>' + esc(p.parent.tel) + '</dd><dt>メール</dt><dd>' + esc(p.parent.email) + '</dd>' +
      (p.parent.note ? '<dt>ご質問</dt><dd>' + esc(p.parent.note) + '</dd>' : '') + '</dl>';
    $('ap-confirm').innerHTML =
      group('日にち（' + p.slots.length + 'コマ）', slots, 1) +
      group('参加する人（' + p.kids.length + '人）', kids, 2) +
      group('保護者の方', parent, 2, '#ap-parent') +
      '<p class="ap-msg">体験料は1人500円（当日現金）です。' + (p.kids.length > 1 ? '兄弟・姉妹は同じ時間にご一緒に参加します。' : '') + '</p>';
  }
  // 1の画面：選んだ日にちの一覧（×で外せる）
  function renderPicked() {
    var el = $('ap-picked');
    if (!state.picked.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<p class="ap-picked-h">選んだ日にち（' + state.picked.length + '/' + state.settings.maxSlots + '）</p><ul>' +
      state.picked.map(function (id) {
        return '<li><span>' + esc(slotLine(id)) + '</span><button type="button" class="ap-x" data-unpick="' + esc(id) + '" aria-label="' + esc(slotLine(id)) + 'を外す">×</button></li>';
      }).join('') + '</ul>';
  }
  // 2の画面：1で選んだ日にちを上に出す
  function renderChosen() {
    $('ap-chosen2').innerHTML = '<div class="ap-grp ap-grp-sm"><div class="ap-grp-h"><h3>✓ 選んだ日にち（' + state.picked.length + 'コマ）</h3><button type="button" class="ap-fix" data-goto="1">変更</button></div>' +
      '<ul class="ap-list">' + state.picked.map(function (id) { return '<li>' + esc(slotLine(id)) + '</li>'; }).join('') + '</ul></div>';
  }
  function send() {
    if (state.sending) return;                       // 連打しても1回だけ
    var p = payload();
    var key = JSON.stringify([p.slots, p.kids, p.parent]);
    if (key !== state.requestKey) { state.requestKey = key; state.requestId = newId(); } // 同じ内容の再送は同じIDで（二重登録されない）
    p.requestId = state.requestId;
    state.sending = true; $('ap-err3').textContent = '';
    var btn = $('ap-next'); btn.disabled = true; btn.classList.add('sending'); btn.textContent = '送信中…';
    apiApply(p).then(function (res) {
      if (!res || !res.ok) throw Object.assign(new Error('ng'), { userMsg: res && res.message });
      renderResult(res); go(4);
    }).catch(function (e) {
      $('ap-err3').textContent = (e && e.userMsg) || '送信できませんでした。電波のよい所で「この内容で申し込む」をもう一度押してください。\n（同じ内容で何度押しても、申込が二重になることはありません）';
    }).then(function () {
      state.sending = false; btn.classList.remove('sending'); renderBar();
    });
  }

  // ---------- 4. 結果 ----------
  var RES = {
    '確定': ['ok', '確定', 'ご予約が確定しました。'],
    '仮受付': ['recv', '受付済み', 'コーチから確定のご連絡をします。'],
    'キャンセル待ち': ['wait', 'キャンセル待ち', '直前に満員になりました。空きが出たらメールでお知らせします。'],
    '要調整': ['recv', '受付済み', '定員を超えているため、日程をご相談するご連絡をします。'],
    '受付不可': ['ng', '受付できません', 'この日は受付を終了しました。']
  };
  function renderResult(res) {
    var list = res.results.map(function (r) {
      var s = state.byId[r.id], m = RES[r.status] || ['ng', r.status, ''];
      return '<li><span>' + esc(s ? md(s.date) + ' ' + s.start + '〜' : r.id) + '<br><small>' + esc(m[2]) + '</small></span><span class="tag ' + m[0] + '">' + esc(m[1]) + '</span></li>';
    }).join('');
    var anyOk = res.results.some(function (r) { return r.status === '確定' || r.status === '仮受付' || r.status === '要調整'; });
    $('ap-result').innerHTML =
      '<p class="ap-msg">受付番号：<b>' + esc(res.appId) + '</b></p><ul class="ap-res">' + list + '</ul>' +
      '<p class="ap-msg">' + (anyOk ? '受付内容をメールでお送りしました（届かないときは迷惑メールフォルダもご確認ください）。持ち物：動きやすい服・靴下・飲み物（ジュース不可）・体験料500円。' : '受付内容をメールでお送りしました。') + '</p>' +
      (res.demo ? '<p class="ap-msg"><b>※確認モードです。</b>どこにも送信していません。メールも送っていません。</p>' : '');
    loadSlots(); // 残り人数を最新に
  }

  // ---------- 画面の切り替え ----------
  function go(n, focusSel) {
    state.step = n;
    Array.prototype.forEach.call(document.querySelectorAll('[data-panel]'), function (el) { el.hidden = +el.getAttribute('data-panel') !== n; });
    Array.prototype.forEach.call(document.querySelectorAll('.ap-steps li'), function (li) {
      var k = +li.getAttribute('data-step'); li.className = k === n ? 'on' : k < n ? 'done' : '';
    });
    if (n === 2) { renderKids(); renderChosen(); }
    if (n === 3) renderConfirm();
    renderBar();
    var h = document.querySelector('[data-panel="' + n + '"] h2');
    var target = focusSel ? document.querySelector(focusSel) : null;
    // ページ全体は「なめらかスクロール」設定なので、ここは即座に移動させる（次の画面の途中から始まらないように）
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
    else { var top = document.getElementById('ap').getBoundingClientRect().top + window.pageYOffset - 70; window.scrollTo({ top: Math.max(0, top), behavior: 'instant' }); }
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  function renderBar() {
    var bar = $('ap-bar'), nx = $('ap-next'), pv = $('ap-prev'), tx = $('ap-bar-txt');
    bar.hidden = state.step === 4;
    pv.hidden = state.step === 1;
    if (state.step === 1) {
      tx.textContent = state.picked.length ? state.picked.length + 'コマ選択中：' + pickedText() : '日にちを選んでください';
      nx.textContent = '次へ'; nx.disabled = !state.picked.length;
    } else if (state.step === 2) {
      tx.textContent = state.picked.length + 'コマ・' + state.kids.length + '人';
      nx.textContent = '確認へ'; nx.disabled = false;
    } else if (state.step === 3) {
      tx.textContent = '';
      nx.textContent = 'この内容で申し込む'; nx.disabled = state.sending;
    }
  }
  var flashTimer;
  function flashBar(msg) {
    var tx = $('ap-bar-txt'); tx.textContent = msg; clearTimeout(flashTimer); flashTimer = setTimeout(renderBar, 2200);
  }

  // ---------- 操作 ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t) return;
    if (t.classList.contains('slot') && !t.disabled) togglePick(t.getAttribute('data-id'));
    else if (t.hasAttribute('data-m')) { state.month = t.getAttribute('data-m'); renderMonths(); renderSlots(); }
    else if (t.id === 'ap-add') { syncKids(); state.kids.push({ name: '', kana: '', grade: '' }); renderKids(); renderBar(); }
    else if (t.hasAttribute('data-del')) { syncKids(); state.kids.splice(+t.getAttribute('data-del'), 1); renderKids(); renderBar(); }
    else if (t.hasAttribute('data-unpick')) togglePick(t.getAttribute('data-unpick'));
    else if (t.hasAttribute('data-goto')) { if (state.step === 2) syncKids(); go(+t.getAttribute('data-goto'), t.getAttribute('data-focus')); }
    else if (t.id === 'ap-prev') { if (state.step === 2) syncKids(); go(state.step - 1); }
    else if (t.id === 'ap-next') {
      if (state.step === 1 && state.picked.length) go(2);
      else if (state.step === 2) { syncKids(); if (validate()) go(3); }
      else if (state.step === 3) send();
    }
  });
  function syncKids() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-kid]'), function (box) {
      var k = state.kids[+box.getAttribute('data-kid')]; if (!k) return;
      ['name', 'kana', 'grade'].forEach(function (f) { k[f] = box.querySelector('[data-k="' + f + '"]').value; });
    });
  }

  document.addEventListener('input', function (e) {
    if (e.target.hasAttribute('aria-invalid')) e.target.removeAttribute('aria-invalid');
  });

  // ---------- 開始 ----------
  if (DEMO) $('ap-mode').textContent = '・確認モード（送信はしません）';
  if (CFG.contactNote) $('ap-contact').innerHTML = esc(CFG.contactNote).replace('お問合せフォーム', '<a href="' + esc(CFG.contactUrl || '#') + '">お問合せフォーム</a>');
  loadSlots();
})();
