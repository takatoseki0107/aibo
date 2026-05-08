import json
import logging
import os
import boto3
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import FastAPI, HTTPException, Request
from mangum import Mangum
from pydantic import BaseModel
from typing import Optional, Literal
from botocore.exceptions import ClientError

app = FastAPI()

dynamodb = boto3.resource("dynamodb", region_name="ap-northeast-1")
table = dynamodb.Table("household-transactions")
bedrock = boto3.client("bedrock-runtime", region_name="ap-northeast-1")
sns = boto3.client("sns", region_name="ap-northeast-1")

logger = logging.getLogger()
logger.setLevel(logging.INFO)

SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")
BUDGET_THRESHOLD = int(os.environ.get("BUDGET_THRESHOLD") or "100000")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "jp.anthropic.claude-haiku-4-5-20251001-v1:0")

# Could #13: プロンプトテンプレートを定数として管理
ADVICE_PROMPT_TEMPLATE = """あなたは家計管理のアドバイザーです。
以下の直近{months}ヶ月の家計データを分析して、日本語で簡潔なアドバイスを3点述べてください。

収入合計: {income}円
支出合計: {expense}円
残高: {balance}円
目安予算: {budget}円

アドバイス:"""


class Transaction(BaseModel):
    type: Literal["income", "expense"]
    amount: int
    category: str
    memo: Optional[str] = None
    date: str


class TransactionUpdate(BaseModel):
    type: Optional[Literal["income", "expense"]] = None
    amount: Optional[int] = None
    category: Optional[str] = None
    memo: Optional[str] = None
    date: Optional[str] = None


def get_user_id(request: Request) -> str:
    return request.scope["aws.event"]["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]


def get_all_items(user_id: str) -> list:
    """LastEvaluatedKey を使って全件取得（Should D: ペジネーション対応）"""
    items = []
    kwargs = {
        "KeyConditionExpression": boto3.dynamodb.conditions.Key("userId").eq(user_id)
    }
    for _ in range(100):
        try:
            response = table.query(**kwargs)
        except ClientError as e:
            logger.error(f"DynamoDB query に失敗しました: user={user_id}, error={e}")
            raise
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break
        kwargs["ExclusiveStartKey"] = last_key
    return items


def get_recent_summary(user_id: str, months: int = 3) -> dict:
    """直近N ヶ月の集計データのみ返す（Bedrock コスト削減）

    Raises:
        ClientError: DynamoDB クエリに失敗した場合
    """
    items = get_all_items(user_id)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=months * 30)).strftime("%Y-%m-%d")
    recent = [i for i in items if i.get("date", "") >= cutoff]
    income = sum(int(i["amount"]) for i in recent if i["type"] == "income")
    expense = sum(int(i["amount"]) for i in recent if i["type"] == "expense")
    return {
        "income": income,
        "expense": expense,
        "balance": income - expense,
        "months": months,
    }


def check_and_notify_budget(user_id: str) -> None:
    """予算チェックと SNS 通知"""
    try:
        items = get_all_items(user_id)
        total_expense = sum(int(i["amount"]) for i in items if i["type"] == "expense")
        if total_expense >= BUDGET_THRESHOLD and SNS_TOPIC_ARN:
            sns.publish(
                TopicArn=SNS_TOPIC_ARN,
                Subject="【家計管理API】予算オーバーの通知",
                Message=f"支出合計が予算({BUDGET_THRESHOLD:,}円)を超えました。\n現在の支出合計: {total_expense:,}円",
            )
            logger.info(f"予算オーバー通知を送信しました: user={user_id}, total={total_expense}")
    except ClientError as e:
        logger.error(f"予算チェック/SNS通知に失敗しました: user={user_id}, error={e}")


