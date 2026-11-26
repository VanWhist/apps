/*
 * スタッフ用ページ共通の通信（staff.html と edit.html で使う）
 * ------------------------------------------------------------
 * STAFF_CONFIG.api が空のあいだは確認モード:
 *   ・ログインは見本のスタッフ（コード 123456）
 *   ・AI の返事は決まった言い方だけに反応する見本（Mock）
 *   ・反映はこのブラウザの中だけ（タブを閉じると元に戻る）。HPにもメールにも何も起きない
 * 本物の検査と保存は GAS（gas/staff/Code.gs）が行う。
 */
var StaffAPI = (function () {
  'use strict';
  var C = window.STAFF_CONFIG || {};
  var API = String(C.api || '').trim();
  var DEMO = !API;
  var Core = window.StaffCore;
  var TOKEN_KEY = 'abeno-staff-token', DEMO_KEY = 'abeno-staff-demo';

  function ss(k, v) {
    try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); }
    catch (e) { /* 保存できなくても使える */ }
    return null;
  }

  // ---------- 確認モードの見本 ----------
  var DEMO_STAFF = [
    { email: 'matsu@example.com', name: '松ねえ（見本）', note: '全部の項目', areas: Core.AREAS.map(function (a) { return a.id; }), admin: true },
    { email: 'eitoku@example.com', name: '栄徳（見本）', note: 'お知らせ・練習日', areas: ['news', 'schedule'] },
    { email: 'coach@example.com', name: 'コーチ（見本）', note: '練習日だけ', areas: ['schedule'] }
  ];
  // 見本の状態はタブの中だけに保存（staff.html と edit.html で共有）
  var demo = (function () {
    var saved = null;
    try { saved = JSON.parse(ss(DEMO_KEY) || 'null'); } catch (e) { saved = null; }
    var fresh = JSON.parse(JSON.stringify(window.SITE_DATA || {}));
    if (saved) Object.keys(fresh).forEach(function (k) { if (!(k in saved.data)) saved.data[k] = fresh[k]; }); // あとから増えた項目（写真など）
    return saved || { data: fresh, sha: 1, undo: {}, recent: [], email: '', files: {} };
  })();
  demo.files = demo.files || {};
  function saveDemo() { ss(DEMO_KEY, JSON.stringify(demo)); }
  function demoStaff(email) { for (var i = 0; i < DEMO_STAFF.length; i++) if (DEMO_STAFF[i].email === email) return DEMO_STAFF[i]; return null; }
  function demoPublic(s) { return { name: s.name, admin: !!s.admin, areas: s.areas.map(function (id) { var a = Core.areaById(id); return { id: a.id, label: a.label, hint: a.hint }; }) }; }
  function nowStr() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); }
  function sumRows(rows) { return rows.map(function (x) { return x.where + '：' + (x.summary || x.after); }).join(' ／ '); }

  function demoHandle(action, p) {
    var me = demoStaff(demo.email);
    if (action === 'requestCode') return { ok: true, message: '登録されているメールなら、6桁のコードを送りました（10分有効）。', demoCode: '123456' };
    if (action === 'verify') {
      var s = demoStaff(String(p.email).toLowerCase());
      if (!s) return { ok: false, message: '確認モードでは、上の見本のスタッフを選んでください。' };
      if (p.code !== '123456') return { ok: false, message: 'コードが違います（確認モードのコードは 123456）' };
      demo.email = s.email; saveDemo();
      return { ok: true, token: 'demo', me: demoPublic(s) };
    }
    if (!me) return { ok: false, relogin: true, message: 'ログインしてください。' };
    if (action === 'state') {
      var out = {};
      me.areas.forEach(function (id) { out[id] = Core.areaData(demo.data, id); });
      return { ok: true, me: demoPublic(me), data: out, sha: String(demo.sha), recent: demo.recent.map(function (r) { r.mine = r.email === me.email; return r; }) };
    }
    if (action === 'chat') {
      var r = Mock.respond(p.area, p.message, demo.data);
      var res = { ok: true, reply: r.reply, changes: [], rows: [], sha: String(demo.sha) };
      if (r.changes.length) {
        try { res.rows = Core.applyChanges(demo.data, r.changes, me.areas, p.area).rows; res.changes = r.changes; }
        catch (e) { res.reply = 'うまく変更案を作れませんでした（' + e.message + '）。'; }
      }
      return res;
    }
    if (action === 'apply') {
      if (p.sha !== String(demo.sha)) return { ok: false, message: 'この間にほかの人が更新しました。もう一度お願いします。' };
      try {
        var before = JSON.stringify(demo.data);
        var a = Core.applyChanges(demo.data, p.changes, me.areas, p.area);
        // 写真ファイル：本番は GitHub の images へ。確認モードはこのタブの中にだけ置く
        var wanted = Core.photoSrcs(p.changes), files = p.files || [];
        for (var fi = 0; fi < files.length; fi++) { var fm = Core.checkPhotoFile(files[fi], wanted); if (fm) return { ok: false, message: fm }; }
        if (files.length && !p.consent) return { ok: false, message: '写真の掲載同意のチェックがありません' };
        files.forEach(function (f) { demo.files[f.path] = 'data:image/jpeg;base64,' + f.b64; });
        demo.data = a.data; demo.sha++;
        var commit = 'demo' + demo.sha;
        var labels = [];
        p.changes.forEach(function (c) { var x = Core.areaOfPath(c.path); if (x && labels.indexOf(x.label) < 0) labels.push(x.label); });
        demo.undo[commit] = { before: before, sha: demo.sha };
        demo.recent.unshift({ at: nowStr(), name: me.name, email: me.email, area: labels.join('／'), text: sumRows(a.rows), commit: commit });
        demo.recent = demo.recent.slice(0, 5);
        saveDemo();
        return { ok: true, rows: a.rows, sha: String(demo.sha), commit: commit, message: '反映しました（確認モードのため、この画面の中だけです。HPは変わっていません）。' };
      } catch (e) { return { ok: false, message: e.message }; }
    }
    if (action === 'undo') {
      var u = demo.undo[p.commit];
      if (!u) return { ok: false, message: '元に戻せる変更が見つかりません' };
      if (u.sha !== demo.sha) return { ok: false, message: 'このあとに別の更新があるため、ここからは戻せません（管理者へ）' };
      demo.data = JSON.parse(u.before); demo.sha++;
      delete demo.undo[p.commit];
      demo.recent = demo.recent.filter(function (r) { return r.commit !== p.commit; });
      saveDemo();
      return { ok: true, message: '元に戻しました（確認モード）。' };
    }
    if (action === 'feedback') {
      if (!String(p.text || '').trim()) return { ok: false, message: '要望を書いてください' };
      return { ok: true, message: '要望を送りました（確認モードのため、どこにも届いていません）。' };
    }
    if (action === 'logout') { demo.email = ''; saveDemo(); }
    return { ok: true };
  }

  // ---------- 通信 ----------
  function call(action, p) {
    p = p || {};
    if (DEMO) return new Promise(function (resolve) { setTimeout(function () { resolve(demoHandle(action, p)); }, action === 'chat' ? 700 : 250); });
    p.action = action;
    var t = ss(TOKEN_KEY);
    if (t) p.token = t;
    // text/plain で送ると CORS の事前確認が起きず、GAS がそのまま受け取れる
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(p) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function () { return { ok: false, message: 'つながりませんでした。電波のよい所で、もう一度お試しください。' }; })
      .then(function (res) {
        if (action === 'verify' && res.ok) ss(TOKEN_KEY, res.token);
        if (res && res.relogin) ss(TOKEN_KEY, null);
        return res;
      });
  }
  function loggedIn() { return DEMO ? !!demoStaff(demo.email) : !!ss(TOKEN_KEY); }
  function logout() { var r = call('logout'); ss(TOKEN_KEY, null); return r; }
  // 確認モードで、反映済みの見本データ全体（編集モードの表示用）
  function demoFile(src) { return DEMO ? demo.files[src] || '' : ''; }
  function demoSiteData() { return DEMO ? JSON.parse(JSON.stringify(demo.data)) : null; }

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

  return { DEMO: DEMO, siteUrl: C.siteUrl || 'index.html', DEMO_STAFF: DEMO_STAFF, call: call, loggedIn: loggedIn, logout: logout, demoSiteData: demoSiteData, demoFile: demoFile, Mock: Mock };
})();
