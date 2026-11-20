import logging

from fastapi import HTTPException, Response
from fastapi.testclient import TestClient

from app import main


def test_timing_header_is_available_to_cross_origin_clients(monkeypatch):
    clock = iter([1.0, 1.012])
    monkeypatch.setattr(main, "perf_counter", lambda: next(clock))
    client = TestClient(main.create_app())
    response = client.get("/health", headers={"Origin": main.settings.cors_origins[0]})
    assert response.status_code == 200
    assert response.headers["server-timing"] == "app;dur=12.0"
    assert "Server-Timing" in response.headers["access-control-expose-headers"]


def test_slow_request_logs_only_template_and_preserves_existing_metrics(monkeypatch, caplog):
    clock = iter([1.0, 2.5])
    monkeypatch.setattr(main, "perf_counter", lambda: next(clock))
    app = main.create_app()

    @app.get("/timing-test/{token}")
    async def timed_probe(token: str):
        return Response("ok", headers={"Server-Timing": "cache;dur=1"})

    with caplog.at_level(logging.WARNING, logger=main.request_timing_logger.name):
        response = TestClient(app).get("/timing-test/private-token?secret=private-query")
    assert response.headers["server-timing"] == "cache;dur=1, app;dur=1500.0"
    assert "route=/timing-test/{token}" in caplog.text
    assert "status=200 duration_ms=1500.0" in caplog.text
    assert "private-token" not in caplog.text
    assert "private-query" not in caplog.text


def test_handled_error_responses_have_timing_without_slow_log(monkeypatch, caplog):
    clock = iter([1.0, 1.005])
    monkeypatch.setattr(main, "perf_counter", lambda: next(clock))
    app = main.create_app()

    @app.get("/timing-test-denied")
    async def denied_probe():
        raise HTTPException(status_code=403, detail="Denied")

    with caplog.at_level(logging.WARNING, logger=main.request_timing_logger.name):
        response = TestClient(app).get("/timing-test-denied")
    assert response.status_code == 403
    assert response.headers["server-timing"] == "app;dur=5.0"
    assert "Slow API request" not in caplog.text
