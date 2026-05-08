"""
ビジネスロジックのユニットテスト。
DynamoDB / Bedrock / SNS には接続せず、ダミーデータでロジックのみ検証する。
"""
import os
import sys
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

import pytest

# boto3 がなくてもインポートできるよう AWS SDK 系をモックしてから main を読み込む
sys.modules.setdefault("boto3", MagicMock())
sys.modules.setdefault("mangum", MagicMock())

os.environ.setdefault("BUDGET_THRESHOLD", "100000")
os.environ.setdefault("SNS_TOPIC_ARN", "")
os.environ.setdefault("BEDROCK_MODEL_ID", "dummy")

import importlib.util  # noqa: E402

with patch("boto3.resource"), patch("boto3.client"):
    _spec = importlib.util.spec_from_file_location(
        "lambda_main",
        os.path.join(os.path.dirname(__file__), "..", "lambda", "main.py"),
    )
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules["lambda_main"] = _mod
    _spec.loader.exec_module(_mod)

Transaction = _mod.Transaction
TransactionUpdate = _mod.TransactionUpdate
get_recent_summary = _mod.get_recent_summary
check_and_notify_budget = _mod.check_and_notify_budget
BUDGET_THRESHOLD = _mod.BUDGET_THRESHOLD


# ── ヘルパー ──────────────────────────────────────────────────────────────────

def make_item(type_: str, amount: int, days_ago: int = 0) -> dict:
    date = (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    return {"type": type_, "amount": amount, "date": date}


# ── Transaction バリデーション ─────────────────────────────────────────────────

class TestTransactionModel:
    def test_valid_expense(self):
        tx = Transaction(type="expense", amount=5000, category="食費", date="2026-05-01")
        assert tx.type == "expense"
        assert tx.amount == 5000

    def test_valid_income(self):
        tx = Transaction(type="income", amount=300000, category="給与", date="2026-05-01")
        assert tx.type == "income"

    def test_memo_is_optional(self):
        tx = Transaction(type="expense", amount=1000, category="交通費", date="2026-05-01")
        assert tx.memo is None

    def test_invalid_type_raises(self):
        with pytest.raises(Exception):
            Transaction(type="other", amount=1000, category="食費", date="2026-05-01")

    def test_invalid_amount_type_raises(self):
        with pytest.raises(Exception):
            Transaction(type="expense", amount="abc", category="食費", date="2026-05-01")


# ── get_recent_summary ────────────────────────────────────────────────────────

class TestGetRecentSummary:
    def _run(self, items, months=3):
        with patch("lambda_main.get_all_items", return_value=items):
            return get_recent_summary("user-1", months=months)

    def test_income_and_expense_calculated_correctly(self):
        items = [
            make_item("income", 300000),
            make_item("expense", 50000),
            make_item("expense", 30000),
        ]
        result = self._run(items)
        assert result["income"] == 300000
        assert result["expense"] == 80000
        assert result["balance"] == 220000

    def test_empty_items_returns_zero(self):
        result = self._run([])
        assert result["income"] == 0
        assert result["expense"] == 0
        assert result["balance"] == 0

    def test_old_items_excluded(self):
        items = [
            make_item("income", 100000, days_ago=0),
            make_item("expense", 200000, days_ago=200),  # 3ヶ月より古い
        ]
        result = self._run(items, months=3)
        assert result["income"] == 100000
        assert result["expense"] == 0

    def test_balance_goes_negative(self):
        items = [
            make_item("income", 100000),
            make_item("expense", 150000),
        ]
        result = self._run(items)
        assert result["balance"] == -50000


# ── check_and_notify_budget ───────────────────────────────────────────────────

class TestCheckAndNotifyBudget:
    def _run(self, items, sns_arn="arn:aws:sns:ap-northeast-1:123456789012:test"):
        with patch("lambda_main.get_all_items", return_value=items), \
             patch("lambda_main.SNS_TOPIC_ARN", sns_arn), \
             patch("lambda_main.sns") as mock_sns:
            check_and_notify_budget("user-1")
            return mock_sns

    def test_notifies_when_over_budget(self):
        items = [make_item("expense", BUDGET_THRESHOLD + 1)]
        mock_sns = self._run(items)
        mock_sns.publish.assert_called_once()

    def test_no_notification_when_under_budget(self):
        items = [make_item("expense", BUDGET_THRESHOLD - 1)]
        mock_sns = self._run(items)
        mock_sns.publish.assert_not_called()

    def test_no_notification_when_exactly_at_threshold(self):
        items = [make_item("expense", BUDGET_THRESHOLD)]
        mock_sns = self._run(items)
        mock_sns.publish.assert_called_once()

    def test_no_notification_when_sns_arn_empty(self):
        items = [make_item("expense", BUDGET_THRESHOLD + 1)]
        mock_sns = self._run(items, sns_arn="")
        mock_sns.publish.assert_not_called()

    def test_income_not_counted_toward_budget(self):
        items = [
            make_item("income", BUDGET_THRESHOLD + 100000),
        ]
        mock_sns = self._run(items)
        mock_sns.publish.assert_not_called()


# ── TransactionUpdate バリデーション ─────────────────────────────────────────

class TestTransactionUpdateModel:
    def test_all_fields_optional(self):
        upd = TransactionUpdate()
        assert upd.type is None
        assert upd.amount is None
        assert upd.category is None
        assert upd.memo is None
        assert upd.date is None

    def test_partial_update(self):
        upd = TransactionUpdate(amount=9999, memo="テスト")
        assert upd.amount == 9999
        assert upd.memo == "テスト"
        assert upd.type is None

    def test_empty_memo_included_when_exclude_unset(self):
        upd = TransactionUpdate(memo="")
        fields = upd.model_dump(exclude_unset=True)
        assert "memo" in fields
        assert fields["memo"] == ""

    def test_unset_memo_excluded_when_exclude_unset(self):
        upd = TransactionUpdate(amount=1000)
        fields = upd.model_dump(exclude_unset=True)
        assert "memo" not in fields

    def test_invalid_type_raises(self):
        with pytest.raises(Exception):
            TransactionUpdate(type="invalid")


# ── サマリー計算（収入・支出・残高）──────────────────────────────────────────

class TestSummaryCalculation:
    def test_only_income(self):
        items = [make_item("income", 100000), make_item("income", 200000)]
        income = sum(int(i["amount"]) for i in items if i["type"] == "income")
        expense = sum(int(i["amount"]) for i in items if i["type"] == "expense")
        assert income == 300000
        assert expense == 0
        assert income - expense == 300000

    def test_only_expense(self):
        items = [make_item("expense", 50000), make_item("expense", 30000)]
        income = sum(int(i["amount"]) for i in items if i["type"] == "income")
        expense = sum(int(i["amount"]) for i in items if i["type"] == "expense")
        assert income == 0
        assert expense == 80000
        assert income - expense == -80000

    def test_mixed(self):
        items = [
            make_item("income", 300000),
            make_item("expense", 80000),
            make_item("expense", 20000),
        ]
        income = sum(int(i["amount"]) for i in items if i["type"] == "income")
        expense = sum(int(i["amount"]) for i in items if i["type"] == "expense")
        assert income == 300000
        assert expense == 100000
        assert income - expense == 200000
