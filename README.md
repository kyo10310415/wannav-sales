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
- `JWT_SECRET`: JWT署名用シークレットキー（必ず変更）
- `GOOGLE_SERVICE_ACCOUNT_JSON` または `GOOGLE_API_KEY`: Google API認証

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
