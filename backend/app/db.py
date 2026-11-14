import json
import secrets
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path

from sqlalchemy import Column, Integer, String, Text, create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session

from .schemas import Policy, now


class Base(DeclarativeBase):
    pass


class Sandbox(Base):
    __tablename__ = "sandboxes"
    id = Column(String, primary_key=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    role = Column(String, nullable=False, default="customer")
    policy = Column(Text, nullable=False)
    expires_at = Column(String, nullable=False)


class Purchase(Base):
    __tablename__ = "purchases"
    id = Column(String, primary_key=True)
    sandbox_id = Column(String, nullable=False, index=True)
    idempotency_key = Column(String, nullable=False)
    payload_hash = Column(String, nullable=False)
    state = Column(Text, nullable=False)
    revision = Column(Integer, nullable=False, default=1)


class Order(Base):
    __tablename__ = "orders"
    id = Column(String, primary_key=True)
    request_id = Column(String, nullable=False, unique=True)
    sandbox_id = Column(String, nullable=False, index=True)
    receipt = Column(Text, nullable=False)


class Reservation(Base):
    __tablename__ = "reservations"
    request_id = Column(String, primary_key=True)
    sandbox_id = Column(String, nullable=False, index=True)
    preview = Column(Text, nullable=False)
    expires_at = Column(String, nullable=False)


class Database:
    def __init__(self, url: str):
        if url.startswith("sqlite:///"):
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 20})

        @event.listens_for(self.engine, "connect")
        def configure(dbapi, _):
            dbapi.execute("PRAGMA journal_mode=WAL")
            dbapi.execute("PRAGMA foreign_keys=ON")
            dbapi.execute("PRAGMA busy_timeout=20000")

    @contextmanager
    def read(self):
        with Session(self.engine, expire_on_commit=False) as session:
            yield session

    @contextmanager
    def write(self):
        with Session(self.engine, expire_on_commit=False) as session:
            session.execute(text("BEGIN IMMEDIATE"))
            try:
                yield session
                session.commit()
            except BaseException:
                session.rollback()
                raise

    def create_schema(self):
        Base.metadata.create_all(self.engine)
        with self.engine.begin() as conn:
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_request_idempotency ON purchases(sandbox_id, idempotency_key)"))


def new_sandbox(token_hash: str, hours: int) -> Sandbox:
    return Sandbox(id=secrets.token_hex(16), token_hash=token_hash, role="customer", policy=Policy().model_dump_json(), expires_at=(now() + timedelta(hours=hours)).isoformat())


def dump(value) -> str:
    return json.dumps(value, default=str, ensure_ascii=False)
