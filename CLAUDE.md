# Aibo - CLAUDE.md

## プロジェクト概要

**アプリ名**: Aibo（アイボ）  
**コンセプト**: AI × 家計簿 × 相棒 = AIと一緒にお金を管理する家計の相棒アプリ  
**リポジトリ**: https://github.com/takatoseki0107/aibo

---

## 技術スタック

### バックエンド
- **言語**: Python 3.12
- **フレームワーク**: FastAPI + Mangum（Lambda対応）
- **インフラ**: AWS Lambda / API Gateway (HTTP API) / Cognito / DynamoDB / Bedrock / SNS / CloudWatch
- **IaC**: Terraform

### フロントエンド
- **フレームワーク**: React + Vite
- **スタイリング**: TailwindCSS（テラコッタ・オレンジ系テーマ）
- **ホスティング**: AWS Amplify
- **フォルダ**: `frontend/`

---

## フォルダ構成

```
aibo/
├── lambda/main.py       # FastAPI APIハンドラー（Lambdaエントリーポイント: handler）
├── terraform/           # インフラ定義
├── frontend/            # Reactフロントエンド
├── tests/               # Pytestユニットテスト
├── .github/workflows/   # GitHub Actions CIワークフロー
├── requirements.txt     # 本番用依存パッケージ
├── requirements-dev.txt # 開発・テスト用依存パッケージ
└── lambda.zip           # Lambdaデプロイパッケージ
```

---

## APIエンドポイント

| メソッド | パス | 説明 |
|----------|------|------|
| `POST` | `/transactions` | 収支登録 |
| `GET` | `/transactions` | 収支一覧取得 |
| `GET` | `/transactions/summary` | 収支合計取得 |
| `GET` | `/transactions/advice` | AIアドバイス取得（Bedrock） |
| `DELETE` | `/transactions/{transactionId}` | 収支削除 |
| `PUT` | `/transactions/{transactionId}` | 収支編集（部分更新） |

- 認証: Cognito JWT（`Authorization: Bearer <id_token>`）
- DynamoDB: テーブル名 `household-transactions`、パーティションキー `userId`、ソートキー `transactionId`

---

## 重要な実装上の注意

### Lambda / API
- BedrockはJP推論プロファイル `jp.anthropic.claude-haiku-4-5-20251001-v1:0` を使用
- `invoke_model_with_response_stream` でストリーミング取得し、Lambda内でチャンク結合してから返す
- DynamoDBクエリは `LastEvaluatedKey` でページネーション済み（`get_all_items`）
- ユーザーIDは `request.scope["aws.event"]["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]` から取得

### Terraform
- `terraform/` ディレクトリで操作（`lambda.zip` は `../lambda.zip` を参照）
- 変数: `alert_email`（必須）、`environment`（デフォルト: `dev`）、`budget_threshold`
- CORSは `var.allowed_origins` で管理（`terraform/variables.tf` 参照）

### フロントエンド
- `frontend/` フォルダ配下で管理
- Cognito認証フローは SRP（`ALLOW_USER_SRP_AUTH`）
- トークン有効期限: アクセストークン・IDトークン 60分、リフレッシュトークン 30日
- favicon: `frontend/public/favicon.svg`（テラコッタ色の「A」アイコン）、`index.html` で参照済み

### Amplify設定（コンソール上）
- リライトとリダイレクト: `/<*>` → `/index.html`、ステータス `404-200` に設定済み
  - SPAのルーティング（`/dashboard`、`/transactions` 等への直接アクセス）を有効にするための設定
  - `200` にするとJSファイルまでリライトされてアプリが表示されなくなるため必ず `404-200` を使うこと

---

## 開発コマンド

```bash
# バックエンド開発サーバー
uvicorn lambda.main:app --reload

# フロントエンド開発サーバー
cd frontend && npm run dev

# テスト実行
pip install -r requirements-dev.txt
python -m pytest tests/ -v

# Lambdaパッケージビルド
pip install -r requirements.txt -t lambda/
cd lambda && zip -r ../lambda.zip .

# Terraformデプロイ
cd terraform
terraform plan -var="alert_email=your@email.com"
terraform apply -var="alert_email=your@email.com"
```

---

## CI/CD

- **CI**: GitHub Actions（`.github/workflows/ci.yml`）
  - mainへのpush・PRで自動実行
  - Backend: Pytestユニットテスト
  - Frontend: 型チェック・Lint・ビルド
- **CD**: AWS Amplify（`amplify.yml`）
  - mainへのpushで自動ビルド・デプロイ

### テスト方針
DynamoDB・Bedrockの統合テストはCI環境でのAWS認証が必要なためスコープ外。ビジネスロジック（集計・予算チェック・バリデーション）のユニットテストのみ実装。
