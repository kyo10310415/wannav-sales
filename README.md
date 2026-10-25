# WannaV Sales管理システム

営業報告を管理してCVRなどの数値を一元管理するシステム

## 機能一覧

### 完了済み機能
- ✅ ログイン機能（JWT認証、初回パスワード変更必須）
- ✅ 権限管理（管理者 / セールス）
- ✅ ユーザー管理画面（CRUD、パスワードリセット）
- ✅ 応募者一覧（Googleスプレッドシート連携、重複除外）
- ✅ 営業報告機能（各応募者へのボタン付き）
- ✅ データ集計（CVR① 面接実施率、CVR② 応募数比）
- ✅ 週次・月次切り替え

## 技術スタック
- **バックエンド**: Node.js + Express
- **データベース**: SQLite (better-sqlite3)
- **認証**: JWT (jsonwebtoken)
- **フロントエンド**: Vanilla JS + HTML/CSS（CDNライブラリ使用）
- **Google連携**: googleapis

## セットアップ

### 環境変数設定
`.env.example` をコピーして `.env` を作成:
```bash
cp .env.example .env
```

必須設定:
- `JWT_SECRET`: 32バイト以上の非公開ランダム値。未設定・短い値・既知の初期値ではDBを開く前に起動を停止します。既存の十分な鍵は維持できます。鍵を交換すると既存のログインは無効になるため、再ログインが必要です。
- `GOOGLE_SERVICE_ACCOUNT_JSON` または `GOOGLE_API_KEY`: Google API認証

Googleカレンダーのユーザー連携では、`GOOGLE_REDIRECT_URI` を実際の本番URLの
`/api/calendar/callback` に設定してください（未設定時は `RENDER_EXTERNAL_URL`、ローカルは
`http://localhost:3000` を使用）。本番URLと同じオリジンで画面を開いてください。
連携開始ごとに10分有効・単回使用のランダムstateを発行し、開始ブラウザの
HttpOnly/SameSite=Lax Cookieに結び付けます。Cookieが無効なブラウザでは連携できません。
stateは単一プロセスのメモリで保持するため、再起動やデプロイで進行中の連携は無効になります。
その場合は画面から連携をやり直してください。複数インスタンス化する場合は、stateの期限管理と
単回消費を共有ストアへ移す必要があります。既に保存済みのGoogle連携は変更しません。
OAuth完了通知は同一オリジンの開始ポップアップからのみ受信し、外部エラー詳細は画面・ログへ出しません。

### ローカル起動
```bash
npm install
npm start
# → http://localhost:3000
```

### 初期ログイン情報
- **ID**: `admin`
- **パスワード**: `1111`（初回ログイン時に変更必須）

## Google Sheets 連携設定

### 方法1: サービスアカウント（推奨）
1. Google Cloud Consoleでサービスアカウントを作成
2. Sheets APIを有効化
3. サービスアカウントにスプレッドシートの閲覧権限を付与
4. JSONキーをダウンロードし、環境変数に設定:
   ```
   GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
   ```

### 方法2: APIキー（公開スプレッドシートのみ）
```
GOOGLE_API_KEY=your-api-key
```

## Renderデプロイ手順

1. GitHubにプッシュ
2. Renderで新規Webサービス作成
3. リポジトリを接続
4. 環境変数を設定（JWT_SECRET, GOOGLE_SERVICE_ACCOUNT_JSON）
5. Diskを追加（Name: wannav-data, Mount Path: /var/data）

## CVR計算式

- **CVR①（面接実施率）**: 契約数 ÷ 面接実施数 × 100
- **CVR②（応募数比）**: 契約数 ÷ 応募数（重複除外）× 100

契約判定: 営業報告の「結果」フィールドに「契約」が含まれる場合

## データベース構造

### users テーブル
| カラム | 説明 |
|--------|------|
| id | 自動採番ID |
| login_id | ログインID |
| name | 表示名 |
| role | 権限（admin/sales）|
| password_hash | パスワードハッシュ |
| must_change_password | 初回パスワード変更フラグ |