@app.post("/transactions")
def create_transaction(body: Transaction, request: Request):
    user_id = get_user_id(request)
    item = {
        "userId": user_id,
        "transactionId": str(uuid.uuid4()),
        "type": body.type,
        "amount": body.amount,
        "category": body.category,
        "memo": body.memo or "",
        "date": body.date,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    try:
        table.put_item(Item=item)
    except ClientError:
        raise HTTPException(status_code=500, detail="サーバーエラーが発生しました")

    if body.type == "expense":
        check_and_notify_budget(user_id)

    return {"message": "登録しました", "transactionId": item["transactionId"]}


@app.get("/transactions")
def get_transactions(request: Request):
    user_id = get_user_id(request)
    try:
        items = get_all_items(user_id)
    except ClientError:
        raise HTTPException(status_code=500, detail="サーバーエラーが発生しました")
    for item in items:
        item["amount"] = int(item["amount"])
    return {"transactions": items}


@app.get("/transactions/summary")
def get_summary(request: Request):
    user_id = get_user_id(request)
    try:
        items = get_all_items(user_id)
    except ClientError:
        raise HTTPException(status_code=500, detail="サーバーエラーが発生しました")
    income = sum(int(i["amount"]) for i in items if i["type"] == "income")
    expense = sum(int(i["amount"]) for i in items if i["type"] == "expense")
    return {
        "income": income,
        "expense": expense,
        "balance": income - expense,
    }


@app.get("/transactions/advice")
def get_advice(request: Request):
    user_id = get_user_id(request)
    try:
        summary = get_recent_summary(user_id, months=3)
    except ClientError:
        raise HTTPException(status_code=500, detail="サーバーエラーが発生しました")

    if summary["income"] == 0 and summary["expense"] == 0:
        return {"advice": "まずは収支を登録してみましょう"}

    prompt = ADVICE_PROMPT_TEMPLATE.format(
        months=summary["months"],
        income=f'{summary["income"]:,}',
        expense=f'{summary["expense"]:,}',
        balance=f'{summary["balance"]:,}',
        budget=f'{BUDGET_THRESHOLD:,}',
    )

    try:
        # jp. inference profile は invoke_model_with_response_stream を使用
        # Lambda内で全チャンク結合してから返却する設計
        response = bedrock.invoke_model_with_response_stream(
            modelId=BEDROCK_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 512,
                "messages": [
                    {"role": "user", "content": prompt}
                ]
            })
        )
        advice_parts = []
        for event in response["body"]:
            chunk = json.loads(event["chunk"]["bytes"])
            if chunk.get("type") == "content_block_delta":
                advice_parts.append(chunk["delta"].get("text", ""))
        advice = "".join(advice_parts) or "アドバイスを生成できませんでした"
    except ClientError:
        raise HTTPException(status_code=500, detail="サーバーエラーが発生しました")

    return {"advice": advice}


@app.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: str, request: Request):
    user_id = get_user_id(request)
    try:
        response = table.delete_item(
            Key={"userId": user_id, "transactionId": transaction_id},
            ConditionExpression="attribute_exists(transactionId)",
        )
        logger.info(f"削除しました: user={user_id}, transactionId={transaction_id}, response={response}")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise HTTPException(status_code=404, detail="該当する収支が見つかりません")
        raise HTTPException(status_code=500, detail="サーバーエラーが発生しました")
    return {"message": "削除しました"}


@app.put("/transactions/{transaction_id}")
def update_transaction(transaction_id: str, body: TransactionUpdate, request: Request):
    user_id = get_user_id(request)

    update_fields = body.model_dump(exclude_unset=True)
    if not update_fields:
        raise HTTPException(status_code=400, detail="更新するフィールドがありません")

    update_expr = "SET " + ", ".join(f"#f_{k} = :{k}" for k in update_fields)
    expr_names = {f"#f_{k}": k for k in update_fields}
    expr_values = {f":{k}": v for k, v in update_fields.items()}

    try:
        table.update_item(
            Key={"userId": user_id, "transactionId": transaction_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
            ConditionExpression="attribute_exists(transactionId)",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise HTTPException(status_code=404, detail="該当する収支が見つかりません")
        raise HTTPException(status_code=500, detail="サーバーエラーが発生しました")
    return {"message": "更新しました"}


handler = Mangum(app)
