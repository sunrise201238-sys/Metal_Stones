/* ============================================================
   設定ファイル / Configuration
   この2か所を自分の情報に書き換えてください。
   Edit the two sections below for your own GitHub repo.
   ============================================================ */
window.APP_CONFIG = {
  github: {
    owner: 'sunrise201238-sys', // ← あなたのGitHubユーザー名
    repo: 'Metal_Stones',       // ← リポジトリ名
    branch: 'main',                // 通常は main のまま
    dataPath: 'prices.json',       // 価格データのファイル名（変更不要）

    // 編集用トークンをパスワードで暗号化（スクランブル）した文字列。
    // encrypt-token.html で作成し、ここに貼り付けてください。
    // The edit token, scrambled with your password. Generate it with
    // encrypt-token.html and paste the result between the quotes below.
    encToken: '',
  },
};
