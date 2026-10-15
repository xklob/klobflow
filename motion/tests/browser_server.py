"""Explicit test fixture, never enabled by the production server."""
import uvicorn
from motion.server import create_app
from motion.tests.test_core import fake_runtime

if __name__ == "__main__":
    uvicorn.run(create_app(fake_runtime(), preload=False), host="127.0.0.1", port=8895)
