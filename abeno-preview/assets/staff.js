/*
 * スタッフ用更新ページ（staff.html）
 * ------------------------------------------------------------
 * 流れ: ログイン（メールの6桁コード）→ 項目を選ぶ → 依頼を書く → 変更点の表を確認 → 反映
 * STAFF_CONFIG.api が空のあいだは確認モード（見本のログイン・見本の返事・この画面の中だけで反映）。
 * 本物の判定と保存は GAS（gas/staff/Code.gs）が行い、ここでの検査は見せるためだけ。
 */
(function () {
  'use strict';
  var C = window.STAFF_CONFIG || {};
  var API = String(C.api || '').trim();
  var DEMO = !API;
  var Core = window.StaffCore;
  var $ = function (id) { return document.getElementById(id); };
  var TOKEN_KEY = 'abeno-staff-token';

  var S = { token: '', me: null, data: {}, sha: '', recent: [], area: null, history: [], pending: null, busy: false, email: '' };

  // ---------- 確認モードの見本 ----------
  var DEMO_STAFF = [
    { email: 'matsu@example.com', name: '松ねえ（見本）', note: '全部の項目', areas: Core.AREAS.map(function (a) { return a.id; }), admin: true },
    { email: 'eitoku@example.com', name: '栄徳（見本）', note: 'お知らせ・練習日', areas: ['news', 'schedule'] },
    { email: 'coach@example.com', name: 'コーチ（見本）', note: '練習日だけ', areas: ['schedule'] }
  ];
  var demoData = JSON.parse(JSON.stringify(window.SITE_DATA || {}));
  var demoSha = 1;
  var demoUndo = {};

  function demoCall(action, p) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(demoHandle(action, p)); }, action === 'chat' ? 700 : 300);
    });
  }
  function demoStaff(email) { for (var i = 0; i < DEMO_STAFF.length; i++) if (DEMO_STAFF[i].email === email) return DEMO_STAFF[i]; return null; }
  function demoPublic(s) { return { name: s.name, admin: !!s.admin, areas: s.areas.map(function (id) { var a = Core.areaById(id); return { id: a.id, label: a.label, hint: a.hint }; }) }; }
  function demoHandle(action, p) {
    var me = demoStaff(S.email);
    if (action === 'requestCode') return { ok: true, message: '登録されているメールなら、6桁のコードを送りました（10分有効）。', demoCode: '123456' };
    if (action === 'verify') {
      var s = demoStaff(String(p.email).toLowerCase());
      if (!s) return { ok: false, message: '確認モードでは、上の見本のスタッフを選んでください。' };
      if (p.code !== '123456') return { ok: false, message: 'コードが違います（確認モードのコードは 123456）' };
      return { ok: true, token: 'demo', me: demoPublic(s) };
    }
    if (action === 'state') {
      var out = {};
      me.areas.forEach(function (id) { out[id] = Core.areaData(demoData, id); });
      return { ok: true, me: demoPublic(me), data: out, sha: String(demoSha), recent: S.recent };
    }
    if (action === 'chat') {
      var r = Mock.respond(p.area, p.message, demoData);
      var res = { ok: true, reply: r.reply, changes: [], rows: [], sha: String(demoSha) };
      if (r.changes.length) {
        try { res.rows = Core.applyChanges(demoData, r.changes, me.areas, p.area).rows; res.changes = r.changes; }
        catch (e) { res.reply = 'うまく変更案を作れませんでした（' + e.message + '）。'; }
      }
      return res;
    }
    if (action === 'apply') {
      if (p.sha !== String(demoSha)) return { ok: false, message: 'この間にほかの人が更新しました。もう一度依頼を送ってください。' };
      try {
        var before = JSON.stringify(demoData);
        var a = Core.applyChanges(demoData, p.changes, me.areas, p.area);
        demoData = a.data; demoSha++;
        var commit = 'demo' + demoSha;
        demoUndo[commit] = { before: before, sha: demoSha };
        S.recent.unshift({ at: nowStr(), name: me.name, area: Core.areaById(p.area).label, text: a.rows.map(function (x) { return x.where + '：' + (x.summary || x.after); }).join(' ／ '), commit: commit, mine: true });
        return { ok: true, rows: a.rows, sha: String(demoSha), commit: commit, message: '反映しました（確認モードのため、この画面の中だけです。HPは変わっていません）。' };
      } catch (e) { return { ok: false, message: e.message }; }
    }
    if (action === 'undo') {
      var u = demoUndo[p.commit];
      if (!u) return { ok: false, message: '元に戻せる変更が見つかりません' };
      if (u.sha !== demoSha) return { ok: false, message: 'このあとに別の更新があるため、ここからは戻せません（管理者へ）' };
      demoData = JSON.parse(u.before); demoSha++;
      delete demoUndo[p.commit];
      S.recent = S.recent.filter(function (r) { return r.commit !== p.commit; });
      return { ok: true, message: '元に戻しました（確認モード）。' };
    }
    return { ok: true };
  }
  function nowStr() {
    var d = new Date(Date.now() + 9 * 3600e3);
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }

  // ---------- 通信 ----------
  function call(action, p) {
    p = p || {};
    if (DEMO) return demoCall(action, p);
    p.action = action;
    if (S.token) p.token = S.token;
    // text/plain で送ると CORS の事前確認が起きず、GAS がそのまま受け取れる
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(p) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function () { return { ok: false, message: 'つながりませんでした。電波のよい所で、もう一度お試しください。' }; })
      .then(function (res) {
        if (res && res.relogin) { logout(); showErr('login-err', res.message); }
        return res;
      });
  }

  // ---------- 画面の切り替え ----------
  function view(id) {
    ['v-login', 'v-home', 'v-edit'].forEach(function (v) { $(v).hidden = v !== id; });
    $('st-logout').hidden = id === 'v-login';
    window.scrollTo(0, 0);
  }
  function showErr(id, msg) { $(id).textContent = msg || ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function busy(on, btn) { S.busy = on; if (btn) { btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false'); } }

  // ---------- ログイン ----------
  function initLogin() {
    if (DEMO) {
      $('login-demo').hidden = false;
      $('demo-staff').innerHTML = DEMO_STAFF.map(function (s, i) {
        return '<button type="button" class="st-chip" data-i="' + i + '"><b>' + esc(s.name) + '</b><small>' + esc(s.note) + '</small></button>';
      }).join('');
      $('demo-staff').addEventListener('click', function (e) {
        var b = e.target.closest('[data-i]'); if (!b) return;
        $('in-email').value = DEMO_STAFF[+b.dataset.i].email;
        $('f-email').requestSubmit ? $('f-email').requestSubmit() : sendEmail(e);
      });
    }
    $('f-email').addEventListener('submit', sendEmail);
    $('f-code').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = $('in-code').value.replace(/\D/g, '');
      if (code.length !== 6) return showErr('login-err', '6桁の数字を入れてください');
      var btn = e.submitter || $('f-code').querySelector('button[type=submit]');
      busy(true, btn); showErr('login-err', '');
      call('verify', { email: S.email, code: code }).then(function (res) {
        busy(false, btn);
        if (!res.ok) return showErr('login-err', res.message);
        S.token = res.token; S.me = res.me;
        try { sessionStorage.setItem(TOKEN_KEY, res.token); } catch (err) { /* 保存できなくても使える */ }
        loadState();
      });
    });
    $('code-back').addEventListener('click', function () { $('f-code').hidden = true; $('f-email').hidden = false; showErr('login-err', ''); });
  }
  function sendEmail(e) {
    e.preventDefault();
    var email = $('in-email').value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('login-err', 'メールアドレスを確かめてください');
    var btn = $('f-email').querySelector('button[type=submit]');
    busy(true, btn); showErr('login-err', '');
    S.email = email;
    call('requestCode', { email: email }).then(function (res) {
      busy(false, btn);
      if (!res.ok) return showErr('login-err', res.message);
      $('f-email').hidden = true; $('f-code').hidden = false;
      $('code-sent').textContent = res.message + (res.demoCode ? '（確認モードのコード：' + res.demoCode + '）' : '');
      if (res.demoCode) $('in-code').value = res.demoCode;
      $('in-code').focus();
    });
  }
  function logout() {
    if (!DEMO && S.token) call('logout');
    S.token = ''; S.me = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (err) { /* なし */ }
    $('f-code').hidden = true; $('f-email').hidden = false; $('in-code').value = '';
    view('v-login');
  }

  // ---------- 項目を選ぶ ----------
  function loadState(then) {
    call('state').then(function (res) {
      if (!res.ok) { if (!res.relogin) alertBox(res.message); return; }
      S.me = res.me; S.data = res.data; S.sha = res.sha; S.recent = res.recent || [];
      if (then) then(); else renderHome();
    });
  }
  function renderHome() {
    $('me-name').textContent = S.me.name;
    $('areas').innerHTML = S.me.areas.map(function (a) {
      return '<button type="button" class="st-area" data-id="' + a.id + '"><b>' + esc(a.label) + '</b><small>' + esc(a.hint) + '</small><span aria-hidden="true">›</span></button>';
    }).join('') || '<p class="st-note">担当の項目がまだありません。管理者に連絡してください。</p>';
    $('recent').innerHTML = S.recent.length ? S.recent.map(function (r) {
      return '<li><span class="st-when">' + esc(r.at) + '　' + esc(r.name) + '</span><b>' + esc(r.area) + '</b><span>' + esc(r.text) + '</span>' +
        (r.mine ? '<button type="button" class="st-link" data-undo="' + esc(r.commit) + '">元に戻す</button>' : '') + '</li>';
    }).join('') : '<li class="st-note">まだありません</li>';
    view('v-home');
  }
  function openArea(id) {
    S.area = Core.areaById(id); S.history = []; S.pending = null;
    $('edit-title').textContent = S.area.label;
    $('chat').innerHTML = '';
    bubble('ai', 'どう変えますか？ふだんの言葉で書いてください。変える前に、必ず変更点をお見せします。' + (DEMO ? '\n（確認モード：AIにはつながっていません。下の例の言い方だけ試せます）' : ''));
    $('examples').innerHTML = (Mock.examples[id] || []).map(function (t) { return '<button type="button" class="st-ex">' + esc(t) + '</button>'; }).join('');
    renderNow();
    view('v-edit');
  }

  // ---------- いまの内容 ----------
  function renderNow() {
    var d = S.data[S.area.id] || {}, h = '';
    if (S.area.id === 'news') {
      h = '<ol class="st-list">' + (d.news || []).map(function (n) { return '<li><span>' + esc(n.date) + '</span>' + esc(n.title) + '</li>'; }).join('') + '</ol>';
    } else if (S.area.id === 'schedule') {
      var sc = d.schedule || {}, rows = (sc.rows || []);
      h = '<p class="st-note">' + esc(sc.title || '') + '</p><div class="st-scroll"><table class="st-tbl"><tr><th>日</th>' + rows.map(function (r) { return '<th>' + esc(r) + '</th>'; }).join('') + '</tr>' +
        (sc.days || []).map(function (day) { return '<tr><th>' + esc(Core.fmtDate(day.date)) + '</th>' + rows.map(function (r) { return '<td>' + esc(day[r] || '') + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div>';
    } else if (S.area.id === 'fees') {
      h = (d.fees || []).map(function (f) {
        return '<p class="st-sub">' + esc(f.title) + '</p><table class="st-tbl">' + (f.rows || []).map(function (r) { return '<tr><th>' + esc(r.item) + '</th><td>' + esc(r.price) + '</td><td>' + esc(r.note || '') + '</td></tr>'; }).join('') + '</table>';
      }).join('');
    } else if (S.area.id === 'flash') {
      var fl = d.flash || {};
      h = '<p class="st-sub">' + esc(fl.label || '') + '</p><p>' + (fl.lines || []).map(esc).join('<br>') + '</p><p class="st-sub">募集の文</p><p>' + (fl.recruit || []).map(esc).join('<br>') + '</p>';
    } else {
      h = '<pre class="st-pre">' + esc(JSON.stringify(d, null, 1)) + '</pre>';
    }
    $('now').innerHTML = h;
  }

  // ---------- 会話 ----------
  function bubble(who, text, extra) {
    var el = document.createElement('div');
    el.className = 'st-msg ' + who;
    el.innerHTML = '<p>' + esc(text).replace(/\n/g, '<br>') + '</p>' + (extra || '');
    $('chat').appendChild(el);
    el.scrollIntoView({ block: 'end', behavior: 'smooth' });
    return el;
  }
  function proposal(rows) {
    return '<div class="st-prop"><p class="st-prop-h">変更点（まだ反映していません）</p>' + rows.map(function (r) {
      return '<div class="st-row"><p class="st-where">' + esc(r.where) + (r.summary ? '<small>' + esc(r.summary) + '</small>' : '') + '</p>' +
        '<div class="st-ba"><div class="b"><span>いま</span>' + esc(r.before).replace(/\n/g, '<br>') + '</div><div class="a"><span>変更後</span>' + esc(r.after).replace(/\n/g, '<br>') + '</div></div></div>';
    }).join('') + '<div class="st-prop-btns"><button type="button" class="btn btn-main" data-act="apply">この内容で反映する</button><button type="button" class="st-pill" data-act="cancel">やめる</button></div></div>';
  }
  function send(text) {
    text = String(text || '').trim();
    if (!text || S.busy) return;
    if (S.pending) closePending('（新しい依頼を書いたので、前の案は取り消しました）');
    bubble('me', text);
    $('in-msg').value = '';
    var wait = bubble('ai wait', '考えています…');
    busy(true, $('send'));
    call('chat', { area: S.area.id, message: text, history: S.history.slice(-8) }).then(function (res) {
      busy(false, $('send'));
      wait.remove();
      if (!res.ok) { bubble('ai err', res.message); return; }
      S.history.push({ role: 'user', text: text });
      S.history.push({ role: 'assistant', text: res.reply + (res.rows && res.rows.length ? '\n（変更案：' + res.rows.map(function (r) { return r.where + ' → ' + r.after; }).join('、').slice(0, 400) + '）' : '') });
      if (res.rows && res.rows.length) {
        S.pending = { changes: res.changes, sha: res.sha, el: bubble('ai', res.reply, proposal(res.rows)) };
      } else bubble('ai', res.reply);
    });
  }
  function closePending(note) {
    var p = S.pending; if (!p) return;
    var btns = p.el.querySelector('.st-prop-btns');
    if (btns) btns.outerHTML = '<p class="st-note">' + esc(note) + '</p>';
    S.pending = null;
  }
  function applyPending(btn) {
    var p = S.pending; if (!p || S.busy) return;
    busy(true, btn);
    call('apply', { area: S.area.id, changes: p.changes, sha: p.sha }).then(function (res) {
      busy(false, btn);
      if (!res.ok) { bubble('ai err', res.message); return; }
      closePending(res.test ? 'テストモード：保存はしていません' : '反映しました');
      var undo = res.commit ? '<button type="button" class="st-link" data-undo="' + esc(res.commit) + '">元に戻す</button>' : '';
      bubble('ai ok', res.message + (DEMO ? '' : '\n' + 'HP：' + (C.siteUrl || '')), undo);
      S.history.push({ role: 'assistant', text: '（反映済み）' });
      loadState(function () { renderNow(); });
    });
  }
  function undo(commit, btn) {
    if (!window.confirm('この変更を元に戻しますか？')) return;
    busy(true, btn);
    call('undo', { commit: commit }).then(function (res) {
      busy(false, btn);
      if (!res.ok) { alertBox(res.message); return; }
      if (btn) btn.outerHTML = '<span class="st-note">元に戻しました</span>';
      loadState(function () { if (!$('v-home').hidden) renderHome(); else renderNow(); });
      if ($('v-edit').hidden === false) bubble('ai ok', res.message);
    });
  }
  function alertBox(msg) { if (!$('v-edit').hidden) bubble('ai err', msg); else showErr('login-err', msg); }

  // ---------- 確認モードの見本の返事（決まった言い方だけ） ----------
  var Mock = (function () {
    var examples = {
      news: ['新しいお知らせ：12月20日にクリスマス体験会を開きます。参加無料です。', 'いちばん上のお知らせを消してください'],
      schedule: ['11月28日のキッズはお休みにしてください', '11月25日の選手を17-21にしてください', '11月29日はお休みです'],
      fees: ['キッズの入会金を6,000円にしてください'],
      flash: ['速報の文を「2026年12月／全日本ジュニア／優勝しました」にしてください']
    };
    function today() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
    function j(v) { return JSON.stringify(v); }
    var none = { reply: '確認モードでは、下の例のような決まった言い方だけ試せます。本番では、ふだんの言葉で頼めます。', changes: [] };

    function news(t, d) {
      if (/消|削除/.test(t)) {
        var list = d.news || [];
        var i = /いちばん上|一番上|最新|1件目/.test(t) ? 0 : -1;
        list.forEach(function (n, k) { if (i < 0 && n.title && t.indexOf(n.title) >= 0) i = k; });
        if (i < 0 || !list[i]) return { reply: 'どのお知らせを消しますか？題名を書いてください。', changes: [] };
        return { reply: '「' + list[i].title + '」を消す案です。下の表を確認して「反映する」を押してください。', changes: [{ op: 'remove', path: 'news/' + i, value_json: '', summary: 'お知らせを1件削除' }] };
      }
      var body = t.replace(/^(新しい)?お知らせ(を追加)?[:：\s]*/, '').trim();
      if (!body) return none;
      var title = body.split(/[。\n]/)[0].slice(0, 40);
      return {
        reply: 'お知らせを1件、いちばん上に足す案です。題名は最初の文にしました。',
        changes: [{ op: 'add', path: 'news/0', value_json: j({ date: today(), tag: 'お知らせ', title: title, body: body }), summary: '新しいお知らせ' }]
      };
    }
    function schedule(t, d) {
      var sc = d.schedule || {}, days = sc.days || [];
      var m = /(\d{1,2})\s*[\/月]\s*(\d{1,2})/.exec(t);
      if (!m) return { reply: '何月何日のことですか？（例：11月28日）', changes: [] };
      var year = days.length ? days[0].date.slice(0, 4) : today().slice(0, 4);
      var date = year + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
      var idx = -1; days.forEach(function (x, k) { if (x.date === date) idx = k; });
      if (idx < 0) return { reply: Core.fmtDate(date) + ' は、いまの表（' + (sc.title || '') + '）にない日です。月の表を作り直す依頼は本番でできます。', changes: [] };
      var cls = (sc.rows || []).filter(function (r) { return t.indexOf(r) >= 0; });
      var tm = /(\d{1,2}(?:[:：]\d{2})?)\s*[-~〜～ー]\s*(\d{1,2}(?:[:：]\d{2})?)/.exec(t.slice(m.index + m[0].length));
      var off = /休み|中止|なし/.test(t);
      if (!off && !tm) return none;
      if (!cls.length) {
        if (!off) return { reply: 'どのクラスの時間ですか？（' + (sc.rows || []).join('・') + '）', changes: [] };
        var filled = (sc.rows || []).filter(function (r) { return r !== '行事' && days[idx][r]; });
        if (!filled.length) return { reply: Core.fmtDate(date) + ' はもともと練習がありません。', changes: [] };
        return {
          reply: Core.fmtDate(date) + ' の練習を、全部お休みにする案です（' + filled.join('・') + '）。クラスを分けたいときは、クラス名を書いてください。',
          changes: filled.map(function (r) { return { op: 'set', path: 'schedule/days/' + idx + '/' + r, value_json: j('休み'), summary: r + 'を休みに' }; })
        };
      }
      var v = off ? '休み' : (tm[1] + '-' + tm[2]).replace(/：/g, ':');
      return {
        reply: Core.fmtDate(date) + ' の' + cls.join('・') + 'を「' + v + '」にする案です。下の表を確認して「反映する」を押してください。',
        changes: cls.map(function (r) { return { op: 'set', path: 'schedule/days/' + idx + '/' + r, value_json: j(v), summary: r + 'を' + v + 'に' }; })
      };
    }
    function fees(t, d) {
      var m = /(.+?)を\s*[￥¥]?\s*([\d,，]+)\s*円に/.exec(t);
      if (!m) return none;
      var num = m[2].replace(/[，,]/g, '');
      var price = '￥' + Number(num).toLocaleString('ja-JP');
      var hits = [];
      (d.fees || []).forEach(function (f, fi) {
        if (m[1].indexOf(f.title) < 0 && (d.fees || []).some(function (g) { return m[1].indexOf(g.title) >= 0; })) return;
        (f.rows || []).forEach(function (r, ri) { if (r.item && m[1].indexOf(r.item) >= 0) hits.push({ fi: fi, ri: ri, f: f, r: r }); });
      });
      if (!hits.length) return { reply: 'どの料金ですか？料金表にある名前（例：キッズの入会金）で書いてください。', changes: [] };
      if (hits.length > 1) return { reply: '「' + hits[0].r.item + '」が' + hits.length + 'つあります（' + hits.map(function (h) { return h.f.title + '・' + (h.r.note || ''); }).join('／') + '）。どれですか？', changes: [] };
      var h = hits[0];
      return { reply: h.f.title + 'の' + h.r.item + 'を ' + price + ' にする案です。', changes: [{ op: 'set', path: 'fees/' + h.fi + '/rows/' + h.ri + '/price', value_json: j(price), summary: h.r.item + 'の金額' }] };
    }
    function flash(t) {
      var m = /[「『](.+)[」』]/.exec(t);
      if (!m) return none;
      return { reply: '速報の文を置きかえる案です（／で行を分けました）。', changes: [{ op: 'set', path: 'flash/lines', value_json: j(m[1].split(/[／\/]/).map(function (s) { return s.trim(); }).filter(Boolean)), summary: '速報の文' }] };
    }
    return {
      examples: examples,
      respond: function (area, text, data) {
        var t = String(text || '');
        if (area === 'news') return news(t, data);
        if (area === 'schedule') return schedule(t, data);
        if (area === 'fees') return fees(t, data);
        if (area === 'flash') return flash(t);
        return none;
      }
    };
  })();
  window.__StaffMock = Mock; // テスト用

  // ---------- つなぎ ----------
  $('st-logout').addEventListener('click', logout);
  $('areas').addEventListener('click', function (e) { var b = e.target.closest('[data-id]'); if (b) openArea(b.dataset.id); });
  $('edit-back').addEventListener('click', function () { if (S.pending) closePending('（反映せずに戻りました）'); renderHome(); });
  $('f-chat').addEventListener('submit', function (e) { e.preventDefault(); send($('in-msg').value); });
  $('in-msg').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send($('in-msg').value); } });
  $('examples').addEventListener('click', function (e) { var b = e.target.closest('.st-ex'); if (b) send(b.textContent); });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]');
    if (a && a.dataset.act === 'apply') applyPending(a);
    if (a && a.dataset.act === 'cancel') { closePending('やめました（何も変えていません）'); bubble('ai', 'わかりました。ほかに変えたいことがあれば書いてください。'); }
    var u = e.target.closest('[data-undo]');
    if (u) undo(u.dataset.undo, u);
  });

  $('st-mode').textContent = DEMO ? 'スタッフ用・確認モード（HPもメールも変わりません）' : 'スタッフ用';
  initLogin();
  var saved = '';
  try { saved = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (err) { /* なし */ }
  if (saved && !DEMO) { S.token = saved; loadState(); } else view('v-login');
})();
