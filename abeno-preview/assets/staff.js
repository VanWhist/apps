/*
 * スタッフ用更新ページ（staff.html）
 * ------------------------------------------------------------
 * 流れ: ログイン（メールの6桁コード）→ 項目を選ぶ → 依頼を書く → 変更点の表を確認 → 反映
 * STAFF_CONFIG.api が空のあいだは確認モード（見本のログイン・見本の返事・この画面の中だけで反映）。
 * 本物の判定と保存は GAS（gas/staff/Code.gs）が行い、ここでの検査は見せるためだけ。
 */
(function () {
  'use strict';
  var A = window.StaffAPI;
  var DEMO = A.DEMO;
  var Core = window.StaffCore;
  var Mock = A.Mock;
  var $ = function (id) { return document.getElementById(id); };
  var S = { me: null, data: {}, sha: '', recent: [], area: null, history: [], pending: null, busy: false, email: '' };

  function call(action, p) {
    return A.call(action, p).then(function (res) {
      if (res && res.relogin) { toLogin(); showErr('login-err', res.message); }
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
      $('demo-staff').innerHTML = A.DEMO_STAFF.map(function (s, i) {
        return '<button type="button" class="st-chip" data-i="' + i + '"><b>' + esc(s.name) + '</b><small>' + esc(s.note) + '</small></button>';
      }).join('');
      $('demo-staff').addEventListener('click', function (e) {
        var b = e.target.closest('[data-i]'); if (!b) return;
        $('in-email').value = A.DEMO_STAFF[+b.dataset.i].email;
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
        S.me = res.me;
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
  function toLogin() {
    S.me = null;
    $('f-code').hidden = true; $('f-email').hidden = false; $('in-code').value = '';
    view('v-login');
  }
  function logout() { A.logout(); toLogin(); }

  // ---------- 項目を選ぶ ----------
  function loadState(then) {
    call('state').then(function (res) {
      if (!res.ok) { if (!res.relogin) alertBox(res.message); return; }
      S.me = res.me; S.data = res.data; S.sha = res.sha; S.recent = res.recent || [];
      if (then) then();
      else if (/[?&]next=edit\b/.test(location.search)) location.replace('edit.html');
      else renderHome();
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
      bubble('ai ok', res.message + (DEMO ? '' : '\n' + 'HP：' + A.siteUrl), undo);
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
  if (A.loggedIn()) loadState(); else view('v-login');
})();
