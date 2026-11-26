from fastapi.testclient import TestClient

from app import main


def test_root_and_spa_routes_serve_built_frontend(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<html>frontend</html>", encoding="utf-8")
    monkeypatch.setattr(main, "FRONTEND_DIST", tmp_path)

    client = TestClient(main.app)

    assert client.get("/").text == "<html>frontend</html>"
    assert client.get("/login").text == "<html>frontend</html>"


def test_unknown_api_route_does_not_fall_back_to_frontend(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<html>frontend</html>", encoding="utf-8")
    monkeypatch.setattr(main, "FRONTEND_DIST", tmp_path)

    response = TestClient(main.app).get("/api/unknown")

    assert response.status_code == 404
