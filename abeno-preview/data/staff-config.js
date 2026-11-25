/*
 * スタッフ用更新ページ（staff.html）の設定
 * ------------------------------------------------------------
 * api : スタッフ用 GAS（gas/staff/Code.gs）を公開したときの /exec のURL。
 *       空のあいだは「確認モード」で動きます（ログインは見本、AIの返事は決まった言い方だけの見本、
 *       反映はこの画面の中だけで、HPにもメールにも何も起きません）。
 * URL自体は秘密ではありません。APIキーやGitHubの鍵はここに書かないこと（GAS のスクリプト プロパティだけに置く）。
 */
window.STAFF_CONFIG = {
  "api": "https://script.google.com/macros/s/AKfycbz3Mb0jZ75S8He8ajWB47oY_A7olt59jFuUbzCzPRzVcp9HEYoYm10FWuUpMHBeo6F2OA/exec",
  "siteUrl": "index.html"
};
