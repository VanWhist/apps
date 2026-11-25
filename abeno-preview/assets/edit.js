/*
 * HP編集モード（edit.html）
 * ------------------------------------------------------------
 * HPのページをそのまま枠の中に表示し、site-data.js から来ている文字に点線の枠を付ける。
 * クリック → 右のパネルで直す → 変更点の表にたまる → 「まとめて反映」で GAS へ（会話型と同じ検査・保存）。
 * HP本体（app.js など）には手を入れず、外から読み込んで印を付けているだけ。
 */
(function () {
  'use strict';
  var A = window.StaffAPI, Core = window.StaffCore;
  var $ = function (id) { return document.getElementById(id); };
  var PAGES = [
    { file: 'index.html', label: 'トップ' }, { file: 'class.html', label: 'クラス・料金' },
    { file: 'news.html', label: 'お知らせ' }, { file: 'activity.html', label: '活動・動画' },
    { file: 'adult.html', label: '大人のクラス' }, { file: 'club.html', label: 'クラブ案内' }
  ];
  // 画面に出ても、クリックで直さない項目（リンクや記号）
  var SKIP_KEYS = { url: 1, youtube: 1, id: 1, classId: 1, date: 1, source: 1, tag: 1, account: 1, widgetUrl: 1, feedUrl: 1, day: 1, src: 1, alt: 1 };

  // 名前が「しくみ」になっている所（スケジュールのクラス名の並び）は直さない
  var SKIP_PATH = /^schedule\/rows\//;

  var S = { v: Date.now().toString(36), files: {}, photo: null, me: null, allowed: [], roots: [], base: null, sha: '', pending: [], page: 'index.html', sel: null, html: {}, busy: false, index: {} };

  // ---------- 起動 ----------
  if (!A.loggedIn()) { location.replace('staff.html?next=edit'); return; }
  $('mode').textContent = A.DEMO ? '確認モード' : '';
  $('mode').title = A.DEMO ? '反映してもHPは変わりません' : '';
  $('page').innerHTML = PAGES.map(function (p) { return '<option value="' + p.file + '">' + p.label + '</option>'; }).join('');
  $('page').addEventListener('change', function () { S.page = this.value; S.sel = null; showForm(false); render(true); });
  // スマホ：パネル上のバーをタップで開け閉め、上下に動かすとHPとパネルの広さを変えられる
  var NARROW = window.matchMedia('(max-width:860px)'), lastH = 0, dragged = false;
  (function () {
    var g = $('grip'), panel = $('panel'), wrap = panel.parentNode, sy = 0, sh = 0, on = false;
    function maxH() { return wrap.clientHeight - 60; }
    g.addEventListener('pointerdown', function (e) {
      if (!NARROW.matches) return;
      on = true; dragged = false; sy = e.clientY; sh = panel.offsetHeight;
      try { g.setPointerCapture(e.pointerId); } catch (x) {}
    });
    g.addEventListener('pointermove', function (e) {
      if (!on) return;
      var dy = sy - e.clientY;
      if (!dragged && Math.abs(dy) < 6) return;
      if (!dragged) { dragged = true; wrap.classList.add('dragging'); panel.classList.remove('closed'); }
      e.preventDefault();
      panel.style.height = Math.max(g.offsetHeight, Math.min(maxH(), sh + dy)) + 'px';
    });
    function end() {
      if (!on) return; on = false; wrap.classList.remove('dragging');
      if (!dragged) return;
      var h = panel.offsetHeight;
      if (h < g.offsetHeight + 50) setPanel(false); else { lastH = h; setPanel(true); }
    }
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
    g.addEventListener('click', function () {
      if (dragged) { dragged = false; return; }
      setPanel(panel.classList.contains('closed'));
    });
  })();
  // スマホでは最初はパネルを畳んで、HPを広く見せる（文字をタップすると開く）
  setPanel(!NARROW.matches);
  loadState();

  function loadState() {
    return A.call('state').then(function (res) {
      if (!res.ok) { if (res.relogin) location.replace('staff.html?next=edit'); else msg(res.message, true); return; }
      S.me = res.me; S.sha = res.sha;
      S.allowed = res.me.areas.map(function (a) { return a.id; });
      S.roots = [];
      S.allowed.forEach(function (id) { S.roots = S.roots.concat(Core.areaById(id).roots); });
      // 確認モードは見本の保存データ、本番は公開中の site-data.js に担当項目の最新を重ねる
      var base = A.DEMO ? A.demoSiteData() : JSON.parse(JSON.stringify(window.SITE_DATA || {}));
      Object.keys(res.data || {}).forEach(function (id) { var d = res.data[id]; Object.keys(d).forEach(function (k) { base[k] = d[k]; }); });
      S.base = base;
      $('who').textContent = res.me.name + ' さん（直せる項目：' + res.me.areas.map(function (a) { return a.label.replace(/（.*）/, ''); }).join('・') + '）';
      $('ai-area').innerHTML = res.me.areas.filter(function (a) { return !(Core.areaById(a.id) || {}).photoOnly; }).map(function (a) { return '<option value="' + a.id + '">' + a.label + '</option>'; }).join('');
      renderExamples();
      render(false);
    });
  }

  // ---------- いまの（変更を加えた）データ ----------
  function previewData() {
    if (!S.pending.length) return S.base;
    try { return Core.applyChanges(S.base, S.pending, S.allowed, '*').data; }
    catch (e) { msg(e.message, true); return S.base; }
  }

  // ---------- HPを枠の中に描く ----------
  function getHtml(file) {
    if (S.html[file]) return Promise.resolve(S.html[file]);
    return fetch(file, { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) { S.html[file] = t; return t; });
  }
  function render(resetScroll) {
    var frame = $('site');
    var y = 0;
    try { y = resetScroll ? 0 : frame.contentWindow.scrollY; } catch (e) { y = 0; }
    $('loading').hidden = false;
    getHtml(S.page).then(function (html) {
      var data = previewData();
      window.__abenoEditData = withFiles(data);
      S.index = buildIndex(data);
      var baseHref = location.href.replace(/[^\/]*([?#].*)?$/, '');
      html = html
        .replace(/<script src="data\/site-data\.js"><\/script>/, '<script>window.SITE_DATA = parent.__abenoEditData; window.SITE_EDIT = true;<\/script>')
        .replace(/(assets\/(?:app\.js|style\.css))"/g, '$1?v=' + S.v + '"') // 古い表示が残らないように
        .replace(/<head>/i, '<head><base href="' + baseHref + '"><style>' + FRAME_CSS + '</style>');
      frame.onload = function () {
        $('loading').hidden = true;
        var doc = frame.contentDocument;
        doc.querySelectorAll('details').forEach(function (d) { d.open = true; });
        mark(doc);
        new MutationObserver(function () { mark(doc); }).observe(doc.body, { childList: true, subtree: true });
        doc.addEventListener('click', onFrameClick, true);
        if (y) frame.contentWindow.scrollTo(0, y);
      };
      frame.srcdoc = html;
    }).catch(function () { $('loading').textContent = '読み込めませんでした。'; });
  }
  var FRAME_CSS = '[data-ed]{outline:2px dashed rgba(255,107,87,.55);outline-offset:2px;cursor:pointer;border-radius:4px}' +
    '[data-ed]:hover{outline-color:#ff6b57;background:rgba(255,201,60,.25)}' +
    '[data-ed].ed-on{outline:3px solid #ff6b57;background:rgba(255,201,60,.35)}' +
    '[data-photo]{outline:3px dashed rgba(22,168,154,.8);outline-offset:-3px;cursor:pointer}' +
    '[data-photo].ed-on{outline:4px solid #16a89a}' +
    '.hd{position:static!important}';
  // まだ保存していない写真は、HPのプレビューでは手元の画像（data:）で見せる
  function photoUrl(src) { return S.files[src] || (A.demoFile && A.demoFile(src)) || src; }
  function withFiles(data) {
    var c = JSON.parse(JSON.stringify(data));
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (typeof o.src === 'string' && o.src) o.src = photoUrl(o.src);
      Object.keys(o).forEach(function (k) { walk(o[k]); });
    })(c);
    return c;
  }

  // データの文字 → 場所（path）の一覧
  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  function buildIndex(data) {
    var idx = {};
    function walk(v, path, key) {
      if (typeof v === 'string') {
        if (SKIP_KEYS[key] || SKIP_PATH.test(path) || !/[0-9A-Za-z\u3040-\u9fff\uff10-\uff5a]/.test(v)) return;
        var k = norm(v);
        (idx[k] = idx[k] || []).push(path);
      } else if (v && typeof v === 'object') {
        Object.keys(v).forEach(function (k2) { if (k2.charAt(0) !== '_') walk(v[k2], path + '/' + k2, k2); });
      }
    }
    S.roots.forEach(function (r) { if (data[r] !== undefined) walk(data[r], r, r); });
    return idx;
  }
  // 枠の中の文字に印を付ける（そのものずばりの文字だけ）
  function mark(doc) {
    var all = doc.body.querySelectorAll('*:not([data-ed])');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // ボタン（料金のタブなど）はいつもどおり押せるように、印を付けない
      if (/^(SCRIPT|STYLE|IFRAME|SVG|NAV|SELECT|OPTION|BUTTON)$/i.test(el.tagName) || el.getAttribute('role') === 'tab' || el.closest('nav,.hd,footer,.tabs')) continue;
      var full = norm(el.textContent);
      var key = null;
      // 中に別の要素（表の行のマスなど）を持たない、いちばん内側の文字だけ
      if (full && S.index[full]) {
        var plain = true;
        for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (!/^(WBR|BR)$/.test(c.tagName)) { plain = false; break; }
        if (plain) key = full;
      }
      if (!key) {
        var own = '';
        for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) own += n.nodeValue;
        own = norm(own);
        if (own && S.index[own] && el.children.length) key = own;
      }
      if (key) el.setAttribute('data-ed', key);
    }
  }

  // どの場所の文字か決める（同じ文字が何か所にもあるときは、まわりの文字で絞る）
  function resolve(el, key) {
    var cands = S.index[key] || [];
    if (cands.length <= 1) return cands;
    var data = previewData();
    function ctxStrings(path) {
      var parts = path.split('/'), parent = data;
      for (var i = 0; i < parts.length - 1; i++) parent = parent[parts[i]];
      var out = [], last = parts[parts.length - 1];
      if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
        Object.keys(parent).forEach(function (k) {
          var v = parent[k];
          if (k === last || typeof v !== 'string' || !v) return;
          if (k === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { var m = +v.slice(5, 7), d = +v.slice(8, 10); out.push('@' + v, m + '月' + d + '日', m + '/' + d); }
          else out.push(norm(v));
        });
        if (/^\d+$/.test(last) === false && parts.length >= 3) {
          // 料金表の1行など：表の見出し（親の親の title）も手がかりにする
          var gp = data; for (var j = 0; j < parts.length - 3; j++) gp = gp[parts[j]];
          if (gp && gp.title) out.push(norm(gp.title));
        }
      }
      return out;
    }
    var scores = cands.map(function () { return 0; });
    var a = el, level = 0;
    while (a && a !== a.ownerDocument.body && level < 7) {
      var txt = norm(a.textContent);
      var dateAttr = a.getAttribute('data-date') || (a.querySelector && a.querySelector(':scope > time[datetime]') ? a.querySelector(':scope > time[datetime]').getAttribute('datetime') : '');
      var hit = false;
      cands.forEach(function (p, i) {
        ctxStrings(p).forEach(function (s) {
          if (s.charAt(0) === '@') { if (dateAttr && dateAttr === s.slice(1)) { scores[i] += 10; hit = true; } }
          else if (s && txt.indexOf(s) >= 0) { scores[i] += 1; hit = true; }
        });
      });
      if (hit) {
        var max = Math.max.apply(null, scores);
        var best = cands.filter(function (p, i) { return scores[i] === max; });
        if (best.length < cands.length) return best;
      }
      a = a.parentElement; level++;
    }
    return cands;
  }

  // ---------- クリック ----------
  function onFrameClick(e) {
    var t = e.target;
    var ph = t.closest && t.closest('[data-photo]');
    if (ph) { e.preventDefault(); e.stopPropagation(); selectPhoto(ph); return; }
    var ed = t.closest && t.closest('[data-ed]');
    var link = t.closest && t.closest('a[href]');
    if (ed) {
      e.preventDefault(); e.stopPropagation();
      select(ed);
      return;
    }
    if (link) {
      e.preventDefault();
      var href = link.getAttribute('href') || '';
      var file = href.split('#')[0];
      var hit = PAGES.filter(function (p) { return p.file === file; })[0];
      if (hit) { S.page = hit.file; $('page').value = hit.file; render(true); }
    }
  }
  function select(el) {
    var doc = el.ownerDocument;
    doc.querySelectorAll('.ed-on').forEach(function (x) { x.classList.remove('ed-on'); });
    el.classList.add('ed-on');
    var paths = resolve(el, el.getAttribute('data-ed'));
    openPanel();
    if (paths.length === 1) return editPath(paths[0]);
    var data = previewData();
    showForm(true);
    $('edit-where').textContent = '同じ文字が' + paths.length + 'か所にあります。どれを直しますか？';
    $('edit-text').hidden = true; $('edit-add').hidden = true;
    $('edit-choose').hidden = false;
    $('edit-choose').innerHTML = paths.slice(0, 12).map(function (p) { return '<button type="button" class="ed-chip" data-path="' + esc(p) + '">' + esc(Core.describe(data, p)) + '</button>'; }).join('');
  }
  $('edit-choose').addEventListener('click', function (e) { var b = e.target.closest('[data-path]'); if (b) editPath(b.getAttribute('data-path')); });
  function editPath(path) {
    var data = previewData();
    var v = path.split('/').reduce(function (o, k) { return o == null ? undefined : o[k]; }, data);
    S.sel = path;
    showForm(true);
    $('edit-choose').hidden = true; $('edit-text').hidden = false; $('edit-add').hidden = false;
    $('edit-where').textContent = Core.describe(data, path);
    $('edit-text').value = v == null ? '' : v;
    $('edit-text').rows = Math.min(10, Math.max(2, Math.ceil(String(v || '').length / 22)));
    $('edit-text').focus();
  }
  function showForm(on) { $('edit-form').hidden = !on; $('photo-form').hidden = true; $('edit-hint').hidden = on; }

  // ---------- 写真 ----------
  function getAt(data, path) { return path.split('/').reduce(function (o, k) { return o == null ? undefined : o[k]; }, data); }
  function selectPhoto(el) {
    var doc = el.ownerDocument;
    doc.querySelectorAll('.ed-on').forEach(function (x) { x.classList.remove('ed-on'); });
    el.classList.add('ed-on');
    var path = el.getAttribute('data-photo');
    openPanel();
    $('edit-form').hidden = true; $('edit-hint').hidden = true; $('photo-form').hidden = false;
    $('photo-where').textContent = Core.describe(previewData(), path);
    if (S.roots.indexOf(path.split('/')[0]) < 0) {
      $('photo-where').textContent += '（担当の項目ではないため、変えられません）';
      S.photo = null; $('photo-add').disabled = true; return;
    }
    var cur = getAt(previewData(), path) || {};
    S.photo = { path: path, src: cur.src || '', dataUrl: '' };
    $('photo-now').hidden = !cur.src; $('photo-none').hidden = !!cur.src;
    if (cur.src) $('photo-now').src = photoUrl(cur.src);
    $('photo-new').hidden = true; $('photo-nonew').hidden = false; $('photo-file').value = '';
    $('photo-alt').value = cur.alt || ''; $('photo-ok').checked = false;
    $('photo-remove').hidden = !cur.src;
    $('photo-info').textContent = 'スマホの写真から選べます。自動で小さくし、撮影場所などの情報は消してから保存します。';
    photoButtons();
  }
  function photoButtons() {
    var P = S.photo;
    $('photo-add').disabled = !P || (P.dataUrl ? !$('photo-ok').checked : !(P.src && $('photo-alt').value !== (getAt(previewData(), P.path) || {}).alt));
    $('photo-add').textContent = P && !P.dataUrl && P.src ? '説明だけ直す' : 'この写真にする';
  }
  $('photo-ok').addEventListener('change', photoButtons);
  $('photo-alt').addEventListener('input', photoButtons);
  $('photo-file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f || !S.photo) return;
    $('photo-info').textContent = '写真を小さくしています…';
    shrink(f).then(function (r) {
      S.photo.dataUrl = r.dataUrl;
      $('photo-new').src = r.dataUrl; $('photo-new').hidden = false; $('photo-nonew').hidden = true;
      $('photo-info').textContent = '小さくしました（' + r.w + '×' + r.h + '・約' + Math.round(r.bytes / 1024) + 'KB）。' + ($('photo-ok').checked ? '' : '下の同意にチェックを入れてください。');
      photoButtons();
    }).catch(function (e) { $('photo-info').textContent = e.message; });
  });
  // 長い辺 1600px の JPEG に。描き直すので、撮影場所などの情報（Exif）は残らない
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, r = Math.min(1, 1600 / Math.max(w, h));
        var cw = Math.round(w * r), ch = Math.round(h * r);
        var c = document.createElement('canvas'); c.width = cw; c.height = ch;
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch); g.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        var q = 0.82, d = c.toDataURL('image/jpeg', q);
        while (d.length * 0.75 > 700000 && q > 0.5) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
        if (d.indexOf('data:image/jpeg;base64,') !== 0) return reject(new Error('この写真は使えませんでした。別の写真でお試しください。'));
        resolve({ dataUrl: d, w: cw, h: ch, bytes: Math.round((d.length - 23) * 0.75) });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('この写真は読み込めませんでした。別の写真でお試しください。')); };
      img.src = url;
    });
  }
  function newPhotoName() {
    var t = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return 'images/' + t.slice(0, 8) + '-' + t.slice(8) + '-' + Math.random().toString(36).slice(2, 6) + '.jpg';
  }
  $('photo-add').addEventListener('click', function () {
    var P = S.photo; if (!P) return;
    var src = P.src;
    if (P.dataUrl) { src = newPhotoName(); S.files[src] = P.dataUrl; }
    addChanges([{ op: 'set', path: P.path, value_json: JSON.stringify({ src: src, alt: $('photo-alt').value.trim() }), summary: P.dataUrl ? '写真を差し替え' : '写真の説明' }]);
    S.photo = null; showForm(false); unmarkOn();
  });
  $('photo-remove').addEventListener('click', function () {
    var P = S.photo; if (!P) return;
    addChanges([{ op: 'set', path: P.path, value_json: JSON.stringify({ src: '', alt: '' }), summary: '写真を外す' }]);
    S.photo = null; showForm(false); unmarkOn();
  });
  $('photo-cancel').addEventListener('click', function () { S.photo = null; showForm(false); unmarkOn(); });
  $('edit-cancel').addEventListener('click', function () { S.sel = null; showForm(false); unmarkOn(); });
  function unmarkOn() { try { $('site').contentDocument.querySelectorAll('.ed-on').forEach(function (x) { x.classList.remove('ed-on'); }); } catch (e) { /* なし */ } }
  $('edit-add').addEventListener('click', function () {
    if (!S.sel) return;
    var v = $('edit-text').value.replace(/\r/g, '');
    var path = S.sel;
    addChanges([{ op: 'set', path: path, value_json: JSON.stringify(v), summary: '' }]);
    S.sel = null; showForm(false);
  });

  // ---------- 変更点 ----------
  function addChanges(list) {
    // 同じ場所への「置きかえ」は新しい方だけ残す
    list.forEach(function (c) {
      if (c.op === 'set') S.pending = S.pending.filter(function (p) { return !(p.op === 'set' && p.path === c.path); });
      S.pending.push(c);
    });
    try { Core.applyChanges(S.base, S.pending, S.allowed, '*'); }
    catch (e) { S.pending = S.pending.slice(0, S.pending.length - list.length); msg(e.message, true); return; }
    msg('');
    renderPending(); render(false);
  }
  function renderPending() {
    gripLabel();
    if (!S.pending.length) {
      $('pending').innerHTML = '<p class="ed-hint">まだありません。HPのプレビューには、加えた変更がすぐ映ります。</p>';
      $('apply').disabled = true; $('clear').hidden = true; return;
    }
    var rows = Core.applyChanges(S.base, S.pending, S.allowed, '*').rows;
    $('pending').innerHTML = rows.map(function (r, i) {
      if (Core.isPhotoPath(r.path) && S.pending[i].op === 'set') {
        var b = getAt(S.base, r.path) || {}, a = {};
        try { a = JSON.parse(S.pending[i].value_json) || {}; } catch (e) { a = {}; }
        var th = function (p) { return p && p.src ? '<img src="' + esc(photoUrl(p.src)) + '" alt="">' + (p.alt ? esc(p.alt) : '') : '（写真なし）'; };
        return '<div class="ed-row"><p class="ed-where">' + esc(r.where) + '<button type="button" class="ed-x" data-del="' + i + '" aria-label="この変更をやめる">×</button></p>' +
          '<div class="ed-ba"><div class="b"><span>いま</span>' + th(b) + '</div><div class="a"><span>変更後</span>' + th(a) + '</div></div></div>';
      }
      return '<div class="ed-row"><p class="ed-where">' + esc(r.where) + '<button type="button" class="ed-x" data-del="' + i + '" aria-label="この変更をやめる">×</button></p>' +
        '<div class="ed-ba"><div class="b"><span>いま</span>' + nl(r.before) + '</div><div class="a"><span>変更後</span>' + nl(r.after) + '</div></div></div>';
    }).join('');
    $('apply').disabled = false; $('apply').textContent = '3. まとめてHPに反映する（' + rows.length + '件）';
    $('clear').hidden = false;
  }
  $('pending').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]'); if (!b) return;
    S.pending.splice(+b.getAttribute('data-del'), 1);
    renderPending(); render(false);
  });
  $('clear').addEventListener('click', function () {
    if (!window.confirm('加えた変更を全部やめますか？')) return;
    S.pending = []; renderPending(); render(false); msg('');
  });
  $('apply').addEventListener('click', function () {
    if (S.busy || !S.pending.length) return;
    S.busy = true; this.disabled = true; msg('反映しています…');
    // 新しい写真のファイルも一緒に送る（変更の中で使っているものだけ）
    var files = Core.photoSrcs(S.pending).filter(function (src) { return S.files[src]; })
      .map(function (src) { return { path: src, b64: S.files[src].split(',')[1] }; });
    A.call('apply', { area: '*', changes: S.pending, sha: S.sha, files: files, consent: files.length > 0 }).then(function (res) {
      S.busy = false;
      if (!res.ok) { msg(res.message, true); $('apply').disabled = false; return; }
      S.pending = [];
      msg(res.message + (res.commit ? '　元に戻すときは「更新ページ」の「最近の更新」から。' : ''));
      renderPending();
      loadState();
    });
  });

  // ---------- AIに頼む ----------
  function renderExamples() {
    var id = $('ai-area').value;
    $('ai-ex').innerHTML = A.DEMO ? (A.Mock.examples[id] || []).map(function (t) { return '<button type="button" class="ed-chip">' + esc(t) + '</button>'; }).join('') : '';
  }
  $('ai-area').addEventListener('change', renderExamples);
  $('ai-ex').addEventListener('click', function (e) { var b = e.target.closest('.ed-chip'); if (b) { $('ai-text').value = b.textContent; ask(); } });
  $('ai-send').addEventListener('click', ask);
  function ask() {
    var text = $('ai-text').value.trim();
    if (!text || S.busy) return;
    S.busy = true; $('ai-send').disabled = true; $('ai-reply').textContent = '考えています…';
    A.call('chat', { area: $('ai-area').value, message: text, history: [] }).then(function (res) {
      S.busy = false; $('ai-send').disabled = false;
      if (!res.ok) { $('ai-reply').textContent = res.message; return; }
      $('ai-reply').textContent = res.reply + (res.changes && res.changes.length ? '（変更点の表に加えました）' : '');
      if (res.changes && res.changes.length) { $('ai-text').value = ''; addChanges(res.changes); }
    });
  }

  // ---------- 小物 ----------
  // 文字をタップしたときは、直す欄が見える広さ（画面の4割以上）で開く
  function openPanel() {
    setPanel(true);
    var p = $('panel'), w = p.parentNode.clientHeight;
    if (NARROW.matches && p.offsetHeight < w * 0.4) p.style.height = Math.round(w * 0.45) + 'px';
    // パネルが開いて狭くなっても、選んだ所が見えるように
    if (NARROW.matches) setTimeout(function () { try { var on = $('site').contentDocument.querySelector('.ed-on'); if (on) on.scrollIntoView({ block: 'center' }); } catch (e) { /* なし */ } }, 60);
  }
  function setPanel(open) {
    $('panel').classList.toggle('closed', !open);
    if (open && NARROW.matches) $('panel').style.height = lastH ? Math.min(lastH, $('panel').parentNode.clientHeight - 60) + 'px' : '';
    $('grip').setAttribute('aria-expanded', String(open));
    gripLabel();
  }
  function gripLabel() {
    var open = !$('panel').classList.contains('closed'), n = S.pending.length;
    $('grip').textContent = open ? '▼ タップで閉じる（上下に動かすと広さが変わります）' : '▲ 編集パネルを開く' + (n ? '（変更 ' + n + '件）' : '（直したい文字・写真をタップ）');
  }
  function msg(t, err) { $('msg').textContent = t || ''; $('msg').className = 'ed-msg' + (err ? ' err' : ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nl(s) { return esc(s).replace(/\n/g, '<br>'); }
  window.__abenoEdit = S; // テスト用
})();
