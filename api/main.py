"""BloomPrint FastAPI backend."""

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .routes import auth, players, evaluations, training, uploads, teams, player_auth, player_routes, game_reports, staff_sharing

app = FastAPI(title="BloomPrint API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(players.router)
app.include_router(evaluations.router)
app.include_router(training.router)
app.include_router(uploads.router)
app.include_router(teams.router)
app.include_router(player_auth.router)
app.include_router(player_routes.router)
app.include_router(game_reports.router)
app.include_router(staff_sharing.router)


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/health")
def health():
    return {"status": "ok", "service": "BloomPrint API"}


def start():
    uvicorn.run("api.main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    start()
