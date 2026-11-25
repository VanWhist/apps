/*
 * スタッフ用更新ページの共通処理（ブラウザと GAS の両方で使う）
 * ------------------------------------------------------------
 * ・どの項目を誰が変えてよいか（AREAS）
 * ・変更案（changes）の検査と適用、変更点の表（rows）づくり
 * ・site-data.js の読み書き（先頭の説明コメントはそのまま残す）
 * GAS では、このファイルの中身をそのまま「Core.gs」として貼り付ける。
 *
 * 変更案の形（Claude が返すもの）:
 *   { op: "set" | "add" | "remove", path: "news/0/title", value_json: "\"新しい題名\"", summary: "…" }
 *   path は site-data の場所を「/」区切りで。配列は 0 から数える。add の最後に "-" で末尾に追加。
 */
var StaffCore = (function () {
  'use strict';

  // 更新できる項目。roots の外は誰も変えられない（club の住所・SNS などは対象外）
  var AREAS = [
    { id: 'news', label: 'お知らせ', roots: ['news'], hint: '新しいお知らせの追加・直し・削除' },
    { id: 'schedule', label: '練習日（スケジュール）', roots: ['schedule'], hint: '休み・時間の変更、行事の追加' },
    { id: 'flash', label: '速報（トップの大きな文字）', roots: ['flash'], hint: '速報の文、募集の文' },
    { id: 'fees', label: '料金', roots: ['fees', 'feeNote'], hint: '月謝・入会金などの金額と説明' },
    { id: 'classes', label: 'クラス・時間割', roots: ['classes'], hint: 'クラスの説明、曜日と時間' },
    { id: 'trial', label: '体験の案内', roots: ['trial'], hint: '体験の流れ・持ち物' },
    { id: 'adult', label: '大人のクラス', roots: ['adult'], hint: 'ETC・ちょいトラ・親子' },
    { id: 'rental', label: '場所貸し', roots: ['rental'], hint: '場所貸しの料金と注意' },
    { id: 'videos', label: '動画', roots: ['videos'], hint: 'YouTube 動画の追加・並べ替え' },
    { id: 'photos', label: '写真（トップ・クラブ案内）', roots: ['photos'], hint: 'トップとクラブ案内の写真（編集モードで差し替え）', photoOnly: true }
  ];
  // 写真ファイルの名前の決まり（HPの images フォルダの JPEG だけ。外のURLや data: は入れない）
  var PHOTO_RE = /^images\/[a-z0-9][a-z0-9-]{0,60}\.jpg$/;
  var MAX_PHOTO_BYTES = 1200000;
  var MAX_CHANGES = 40;
  var MAX_VALUE_CHARS = 20000;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // 項目ごとの決まり（壊れたデータを HP に出さないため）
  var CHECKS = {
    news: function (v) {
      if (!Array.isArray(v)) return 'お知らせの形が正しくありません';
      for (var i = 0; i < v.length; i++) {
        var n = v[i] || {};
        if (!DATE_RE.test(n.date || '')) return 'お知らせ' + (i + 1) + '件目の日付が「2026-12-01」の形ではありません';
        if (!String(n.title || '').trim()) return 'お知らせ' + (i + 1) + '件目の題名が空です';
      }
      return '';
    },
    schedule: function (v) {
      if (!v || typeof v !== 'object' || !Array.isArray(v.days)) return 'スケジュールの形が正しくありません';
      for (var i = 0; i < v.days.length; i++) {
        if (!DATE_RE.test((v.days[i] || {}).date || '')) return 'スケジュール' + (i + 1) + '行目の日付が正しくありません';
      }
      return '';
    },
    fees: function (v) { return Array.isArray(v) ? '' : '料金表の形が正しくありません'; },
    classes: function (v) { return Array.isArray(v) ? '' : 'クラスの形が正しくありません'; },
    adult: function (v) { return Array.isArray(v) ? '' : '大人のクラスの形が正しくありません'; }
  };

  // 写真の欄 {src, alt}。src は "" か images/….jpg だけ
  function checkPhoto(p, where) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return where + 'の写真の形が正しくありません';
    var keys = Object.keys(p);
    for (var i = 0; i < keys.length; i++) if (keys[i] !== 'src' && keys[i] !== 'alt') return where + 'の写真に知らない項目があります';
    if (typeof p.src !== 'string' || (p.src !== '' && !PHOTO_RE.test(p.src))) return where + 'の写真の場所が正しくありません';
    if (p.alt != null && (typeof p.alt !== 'string' || p.alt.length > 120)) return where + 'の写真の説明は120文字までです';
    return '';
  }
  // データの中の写真欄（photos の下、または "photo" という項目）をすべて検査
  function checkPhotos(root, v) {
    var msg = '';
    if (root === 'photos') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return '写真の形が正しくありません';
      Object.keys(v).some(function (k) { msg = checkPhoto(v[k], '写真「' + k + '」'); return msg; });
      return msg;
    }
    (function walk(o, depth) {
      if (msg || !o || typeof o !== 'object' || depth > 6) return;
      Object.keys(o).forEach(function (k) {
        if (msg) return;
        if (k === 'photo') msg = checkPhoto(o[k], '');
        else walk(o[k], depth + 1);
      });
    })(v, 0);
    return msg;
  }
  function isPhotoPath(path) { var p = String(path || '').split('/'); return p[0] === 'photos' || p.indexOf('photo') >= 0; }
  // 変更の中で新しく使う写真ファイル（src）の一覧
  function photoSrcs(changes) {
    var out = [];
    (changes || []).forEach(function (c) {
      if (!c || c.op === 'remove' || typeof c.value_json !== 'string') return;
      (function walk(o) {
        if (!o || typeof o !== 'object') return;
        if (typeof o.src === 'string' && PHOTO_RE.test(o.src) && out.indexOf(o.src) < 0) out.push(o.src);
        Object.keys(o).forEach(function (k) { walk(o[k]); });
      })((function () { try { return JSON.parse(c.value_json); } catch (e) { return null; } })());
    });
    return out;
  }
  // 写真ファイル（base64 の JPEG）の検査
  function checkPhotoFile(f, wanted) {
    if (!f || !PHOTO_RE.test(f.path || '')) return '写真ファイルの名前が正しくありません';
    if (wanted.indexOf(f.path) < 0) return '使われていない写真ファイルがあります';
    var b = String(f.b64 || '');
    if (!/^[A-Za-z0-9+\/=]+$/.test(b)) return '写真ファイルの形が正しくありません';
    if (b.length * 3 / 4 > MAX_PHOTO_BYTES) return '写真が大きすぎます';
    if (b.slice(0, 4) !== '/9j/') return '写真は JPEG だけです';
    return '';
  }

  function areaOfPath(path) {
    var root = String(path || '').split('/')[0], hit = null;
    AREAS.forEach(function (a) { if (a.roots.indexOf(root) >= 0) hit = a; });
    return hit;
  }
  function areaById(id) { for (var i = 0; i < AREAS.length; i++) if (AREAS[i].id === id) return AREAS[i]; return null; }

  // 担当の書き方: "全部" / "news,schedule" / "お知らせ、練習日" どれでもよい
  function parseAllowed(text) {
    var s = String(text || '').trim();
    if (!s) return [];
    if (/^(全部|すべて|all|\*)$/i.test(s)) return AREAS.map(function (a) { return a.id; });
    var out = [];
    s.split(/[,、，\s]+/).forEach(function (w) {
      if (!w) return;
      AREAS.forEach(function (a) {
        if ((a.id === w || a.label.indexOf(w) === 0) && out.indexOf(a.id) < 0) out.push(a.id);
      });
    });
    return out;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function splitPath(path) {
    var p = String(path || '').replace(/^\/+|\/+$/g, '');
    if (!p) throw new Error('場所（path）が空です');
    return p.split('/');
  }
  function isIndex(k) { return /^\d+$/.test(k); }

  function getAt(data, parts) {
    var cur = data;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = Array.isArray(cur) ? (isIndex(parts[i]) ? cur[+parts[i]] : undefined) : (Object.prototype.hasOwnProperty.call(cur, parts[i]) ? cur[parts[i]] : undefined);
    }
    return cur;
  }

  function applyOne(data, ch) {
    var parts = splitPath(ch.path);
    if (parts.some(function (k) { return k === '__proto__' || k === 'constructor' || k === 'prototype'; })) throw new Error('使えない場所です: ' + ch.path);
    var key = parts[parts.length - 1];
    var parent = parts.length === 1 ? data : getAt(data, parts.slice(0, -1));
    if (parent == null || typeof parent !== 'object') throw new Error('その場所が見つかりません: ' + ch.path);
    var value;
    if (ch.op !== 'remove') {
      if (typeof ch.value_json !== 'string' || ch.value_json.length > MAX_VALUE_CHARS) throw new Error('新しい内容が長すぎるか、ありません');
      try { value = JSON.parse(ch.value_json); } catch (e) { throw new Error('新しい内容の書き方が正しくありません: ' + ch.path); }
    }
    if (Array.isArray(parent)) {
      if (ch.op === 'add') {
        var at = key === '-' ? parent.length : (isIndex(key) ? +key : -1);
        if (at < 0 || at > parent.length) throw new Error('追加する位置が正しくありません: ' + ch.path);
        parent.splice(at, 0, value);
        return;
      }
      if (!isIndex(key) || +key >= parent.length) throw new Error('その番号はありません: ' + ch.path);
      if (ch.op === 'set') parent[+key] = value;
      else if (ch.op === 'remove') parent.splice(+key, 1);
      else throw new Error('変更のしかたが正しくありません: ' + ch.op);
      return;
    }
    var has = Object.prototype.hasOwnProperty.call(parent, key);
    if (ch.op === 'set' || ch.op === 'add') parent[key] = value;
    else if (ch.op === 'remove') { if (!has) throw new Error('消す項目がありません: ' + ch.path); delete parent[key]; }
    else throw new Error('変更のしかたが正しくありません: ' + ch.op);
  }

  // 人が読める「場所」の名前（変更点の表に出す）
  var FIELD = { date: '日付', title: '題名', body: '本文', tag: '種類', url: 'リンク', price: '金額', item: '項目', note: '説明', name: '名前', desc: '説明', lines: '文', recruit: '募集の文', label: '見出し', time: '時間', day: '曜日', times: '時間割', holiday: '祝日', headNote: '注記', text: '本文', steps: '流れ', bring: '持ち物', rows: '表', items: '動画', youtube: '動画ID', lead: 'リード文', photo: '写真', src: '写真', alt: '写真の説明', top: 'トップ', club: 'クラブ案内' };
  function describe(data, path, op) {
    var parts = splitPath(path);
    var area = null;
    AREAS.forEach(function (a) { if (a.roots.indexOf(parts[0]) >= 0) area = a; });
    var out = [area ? area.label.replace(/（.*）/, '') : parts[0]];
    var cur = data;
    for (var i = 0; i < parts.length; i++) {
      var k = parts[i];
      if (i > 0) {
        if (k === '-') out.push('最後に追加');
        else if (op === 'add' && i === parts.length - 1 && isIndex(k) && Array.isArray(cur)) out.push(+k === 0 ? 'いちばん上に追加' : (+k + 1) + '番目に追加');
        else if (isIndex(k)) {
          var el = cur && cur[+k];
          if (parts[0] === 'schedule' && parts[i - 1] === 'days' && el && el.date) out.push(fmtDate(el.date));
          else if (el && (el.title || el.name || el.item)) out.push((+k + 1) + '番目「' + short(el.title || el.name || el.item, 16) + '」');
          else out.push((+k + 1) + '番目');
        } else if (k !== 'days') out.push(FIELD[k] || k);
      }
      cur = cur == null ? undefined : (Array.isArray(cur) ? cur[+k] : cur[k]);
    }
    return out.join(' › ');
  }
  function fmtDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return s;
    var w = '日月火水木金土'.charAt(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay());
    return (+m[2]) + '/' + (+m[3]) + '(' + w + ')';
  }
  function short(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }
  function show(v) {
    if (v === undefined) return '（なし）';
    if (typeof v === 'string') return v === '' ? '（空）' : v;
    if (typeof v === 'boolean') return v ? 'はい' : 'いいえ';
    if (Array.isArray(v) && v.every(function (x) { return typeof x === 'string'; })) return v.join(' / ');
    if (v && typeof v === 'object') {
      // お知らせ1件・料金1行などは中身を短く並べる
      return Object.keys(v).filter(function (k) { return k.charAt(0) !== '_'; }).map(function (k) {
        var x = v[k];
        return (FIELD[k] || k) + '：' + (typeof x === 'object' ? short(JSON.stringify(x), 40) : short(x, 80));
      }).join('\n');
    }
    return String(v);
  }

  /*
   * 変更案を検査して適用する。
   * allowed: このスタッフが変えてよい項目 id の配列。
   * area: いま開いている項目 id。"*" なら（編集モード用）担当の項目すべての中で変えてよい。
   * 返り値: { data: 変更後, rows: [{where, before, after, summary}] }。だめなら Error を投げる（何も変えない）
   */
  function applyChanges(data, changes, allowed, area) {
    if (!Array.isArray(changes) || !changes.length) throw new Error('変更がありません');
    if (changes.length > MAX_CHANGES) throw new Error('一度に変える数が多すぎます（' + MAX_CHANGES + 'まで）');
    var areas;
    if (area === '*') areas = allowed.map(areaById).filter(Boolean);
    else {
      var a = areaById(area);
      if (!a || allowed.indexOf(area) < 0) throw new Error('この項目を変える権限がありません');
      areas = [a];
    }
    var roots = [];
    areas.forEach(function (x) { roots = roots.concat(x.roots); });
    var label = areas.length === 1 ? '「' + areas[0].label + '」' : '担当の項目';
    var next = clone(data);
    var rows = [], touched = [];
    changes.forEach(function (ch) {
      if (!ch || ['set', 'add', 'remove'].indexOf(ch.op) < 0) throw new Error('変更のしかたが正しくありません');
      var root = splitPath(ch.path)[0];
      if (roots.indexOf(root) < 0) throw new Error(label + '以外の場所は変えられません: ' + ch.path);
      if (touched.indexOf(root) < 0) touched.push(root);
      var parts = splitPath(ch.path);
      var before = ch.op === 'add' && Array.isArray(getAt(next, parts.slice(0, -1))) ? undefined : getAt(next, parts);
      var where = describe(next, ch.path, ch.op);
      applyOne(next, ch);
      rows.push({ op: ch.op, path: ch.path, where: where, before: show(before), after: ch.op === 'remove' ? '（削除）' : show(JSON.parse(ch.value_json)), summary: String(ch.summary || '') });
    });
    touched.forEach(function (r) {
      if (CHECKS[r]) { var msg = CHECKS[r](next[r]); if (msg) throw new Error(msg); }
      var pm = checkPhotos(r, next[r]); if (pm) throw new Error(pm);
    });
    if (JSON.stringify(next).length > 400000) throw new Error('データが大きくなりすぎます');
    return { data: next, rows: rows };
  }

  // Claude に渡す「いまの内容」（担当項目の分だけ）
  function areaData(data, area) {
    var a = areaById(area), out = {};
    if (!a) return out;
    a.roots.forEach(function (r) { if (data[r] !== undefined) out[r] = data[r]; });
    return out;
  }

  // ---- site-data.js の読み書き ----
  var MARK = 'window.SITE_DATA = ';
  function parseFile(text) {
    var i = text.indexOf(MARK);
    if (i < 0) throw new Error('site-data.js の形が想定と違います');
    var body = text.slice(i + MARK.length).replace(/;\s*$/, '');
    return { header: text.slice(0, i), data: JSON.parse(body) };
  }
  function serialize(header, data) { return header + MARK + JSON.stringify(data, null, 2) + ';\n'; }

  return {
    AREAS: AREAS, areaById: areaById, areaOfPath: areaOfPath, parseAllowed: parseAllowed,
    applyChanges: applyChanges, areaData: areaData, describe: describe, fmtDate: fmtDate,
    parseFile: parseFile, serialize: serialize,
    PHOTO_RE: PHOTO_RE, isPhotoPath: isPhotoPath, photoSrcs: photoSrcs, checkPhotoFile: checkPhotoFile
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = StaffCore;
