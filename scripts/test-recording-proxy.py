"""Exercise root/subpath recording routing using a local Nginx Docker image."""
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
image = os.environ.get("NGINX_TEST_IMAGE", "cspot-audio-nginx-check:latest")
for name, prefix in [("root", ""), ("subpath", "/app")]:
    source = root / "frontend" / (
        "nginx.root.conf" if name == "root" else "nginx.subpath.conf.template"
    )
    config = source.read_text().replace("__APP_BASE_PATH__", prefix).replace(
        "__CAMERA_PROXY_UPSTREAM__", "http://127.0.0.1:1984/"
    )
    config += '\nserver { listen 8000; location / { return 200 "$request_uri"; } }\n'
    config = config.replace("server {", "server { access_log off;")
    with tempfile.TemporaryDirectory(prefix="cspot-proxy-", dir="/tmp") as directory:
        path = Path(directory) / "default.conf"
        path.write_text(config)
        for suffix in ["", "/", "/example/audio", "/example/trim"]:
            url = f"http://127.0.0.1{prefix}/api/v1/broadcast/recordings{suffix}"
            result = subprocess.run([
                "docker", "run", "--rm", "--network", "none",
                "--add-host", "api:127.0.0.1",
                "-v", f"{path}:/etc/nginx/conf.d/default.conf:ro",
                "--entrypoint", "sh", image,
                "-c", 'nginx && wget -q -O - "$1"', "sh", url,
            ], check=True, capture_output=True, text=True)
            expected = "/api/v1/broadcast/recordings" + (suffix if suffix != "/" else "")
            assert result.stdout == expected, (url, result.stdout, expected)
            print(f"PASS {name}: recordings{suffix}")