### sales_reports テーブル
| カラム | 説明 |
|--------|------|
| id | 自動採番ID |
| interviewer_id | 担当者ID |
| applicant_full_name | 応募者氏名 |
| result | 結果 |
| contract_plan | 契約プラン |
| その他 | 各種情報 |

## One LoopとNode.jsの保護（SEC-047/048）
Node.js指定は22.23.4、enginesは`>=22.23.4 <23`です。RenderのNODE_VERSIONで上書きしている場合も同版以上の22系へそろえ、native SQLiteの古いキャッシュが残る場合はClear build cache & deployで再構築してください。

任意GraphQLをサービス認証情報で中継する`POST /api/oneloop/graphql`を廃止しました。未認証は401、認証済みでも410となり、外部APIへ要求を送信しません。UIの任意クエリ実行欄も撤去しました。管理者も任意query・mutation・schema照会を中継できません。
応募者一覧の閲覧・検索・source絞り込みは従来どおり利用できます。サーバー定義のGetApplicantsだけを実行し、first=20・最大50ページを維持します。cursor/sourceの型と長さも検証します。既存の応募者一覧閲覧権限は変更していません。

既存のOne Loop認証情報のソース固定・過去公開（SEC-026）は別途所有者による失効・再発行が必要です。この変更で認証情報の有効性を試験したり、実応募者データを取得したりはしません。

### One Loop認証情報（SEC-026）
ソース固定のBearerトークンを撤去し、ONE_LOOP_TOKEN環境変数のみを使用します。未設定・不正な値では応募者APIを503で停止し、外部通信を行いません。他の売上管理機能と独自ログインは維持します。
配備前に所有者がOne Loop側の公開済みトークンを失効し、新しく発行したトークンをRenderのONE_LOOP_TOKENへ保存してください。古い公開値を環境変数へ移すだけでは漏洩対応は完了しません。秘密値をGit/チャット/ログへ出さないでください。
今回のソース撤去だけで履歴・fork・cloneの値は消えません。失効・利用履歴確認は所有者の別操作です。未設定のまま配備するとOne Loop一覧だけ利用不可になるため、設定確認前はマージを保留します。

One Loop連携テストは所有者の指示で一時停止中です。メニューと画面登録を除外し、認証済みの/api/oneloop配下はすべて410で外部通信前に停止します。再開時は正規トークンと旧値の失効を確認し、別途明示修正してください。他の売上管理機能は変更していません。

### 2026-10-25 稼働用依存のセキュリティ更新

既存manifest範囲のlock更新でExpress4.22.3/body-parser1.20.9/Multer2.5.0/proxy-addr2.0.8を採用。アプリAPI・認証・DB・同期ジョブの変更なし。Node22.23.4で48テスト成功、install scripts無効のclean installと隔離DB/模擬ジョブでの起動確認を実施。稼働用auditはCritical/High0、Google関連のModerate4は残存。

追加したアップロード試験はPDF parserをstubにしてmultipart・認証・20MB制限を検証するものです。実PDF解析は未確認です。既存のpdf-parse2.4.5はオブジェクトをexportしますが、現ルートは関数として呼んでおり、不一致を別件として記録しています（更新前後で同版）。今回その解析処理自体は変更しません。

## PDF解析の互換修正（2026-10-25）

PDFアップロードを、導入済みpdf-parse 2系のPDFParse/getText APIへ修正しました。解析後は成功・失敗ともdestroyでリソースを解放し、ページ数はtotalから返します。ページ区切りの自動文字列を無効化し、空のPDFを誤って有効な本文として保存しません。解析エラーの詳細は画面・運用ログへ出さず、一般的なエラーを返します。アップロード20MB制限・認証・既存の保存形式・スキャンPDF非対応は維持します。追加設定・依存更新はありません。

npm testで53テスト成功。新しい実parser試験は架空の複数ページPDF・空のPDF・壊れたPDF・未認証を、メモリ内DBで検証します。成功/失敗時の解放も別の模擬試験で確認します。本番の資料アップロードは実行していません。
