/*
 * AIに改修を頼む（edit.html の「そのほか」。管理者だけ）
 * ------------------------------------------------------------
 * HPや編集画面の「作り」を AI に直してもらう。流れ：
 *   頼む → AI が別の場所（ブランチ）で作業 → 試し表示で確かめる → 反映（直前に自動バックアップ）→ いつでも元に戻す
 * 本物では GAS が Claude のエージェントを動かし、GitHub の鍵も GAS だけが持つ。
 * 確認モードでは決まった言い方に反応する見本（staff-api.js の demoDev）で、HPは変わらない。
 */
(function () {
  'use strict';
  var A = window.StaffAPI;
  var $ = function (id) { return document.getElementById(id); };
  var D = { jobs: [], usage: null, timer: 0, job: null, files: {}, page: 'index.html', cache: {} };
  var LABEL = { working: '作業中', ready: '試し表示できます', failed: 'うまくいきませんでした', applied: '反映済み', discarded: 'やめました', rolledback: '元に戻しました', stopped: '上限で止まりました' };

  document.addEventListener('abeno:view', function (e) {
    if (e.detail === 'dev') load();
  });

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function say(id, text, err) { $(id).textContent = text || ''; $(id).className = 'ed-msg' + (err ? ' err' : ''); }

  function load() {
    return A.call('devList').then(function (res) {
      if (!res.ok) return say('dv-msg', res.message, true);
      D.jobs = res.jobs || []; D.usage = res.usage;
      renderJobs(); watch();
    });
  }
  function renderUsage() {
    var u = D.usage; if (!u) return;
    $('dv-usage').textContent = '今月の利用 ' + u.spent.toFixed(2) + ' ／ ' + u.cap + 'ドル';
    $('dv-usage').classList.toggle('over', u.spent >= u.cap);
  }
  function renderJobs() {
    renderUsage();
    var busy = D.jobs.some(function (j) { return j.status === 'working' || j.status === 'ready'; });
    $('dv-send').disabled = busy;
    if (busy) say('dv-msg', '前の依頼が終わるまで、次は頼めません（反映するか、やめると頼めます）。');
    else if ($('dv-msg').textContent.indexOf('前の依頼') === 0) say('dv-msg', '');
    var lastApplied = '';
    D.jobs.forEach(function (j) { if (j.status === 'applied' && j.applied > lastApplied) lastApplied = j.applied; });
    $('dv-jobs').innerHTML = D.jobs.length ? D.jobs.map(function (j) {
      var btns = '';
      if (j.status === 'working') btns = '<span class="dv-spin" aria-hidden="true"></span><span>AIが作業しています（数分かかります。このページを閉じても続きます）</span>' +
        '<button type="button" class="ed-wpbtn ghost danger" data-dv="discard" data-id="' + j.id + '">やめる</button>';
      if (j.status === 'ready') btns = '<button type="button" class="ed-wpbtn" data-dv="try" data-id="' + j.id + '">試し表示を見る</button>' +
        '<button type="button" class="ed-wpbtn ghost danger" data-dv="discard" data-id="' + j.id + '">やめる（反映しない）</button>';
      if (j.status === 'applied') btns = '<button type="button" class="ed-wpbtn ghost danger" data-dv="rollback" data-id="' + j.id + '">元に戻す</button>' +
        (j.applied < lastApplied ? '<span class="dv-warn">これより後の反映も一緒に取り消されます</span>' : '');
      return '<article class="dv-job st-' + j.status + '">' +
        '<p class="dv-job-h"><span class="dv-st">' + (LABEL[j.status] || j.status) + '</span><span class="dv-meta">' + esc(j.created) + '・' + esc(j.by) + (j.cost ? '・' + j.cost.toFixed(2) + 'ドル' : '') + '</span></p>' +
        '<p class="dv-req">' + esc(j.request) + '</p>' +
        (j.notes && j.notes.length > 1 ? '<p class="dv-notes">追加の注文：' + j.notes.slice(1).map(esc).join(' ／ ') + '</p>' : '') +
        (j.summary ? '<p class="dv-sum">AI：' + esc(j.summary) + '</p>' : '') +
        (j.applied ? '<p class="dv-meta">反映 ' + esc(j.applied) + '（直前の状態をバックアップ済み）</p>' : '') +
        '<div class="ed-btns">' + btns + '</div></article>';
    }).join('') : '<p class="ed-hint">まだありません。</p>';
  }
  // 作業中の依頼があるあいだは、5秒ごとに様子を見る
  function watch() {
    clearTimeout(D.timer);
    var w = D.jobs.filter(function (j) { return j.status === 'working'; })[0];
    if (!w) return;
    D.timer = setTimeout(function () {
      A.call('devStatus', { id: w.id }).then(function (res) {
        if (res.ok) { replace(res.job); if (res.usage) D.usage = res.usage; renderJobs(); if (res.job.status === 'ready' && D.job && D.job.id === res.job.id) openTry(res.job); }
        watch();
      });
    }, A.DEMO ? 1500 : 5000);
  }
  function replace(job) { D.jobs = D.jobs.map(function (j) { return j.id === job.id ? job : j; }); if (!D.jobs.some(function (j) { return j.id === job.id; })) D.jobs.unshift(job); }

  $('dv-send').addEventListener('click', function () {
    var text = $('dv-text').value.trim();
    if (!text) return say('dv-msg', '頼みたいことを書いてください。', true);
    var b = this; b.disabled = true; say('dv-msg', '送っています…');
    A.call('devStart', { request: text }).then(function (res) {
      if (!res.ok) { b.disabled = false; return say('dv-msg', res.message, true); }
      $('dv-text').value = ''; say('dv-msg', res.message);
      replace(res.job); renderJobs(); watch();
    });
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-dv]');
    if (!b) return;
    var id = b.getAttribute('data-id'), act = b.getAttribute('data-dv');
    var job = D.jobs.filter(function (j) { return j.id === id; })[0];
    if (act === 'try') return openTry(job);
    var ask = act === 'discard' ? 'この依頼をやめますか？（HPは変わりません）' :
      act === 'rollback' ? '「' + job.request.slice(0, 30) + '」を反映する前の状態に戻しますか？' + (b.nextElementSibling ? '\nこれより後に反映したものも取り消されます。' : '') : '';
    if (ask && !confirm(ask)) return;
    b.disabled = true;
    A.call(act === 'discard' ? 'devDiscard' : 'devRollback', { id: id }).then(function (res) {
      b.disabled = false;
      say('dv-msg', res.message, !res.ok);
      if (res.ok) load();
    });
  });

  // ---------- 試し表示 ----------
  function openTry(job) {
    D.job = job; D.cache = {};
    window.__abenoShowView('try');
    $('dv-sum').textContent = 'あなたの依頼：' + job.request + (job.summary ? '\nAI：' + job.summary : '');
    $('dv-more-box').hidden = true;
    var pages = window.__abenoPages || [];
    $('dv-page').innerHTML = pages.map(function (p) { return '<option value="' + p.file + '">' + p.label + '</option>'; }).join('');
    A.call('devFiles', { id: job.id }).then(function (res) {
      if (!res.ok) return alert(res.message);
      D.files = res.files || {};
      // 直したページがあれば、そのページから見せる
      var firstHtml = Object.keys(D.files).filter(function (f) { return /\.html$/.test(f); })[0];
      if (firstHtml && pages.some(function (p) { return p.file === firstHtml; })) D.page = firstHtml;
      $('dv-page').value = D.page;
      showTry();
    });
  }
  // 直したファイルは AI の版、それ以外は今のHPのファイルを使う
  function text(path) {
    var f = D.files[path];
    if (typeof f === 'string') return Promise.resolve(f);
    if (D.cache[path]) return Promise.resolve(D.cache[path]);
    return fetch(path, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
      if (f && f.append) t += f.append; // 確認モードの見本は「足すだけ」
      D.cache[path] = t; return t;
    });
  }
  function changed(path) { return !!D.files[path]; }
  function showTry() {
    text(D.page).then(function (html) {
      var jobs = [];
      html.replace(/<link[^>]+href="([^"?]+)(?:\?[^"]*)?"[^>]*>/g, function (m, href) { if (/\.css$/.test(href) && changed(href)) jobs.push(href); return m; });
      html.replace(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g, function (m, src) { if (changed(src)) jobs.push(src); return m; });
      return Promise.all(jobs.map(function (f) { return text(f).then(function (t) { return [f, t]; }); })).then(function (list) {
        var got = {}; list.forEach(function (x) { got[x[0]] = x[1]; });
        var baseHref = location.href.replace(/[^\/]*([?#].*)?$/, '');
        html = html
          .replace(/<link[^>]+href="([^"?]+)(?:\?[^"]*)?"[^>]*>/g, function (m, href) { return got[href] != null ? '<style>' + got[href] + '</style>' : m; })
          .replace(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g, function (m, src) { return got[src] != null ? '<script>' + got[src].replace(/<\/script/gi, '<\\/script') + '<\/script>' : m; })
          .replace(/<head>/i, '<head><base href="' + baseHref + '">');
        var fr = $('dv-frame');
        fr.onload = function () {
          // 試し表示の中でページを移るときも、AIの版で見せる
          fr.contentDocument.addEventListener('click', function (e) {
            var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
            var href = a.getAttribute('href').split('#')[0];
            if (/^[a-z0-9-]+\.html$/.test(href) && (window.__abenoPages || []).some(function (p) { return p.file === href; })) { e.preventDefault(); D.page = href; $('dv-page').value = href; showTry(); }
            else if (!/^#/.test(a.getAttribute('href'))) e.preventDefault();
          }, true);
        };
        fr.srcdoc = html;
      });
    });
  }
  $('dv-page').addEventListener('change', function () { D.page = this.value; showTry(); });
  $('dv-more').addEventListener('click', function () { $('dv-more-box').hidden = !$('dv-more-box').hidden; if (!$('dv-more-box').hidden) $('dv-more-text').focus(); });
  $('dv-more-send').addEventListener('click', function () {
    var t = $('dv-more-text').value.trim(); if (!t) return;
    var b = this; b.disabled = true;
    A.call('devMore', { id: D.job.id, message: t }).then(function (res) {
      b.disabled = false;
      if (!res.ok) return alert(res.message);
      $('dv-more-text').value = ''; D.job = null;
      window.__abenoShowView('dev');
      say('dv-msg', 'AIが直しています。終わったら、また試し表示できます。');
    });
  });
  $('dv-apply').addEventListener('click', function () {
    if (!confirm('この内容をHPに反映しますか？\n反映の直前の状態は自動でバックアップし、あとから「元に戻す」で戻せます。')) return;
    var b = this; b.disabled = true;
    A.call('devApply', { id: D.job.id }).then(function (res) {
      b.disabled = false;
      if (!res.ok) return alert(res.message);
      D.job = null;
      window.__abenoShowView('dev');
      say('dv-msg', res.message);
    });
  });
})();
