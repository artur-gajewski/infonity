from datetime import datetime, timezone
import pytest
from app.config import Settings
from app.retrieval import time_context


def test_calendar_uses_local_date_across_utc_midnight_and_year_boundary():
    text = time_context("Europe/Helsinki", datetime(2026, 12, 31, 23, 30, tzinfo=timezone.utc))
    assert "Current local date: 2027-01-01 (Friday)" in text
    assert "Timezone: Europe/Helsinki" in text
    assert "Friday: 2027-01-08" in text


def test_next_friday_is_available_and_calendar_handles_leap_day():
    text = time_context("Europe/Helsinki", datetime(2026, 10, 28, 10, tzinfo=timezone.utc))
    assert "Friday: 2026-10-30 (30 October 2026)" in text
    leap = time_context("UTC", datetime(2028, 2, 28, 10, tzinfo=timezone.utc))
    assert "Tuesday: 2028-02-29" in leap
    assert "Wednesday: 2028-03-01" in leap


def test_unknown_timezone_is_rejected():
    with pytest.raises(ValueError):
        Settings(timezone="Not/AZone", _env_file=None)
