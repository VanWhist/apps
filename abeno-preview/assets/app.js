/* data/site-data.js の中身を画面に流し込む */
(function () {
  var D = window.SITE_DATA || {};
  var TMP = '<span class="tmp">仮</span>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function get(path) {
    if (path in D) return D[path];
    if (D.club && path in D.club) return D.club[path];
    return path.split('.').reduce(function (o, k) { return o ? o[k] : undefined; }, D);
  }
  // 日付は '2026-11-04' の文字のまま扱う（new Date('...') は端末の時差で1日ずれるため使わない）
  function ymd(iso) { var p = String(iso).split('-'); return [+p[0], +p[1], +p[2]]; }
  function fmtDate(iso) {
    var d = ymd(iso);
    return isNaN(d[2]) ? iso : d[0] + '年' + d[1] + '月' + d[2] + '日';
  }
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  function weekday(iso) { var d = ymd(iso); return WD[new Date(Date.UTC(d[0], d[1] - 1, d[2])).getUTCDay()]; }
  var schedRow = 'キッズ';
  var schedView = 'cal';
  // 表示する月（データにある最初の月）。'2026-11' の形
  var schedMonth = (((D.schedule || {}).days || [])[0] || {}).date;
  schedMonth = schedMonth ? schedMonth.slice(0, 7) : '';
  var schedPick = null; // カレンダーでタップした日
  function schedMonths() {
    var seen = {}, out = [];
    ((D.schedule || {}).days || []).forEach(function (d) { var m = d.date.slice(0, 7); if (!seen[m]) { seen[m] = 1; out.push(m); } });
    return out;
  }
  function dayCells(d, show) {
    return show.filter(function (r) { return d[r]; }).map(function (r) {
      return { row: r, text: d[r], off: d[r] === '休み' };
    });
  }

  function table(t) {
    var head = (t.head || []).length ? '<thead><tr>' + t.head.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') + '</tr></thead>' : '';
    var rows = (t.rows || []).map(function (r) {
      return '<tr>' + r.map(function (c, i) { return i ? '<td>' + esc(c) + '</td>' : '<th scope="row">' + esc(c) + '</th>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="dtable"><h4>' + esc(t.caption) + '</h4>' + (t.lead ? '<p class="dt-lead">' + esc(t.lead) + '</p>' : '') +
      '<div class="dt-wrap"><table>' + head + '<tbody>' + rows + '</tbody></table></div>' +
      ((t.notes || []).length ? '<ul class="dt-notes">' + t.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
  }

  var PAGES = [
    { page: 'index', href: 'index.html', label: 'トップ' },
    { page: 'class', href: 'class.html', label: 'クラス・料金' },
    { page: 'schedule', href: 'index.html#schedule', label: '練習日カレンダー' },
    { page: 'apply', href: 'apply.html', label: '体験の申込み' },
    { page: 'news', href: 'news.html', label: 'お知らせ' },
    { page: 'activity', href: 'activity.html', label: '活動・動画' },
    { page: 'adult', href: 'adult.html', label: '大人のクラス' },
    { page: 'club', href: 'club.html', label: 'クラブ案内・アクセス' }
  ];
  function sortedNews() { return (D.news || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }); }
  function newsId(n) { return 'n-' + n.date; }
  // 将来の GAS（Instagram の投稿一覧を JSON で返す）用。[{permalink, media_url, thumbnail_url, caption}] を想定
  function loadFeed(url, el, max) {
    fetch(url).then(function (r) { return r.json(); }).then(function (list) {
      var box = el.querySelector('[data-ig-grid]'); if (!box) return;
      box.innerHTML = (list.data || list || []).slice(0, max).map(function (p) {
        var img = p.thumbnail_url || p.media_url;
        return '<a href="' + esc(p.permalink) + '" target="_blank" rel="noopener"><img src="' + esc(img) + '" alt="' + esc((p.caption || 'Instagram の投稿').slice(0, 60)) + '" loading="lazy"></a>';
      }).join('');
    }).catch(function () {
      var box = el.querySelector('[data-ig-grid]'); if (box) box.innerHTML = '';
    });
  }

  var R = {
    rental: function () {
      var r = D.rental; if (!r) return '';
      return '<p class="rental-lead">' + esc(r.lead) + '</p><ul class="dt-notes">' + (r.notes || []).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' +
        '<p class="rental-eq">' + esc(r.equipment) + '</p>' +
        table({ caption: r.caption, rows: r.rows }) +
        '<a class="btn btn-ink" href="' + esc(D.club.formUrl) + '" target="_blank" rel="noopener">' + esc(r.contact) + '<i aria-hidden="true">→</i></a>';
    },
    worries: function () {
      return (D.worries || []).map(function (w, i) {
        return '<div class="worry"><p class="worry-q"><span class="n">0' + (i + 1) + '</span>' + esc(w.q) + '</p>' +
               '<p class="worry-a">' + esc(w.a) + '</p></div>';
      }).join('');
    },
    classes: function () {
      return (D.classes || []).map(function (c) {
        var times = (c.times || []).map(function (t) {
          return '<li>' + (t.day ? '<b class="day">' + esc(t.day) + '</b>' : '') + '<span>' + esc(t.time) + '</span></li>';
        }).join('');
        return '<article class="cls' + (c.featured ? ' featured' : '') + '" id="c-' + esc(c.id) + '">' +
          '<p class="cls-label">' + esc(c.label) + '</p>' +
          '<h3>' + esc(c.name) + '</h3>' +
          (c.age ? '<p class="cls-age">対象：' + esc(c.age) + (c.ageTmp ? TMP : '') + '</p>' : '') +
          '<p class="cls-desc">' + esc(c.desc) + '</p>' +
          '<ul class="times">' + times + '</ul></article>';
      }).join('');
    },
    schedFilter: function () {
      var rows = ((D.schedule || {}).rows || []).concat(['すべて']);
      return rows.map(function (r) {
        return '<button type="button" aria-pressed="' + (r === schedRow) + '" data-row="' + esc(r) + '">' + esc(r) + '</button>';
      }).join('');
    },
    schedList: function () {
      var S = D.schedule || {}, rows = S.rows || [];
      var show = schedRow === 'すべて' ? rows : [schedRow];
      var items = (S.days || []).map(function (d) {
        var cells = show.filter(function (r) { return d[r]; }).map(function (r) {
          var off = d[r] === '休み';
          return '<span class="sc' + (off ? ' off' : '') + '">' + (show.length > 1 ? '<b>' + esc(r) + '</b>' : '') + esc(d[r]) + '</span>';
        });
        if (!cells.length) return '';
        var md = ymd(d.date), wd = weekday(d.date);
        var cls = (wd === '日' || d.holiday) ? ' sun' : (wd === '土' ? ' sat' : '');
        return '<li><time class="sd' + cls + '" datetime="' + esc(d.date) + '">' + md[1] + '/' + md[2] + '<small>（' + wd + '）</small></time><div>' + cells.join('') + '</div></li>';
      }).join('');
      return items || '<li class="empty">この月の予定はありません</li>';
    },
    // 月カレンダー。将来は各日のマスに「体験OK 残り2」「満員」などの印を足せる作り
    schedCal: function () {
      var S = D.schedule || {}, rows = S.rows || [];
      var show = schedRow === 'すべて' ? rows : [schedRow];
      var byDate = {};
      (S.days || []).forEach(function (d) { byDate[d.date] = d; });
      var months = schedMonths(), mi = months.indexOf(schedMonth);
      var y = +schedMonth.slice(0, 4), m = +schedMonth.slice(5, 7);
      var first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
      var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      var head = '<div class="cal-head"><button type="button" class="cal-nav" data-month="' + (months[mi - 1] || '') + '"' + (mi > 0 ? '' : ' disabled') + ' aria-label="前の月">‹</button>' +
        '<p class="cal-month">' + y + '年' + m + '月</p>' +
        '<button type="button" class="cal-nav" data-month="' + (months[mi + 1] || '') + '"' + (mi < months.length - 1 ? '' : ' disabled') + ' aria-label="次の月">›</button></div>';
      var wk = '<div class="cal-grid cal-wd" aria-hidden="true">' + WD.map(function (w, i) {
        return '<span class="' + (i === 0 ? 'sun' : i === 6 ? 'sat' : '') + '">' + w + '</span>';
      }).join('') + '</div>';
      var cells = '';
      for (var i = 0; i < first; i++) cells += '<span class="cal-cell empty"></span>';
      for (var dd = 1; dd <= last; dd++) {
        var iso = schedMonth + '-' + ('0' + dd).slice(-2), d = byDate[iso], wdI = (first + dd - 1) % 7;
        var cls = 'cal-cell' + ((wdI === 0 || (d && d.holiday)) ? ' sun' : wdI === 6 ? ' sat' : '');
        var items = d ? dayCells(d, show) : [];
        var inner = '<span class="cal-d">' + dd + '</span>';
        if (show.length === 1) {
          inner += items.map(function (c) { return '<span class="cal-t' + (c.off ? ' off' : '') + '">' + esc(c.text).replace(/([-\/～])/g, '$1<wbr>') + '</span>'; }).join('');
        } else {
          inner += '<span class="cal-dots">' + items.map(function (c) {
            return '<i class="dot r' + rows.indexOf(c.row) + (c.off ? ' off' : '') + '" title="' + esc(c.row) + '"></i>';
          }).join('') + '</span>';
        }
        var label = m + '月' + dd + '日（' + WD[wdI] + '）' + (items.length ? '、' + items.map(function (c) { return c.row + ' ' + c.text; }).join('、') : '、予定なし');
        cells += items.length
          ? '<button type="button" class="' + cls + ' has' + (schedPick === iso ? ' picked' : '') + '" data-date="' + iso + '" aria-label="' + esc(label) + '">' + inner + '</button>'
          : '<span class="' + cls + '" aria-label="' + esc(label) + '">' + inner + '</span>';
      }
      var legend = show.length > 1 ? '<p class="cal-legend">' + rows.map(function (r, i) { return '<span><i class="dot r' + i + '"></i>' + esc(r) + '</span>'; }).join('') + '</p>' : '';
      var detail = '';
      if (schedPick && byDate[schedPick] && schedPick.slice(0, 7) === schedMonth) {
        var pd = byDate[schedPick], md = ymd(schedPick);
        detail = '<div class="cal-detail"><p class="cal-detail-h">' + md[1] + '/' + md[2] + '（' + weekday(schedPick) + '）</p><ul>' +
          dayCells(pd, rows).map(function (c) { return '<li><b>' + esc(c.row) + '</b>' + esc(c.text) + '</li>'; }).join('') + '</ul></div>';
      } else {
        detail = '<p class="cal-hint">日付をタップすると、その日の予定がすべて出ます。</p>';
      }
      return head + wk + '<div class="cal-grid">' + cells + '</div>' + legend + detail;
    },
    flash: function () {
      var f = D.flash; if (!f) return '';
      return '<p class="flash-label">' + esc(f.label) + '</p><p class="flash-text">' + (f.lines || []).map(esc).join('<br>') + '</p>' +
        (f.recruit ? '<p class="flash-recruit">' + f.recruit.map(esc).join('<br>') + '</p>' : '');
    },
    adult: function () {
      return (D.adult || []).map(function (a) {
        return '<div><p class="adult-lead">' + esc(a.lead) + '</p><h3>' + esc(a.name) + '</h3><p class="adult-target">' + esc(a.target) + '</p>' +
          '<p>' + esc(a.text) + '</p><ul class="adult-times">' + (a.times || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
          (a.timesNote ? '<p class="adult-note">' + esc(a.timesNote) + '</p>' : '') +
          (a.extra ? '<p class="adult-extra">' + esc(a.extra) + '</p>' : '') +
          (a.tables || []).map(table).join('') + '</div>';
      }).join('');
    },
    feeTabs: function () {
      return (D.fees || []).map(function (f, i) {
        return '<button type="button" role="tab" id="fee-tab-' + i + '" aria-controls="fee-panel-' + i + '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '" data-tab="' + i + '">' + esc(f.title) + '</button>';
      }).join('');
    },
    feeTables: function () {
      return (D.fees || []).map(function (f, i) {
        var rows = f.rows.map(function (r) {
          return '<tr' + (r.highlight ? ' class="hl"' : '') + '><th>' + esc(r.item) + '</th><td><b>' + esc(r.price) + '</b>' +
                 (r.note ? '<small>' + esc(r.note) + '</small>' : '') + '</td></tr>';
        }).join('');
        var note = f.note ? '<p class="fee-note">' + esc(f.note) + '</p>' : '';
        var total = f.total ? '<div class="total"><span>' + esc(f.total.label) + (f.total.tmp ? TMP : '') + '</span><b>' + esc(f.total.price) + '</b></div>' : '';
        return '<div class="fee" role="tabpanel" id="fee-panel-' + i + '" aria-labelledby="fee-tab-' + i + '" tabindex="0" data-panel="' + i + '"' + (i ? ' hidden' : '') + '><table><caption class="sr">' + esc(f.title) + 'の料金</caption>' + rows + '</table>' + note + total + '</div>';
      }).join('');
    },
    steps: function () {
      return ((D.trial || {}).steps || []).map(function (s) {
        return '<li><h3>' + esc(s.title) + '</h3><p>' + esc(s.text) + (s.tmp ? TMP : '') + '</p></li>';
      }).join('');
    },
    bring: function () {
      var t = D.trial || {};
      return '<h3>服装・持ちもの' + (t.bringTmp ? TMP : '') + '</h3><ul>' +
        (t.bring || []).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') +
        '</ul>' + (t.bringNote ? '<p>' + esc(t.bringNote) + '</p>' : '');
    },
    coaches: function () {
      return (D.coaches || []).map(function (c) {
        return '<div class="coach"><div class="avatar"><span>写真</span></div><div><p class="coach-role">' + esc(c.role) + '</p>' +
          '<h3>' + esc(c.name) + (c.tmp ? TMP : '') + '</h3><p>' + esc(c.text) + '</p></div></div>';
      }).join('');
    },
    faq: function () {
      return (D.faq || []).map(function (f) {
        return '<details><summary>' + esc(f.q) + '</summary><div class="ans">' + esc(f.a) + (f.tmp ? TMP : '') + '</div></details>';
      }).join('');
    },
    // 全ページ共通のメニュー（ページを足すときは PAGES に1行足す）
    siteNav: function () {
      var here = document.body.getAttribute('data-page') || 'index';
      return PAGES.map(function (p) {
        var cur = p.page === here ? ' aria-current="page"' : '';
        return '<a href="' + p.href + '"' + cur + '>' + esc(p.label) + '</a>';
      }).join('');
    },
    // トップの料金の要約（キッズの料金表から 体験・いちばん安い月謝・入会金 を拾う）
    feeSummary: function () {
      var k = (D.fees || []).filter(function (f) { return f.classId === 'kids'; })[0];
      if (!k) return '';
      function pick(name) { return (k.rows || []).filter(function (r) { return r.item === name; })[0]; }
      var items = [['体験', pick('体験'), ''], ['キッズ月謝', pick('月謝'), '〜'], ['入会金', pick('入会金'), '']];
      return '<ul class="fsum">' + items.filter(function (x) { return x[1]; }).map(function (x) {
        return '<li><span>' + esc(x[0]) + '</span><b>' + esc(x[1].price) + x[2] + '</b><small>' + esc(x[1].note || '') + '</small></li>';
      }).join('') + '</ul>';
    },
    // トップ用の短いクラス紹介（詳しくは class.html）
    classesMini: function () {
      return (D.classes || []).map(function (c) {
        var days = (c.times || []).map(function (t) { return t.day; }).filter(function (d, i, a) { return d && a.indexOf(d) === i; });
        return '<a class="cmini' + (c.featured ? ' featured' : '') + '" href="class.html#c-' + esc(c.id) + '">' +
          '<span class="cmini-label">' + esc(c.label) + '</span><b>' + esc(c.name) + '</b>' +
          (days.length ? '<span class="cmini-days">' + days.map(esc).join('・') + '</span>' : '') + '</a>';
      }).join('');
    },
    // トップ用：新しいお知らせ3件（全件は news.html）
    newsMini: function () {
      return sortedNews().slice(0, 3).map(function (n) {
        return '<li><a href="news.html#' + newsId(n) + '"><time datetime="' + esc(n.date) + '">' + fmtDate(n.date) + '</time><span>' + esc(n.title) + '</span></a></li>';
      }).join('');
    },
    // Instagram の最新投稿。feedUrl（GAS）→ widgetUrl（LightWidget 等）→ ボタンだけ、の順
    instagram: function (el) {
      var g = D.instagram || {}, max = +(el && el.getAttribute('data-max')) || 9;
      var link = '<a class="btn btn-ink" href="' + esc(g.url) + '" target="_blank" rel="noopener">Instagram @' + esc(g.account) + '<span class="sr">（新しいタブで開きます）</span><i aria-hidden="true">→</i></a>';
      if (g.feedUrl) {
        loadFeed(g.feedUrl, el, max);
        return '<div class="ig-grid" data-ig-grid><p class="ig-wait">読み込み中…</p></div>' + link;
      }
      if (g.widgetUrl) {
        return '<div class="ig-frame"><iframe src="' + esc(g.widgetUrl) + '" title="Instagram の最新投稿" loading="lazy" scrolling="no"></iframe></div>' + link;
      }
      // 個別の投稿URL（instagram.com/p/… や /reel/…）を posts に入れると、公式の投稿埋め込みで並べる
      var posts = (g.posts || []).map(function (u) { var m = /instagram\.com\/(p|reel)\/([\w-]+)/.exec(u); return m && m[1] + '/' + m[2]; }).filter(Boolean);
      if (posts.length) {
        return '<div class="ig-posts">' + posts.slice(0, max).map(function (x) {
          return '<iframe src="https://www.instagram.com/' + x + '/embed/" title="Instagram の投稿" loading="lazy" scrolling="no"></iframe>';
        }).join('') + '</div>' + (g.referenceNote ? '<p class="proto-note">' + esc(g.referenceNote) + '</p>' : '') + link;
      }
      // 参考表示：外部を読み込まない見本。最新投稿が並ぶ場所と見え方だけを示す
      if (g.mock) {
        var tiles = ''; for (var i = 0; i < Math.min(max, 6); i++) tiles += '<span class="ig-tile" aria-hidden="true"></span>';
        return '<div class="ig-card"><p class="ig-head"><span class="ig-logo" aria-hidden="true"></span><b>@' + esc(g.account) + '</b></p>' +
          '<div class="ig-mock">' + tiles + '</div></div>' +
          (g.referenceNote ? '<p class="proto-note">' + esc(g.referenceNote) + '</p>' : '') + link;
      }
      return '<p class="proto-note">試作メモ：ここに最新投稿が並びます（埋め込みの設定待ち。README参照）</p>' + link;
    },
    videos: function (el) {
      var id = el && el.getAttribute('data-group');
      var g = (((D.videos || {}).groups) || []).filter(function (x) { return x.id === id; })[0];
      if (!g) return '';
      var items = g.items || [];
      var lead = (g.lead || []).map(function (t) { return '<p class="vid-lead">' + esc(t) + '</p>'; }).join('');
      var after = g.after ? '<p class="vid-lead">' + esc(g.after) + '</p>' : '';
      if (!items.length) return lead + '<p class="proto-note">試作メモ：動画は現行サイトから移します（URL未取得）</p>';
      return lead + '<div class="vids">' + items.map(function (v) {
        if (v.youtube) {
          return '<figure class="vid"><button type="button" class="vid-play" data-yt="' + esc(v.youtube) + '" aria-label="' + esc(v.title) + 'を再生">' +
            '<img src="https://i.ytimg.com/vi/' + esc(v.youtube) + '/hqdefault.jpg" alt="" loading="lazy"><i aria-hidden="true">▶</i></button>' +
            '<figcaption>' + esc(v.title) + '</figcaption></figure>';
        }
        return '<figure class="vid"><a href="' + esc(v.url) + '" target="_blank" rel="noopener">' + esc(v.title) + '</a></figure>';
      }).join('') + '</div>' + after;
    },
    news: function () {
      return sortedNews().map(function (n) {
        return '<li id="' + newsId(n) + '"><time datetime="' + esc(n.date) + '">' + fmtDate(n.date) + '</time><span class="tag">' + esc(n.tag) + '</span>' +
          (n.body ? '<details><summary>' + esc(n.title) + '</summary><p class="news-body">' + esc(n.body) + '</p></details>' : '<p>' + esc(n.title) + '</p>') + '</li>';
      }).join('');
    },
    sns: function () {
      return ((D.club || {}).sns || []).map(function (s) {
        return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + '<span class="sr">（新しいタブで開きます）</span></a>';
      }).join('');
    }
  };

  document.querySelectorAll('[data-render]').forEach(function (el) {
    var fn = R[el.getAttribute('data-render')];
    if (fn) el.innerHTML = fn(el);
  });

  // お知らせページ：URLの #n-日付 の記事を開いておく
  if (location.hash.indexOf('#n-') === 0) {
    var hit = document.getElementById(location.hash.slice(1));
    var det = hit && hit.querySelector('details');
    if (det) { det.open = true; hit.scrollIntoView(); }
  }

  // 動画は押したときだけ YouTube を読み込む（ページを軽くするため）
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.vid-play'); if (!b) return;
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(b.getAttribute('data-yt')) + '?autoplay=1&playsinline=1';
    f.title = b.getAttribute('aria-label').replace(/を再生$/, '');
    f.allow = 'autoplay; encrypted-media; picture-in-picture'; f.allowFullscreen = true;
    b.replaceWith(f);
  });
  document.querySelectorAll('[data-text]').forEach(function (el) {
    var v = get(el.getAttribute('data-text'));
    if (v != null) el.textContent = v;
  });
  document.querySelectorAll('[data-href]').forEach(function (el) {
    var v = get(el.getAttribute('data-href'));
    if (v) el.setAttribute('href', v);
  });

  // スケジュールの絞り込み
  var sf = document.querySelector('.sched-filter'), sl = document.querySelector('.sched-list'),
      sc = document.querySelector('.sched-cal'), sv = document.querySelector('.sched-view');
  function redrawSched() { if (sl) sl.innerHTML = R.schedList(); if (sc) sc.innerHTML = R.schedCal(); }
  if (sf) sf.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    schedRow = b.getAttribute('data-row');
    sf.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
    redrawSched();
  });
  if (sv) sv.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    schedView = b.getAttribute('data-view');
    sv.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
    sc.hidden = schedView !== 'cal'; sl.hidden = schedView !== 'list';
  });
  if (sc) sc.addEventListener('click', function (e) {
    var nav = e.target.closest('.cal-nav');
    if (nav) { if (nav.getAttribute('data-month')) { schedMonth = nav.getAttribute('data-month'); schedPick = null; sc.innerHTML = R.schedCal(); } return; }
    var c = e.target.closest('.cal-cell.has'); if (!c) return;
    var iso = c.getAttribute('data-date');
    schedPick = schedPick === iso ? null : iso;
    sc.innerHTML = R.schedCal();
    var nb = sc.querySelector('[data-date="' + iso + '"]'); if (nb) nb.focus();
  });

  // 料金タブ（矢印キーでも切り替え。WAI-ARIA のタブの作法）
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [role=tab]'));
  function selectTab(t, focus) {
    var i = t.getAttribute('data-tab');
    tabs.forEach(function (x) {
      var on = x === t;
      x.setAttribute('aria-selected', on);
      x.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== i; });
    if (focus) t.focus();
  }
  tabs.forEach(function (t, n) {
    t.addEventListener('click', function () { selectTab(t); });
    t.addEventListener('keydown', function (e) {
      var k = e.key, j = null;
      if (k === 'ArrowRight') j = (n + 1) % tabs.length;
      else if (k === 'ArrowLeft') j = (n - 1 + tabs.length) % tabs.length;
      else if (k === 'Home') j = 0;
      else if (k === 'End') j = tabs.length - 1;
      if (j !== null) { e.preventDefault(); selectTab(tabs[j], true); }
    });
  });

  // メニュー（Esc でも閉じる）
  var btn = document.querySelector('.menu-btn'), nav = document.getElementById('nav');
  function setMenu(open) { nav.hidden = !open; btn.setAttribute('aria-expanded', open); }
  btn.addEventListener('click', function () { setMenu(nav.hidden); });
  nav.addEventListener('click', function (e) { if (e.target.tagName === 'A') setMenu(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !nav.hidden) { setMenu(false); btn.focus(); }
  });

  // 検索エンジン向けの構造化データ（クラブ名・住所・SNS）。中身は site-data.js から作る
  var c = D.club || {};
  var m = /〒?(\d{3}-\d{4})\s*(大阪府)(.+?[市町村])(.+)/.exec(c.address || '');
  var ld = {
    '@context': 'https://schema.org',
    '@type': 'SportsClub',
    name: c.name,
    sport: 'トランポリン',
    description: (document.querySelector('meta[name=description]') || {}).content,
    foundingDate: c.foundedISO,
    address: m ? { '@type': 'PostalAddress', postalCode: m[1], addressRegion: m[2], addressLocality: m[3], streetAddress: m[4].trim(), addressCountry: 'JP' } : c.address,
    sameAs: (c.sns || []).map(function (x) { return x.url; })
  };
  var ldEl = document.createElement('script');
  ldEl.type = 'application/ld+json';
  ldEl.textContent = JSON.stringify(ld);
  document.head.appendChild(ldEl);
})();
