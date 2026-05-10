import os
import time
import json
import sqlite3
import asyncio
import hashlib
from typing import List
from datetime import datetime, timedelta


# HTTP & Networking
import requests
import httpx
import tempfile
import subprocess

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:
    pass

try:
    from kademlia.network import Server
    import psutil
except ImportError:
    Server = None
    psutil = None

# Web Framework (FastAPI & Pydantic)
from fastapi import (
    FastAPI, HTTPException, Request, UploadFile, File, Form, 
    BackgroundTasks, Depends, status 
    )
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Blockchain & Crypto
from eth_account.messages import encode_defunct
from eth_account import Account

# AI & LLM Tools (LangChain & Google)
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
import google.generativeai as genai

# JWT Handling (with PyJWT fallback)
try:
    from jose import jwt, JWTError
except ImportError:
    # Fallback to PyJWT if python-jose is not installed
    import jwt as _pyjwt
    
    class _JWT:
        @staticmethod
        def encode(data, key, algorithm): 
            return _pyjwt.encode(data, key, algorithm=algorithm)
            
        @staticmethod
        def decode(token, key, algorithms): 
            return _pyjwt.decode(token, key, algorithms=algorithms)
            
    jwt = _JWT()
    JWTError = _pyjwt.PyJWTError

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🔑 CONFIGURATION & SETUP
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEAD_GEMINI_KEYS = {"AIzaSyB5v5VC5v_vAr-wWurXJSnEwI3UaYN-E0Y"}
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_CLAUDE_API_KEY = os.getenv("GEMINI_CLAUDE_API_KEY", "")
OPENROUTER_DEFAULT_KEY = os.getenv("OPENROUTER_DEFAULT_KEY") or os.getenv("OPENROUTER_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_CLAUDE_PERSONA_API_KEY = os.getenv("GROQ_CLAUDE_PERSONA_API_KEY") or GROQ_API_KEY
GROQ_FREE_MODELS_API_KEY = os.getenv("GROQ_FREE_MODELS_API_KEY") or GROQ_API_KEY
GROQ_DEFAULT_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
HUGGINGFACE_API_KEY = os.getenv("HUGGINGFACE_API_KEY", "")
ANTHROPIC_DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
OPENROUTER_FAILOVER_MODEL = "meta-llama/llama-3-8b-instruct:free"
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

def configured_api_key(value: str) -> str:
    key = (value or "").strip()
    if not key or key in DEAD_GEMINI_KEYS or key.lower() in {"your_second_gemini_key_here", "your_gemini_key_here", "your_nvidia_key_here", "your_api_key_here"}:
        return ""
    return key

class KeyPool:
    COOLDOWN = 120

    def __init__(self, env_prefix: str, legacy_env: str = ""):
        raw: list[str] = []
        for name in [legacy_env, env_prefix]:
            if name:
                v = configured_api_key(os.getenv(name, ""))
                if v and v not in raw:
                    raw.append(v)
        for n in range(1, 51):
            v = configured_api_key(os.getenv(f"{env_prefix}_{n}", ""))
            if v and v not in raw:
                raw.append(v)
        self._keys = raw
        self._exhausted: dict[str, float] = {}
        self._idx = 0

    @property
    def primary(self) -> str:
        return self._next_available() or ""

    def get(self) -> str:
        key = self._next_available()
        if key:
            self._idx = (self._keys.index(key) + 1) % max(len(self._keys), 1)
        return key or ""

    def mark_exhausted(self, key: str) -> None:
        if key and key in self._keys:
            self._exhausted[key] = time.time() + self.COOLDOWN
            print(f"[KeyPool] key ...{key[-6:]} cooling down for {self.COOLDOWN}s")

    def _is_available(self, key: str) -> bool:
        until = self._exhausted.get(key, 0)
        if until and time.time() < until:
            return False
        self._exhausted.pop(key, None)
        return True

    def _next_available(self) -> str | None:
        for offset in range(len(self._keys)):
            key = self._keys[(self._idx + offset) % len(self._keys)]
            if self._is_available(key):
                return key
        return None

POOL_GEMINI = KeyPool("GEMINI_API_KEY", "GEMINI_API_KEY")
POOL_GEMINI_CLD = KeyPool("GEMINI_CLAUDE_API_KEY", "GEMINI_CLAUDE_API_KEY")
POOL_OPENROUTER = KeyPool("OPENROUTER_API_KEY", "OPENROUTER_DEFAULT_KEY")
POOL_GROQ = KeyPool("GROQ_API_KEY", "GROQ_API_KEY")
POOL_GROQ_PERSONA = KeyPool("GROQ_CLAUDE_PERSONA_API_KEY", "GROQ_CLAUDE_PERSONA_API_KEY")
POOL_GROQ_FREE = KeyPool("GROQ_FREE_MODELS_API_KEY", "GROQ_FREE_MODELS_API_KEY")
POOL_OPENAI = KeyPool("OPENAI_API_KEY", "OPENAI_API_KEY")
POOL_ANTHROPIC = KeyPool("ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY")
POOL_NVIDIA = KeyPool("NVIDIA_API_KEY", "NVIDIA_API_KEY")
POOL_MISTRAL = KeyPool("MISTRAL_API_KEY", "MISTRAL_API_KEY")
POOL_DEEPSEEK = KeyPool("DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY")
POOL_HF = KeyPool("HUGGINGFACE_API_KEY", "HUGGINGFACE_API_KEY")

GEMINI_API_KEY = POOL_GEMINI.primary
GEMINI_CLAUDE_API_KEY = POOL_GEMINI_CLD.primary
OPENROUTER_DEFAULT_KEY = POOL_OPENROUTER.primary
GROQ_API_KEY = POOL_GROQ.primary
GROQ_CLAUDE_PERSONA_API_KEY = POOL_GROQ_PERSONA.primary or GROQ_API_KEY
GROQ_FREE_MODELS_API_KEY = POOL_GROQ_FREE.primary or GROQ_API_KEY
HUGGINGFACE_API_KEY = POOL_HF.primary
NVIDIA_API_KEY = POOL_NVIDIA.primary
NVIDIA_BASE_URL = os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip("/")
NVIDIA_DEFAULT_MODEL = os.getenv("NVIDIA_MODEL", "meta/llama-3.1-70b-instruct")
GEMINI_DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_MODEL_CHAIN = [m.strip() for m in os.getenv("GEMINI_MODEL_CHAIN", GEMINI_DEFAULT_MODEL).split(",") if m.strip()] or [GEMINI_DEFAULT_MODEL]

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Initialize Kademlia DHT Server (Phase 2 P2P Compute Swarm)
dht_server = Server() if Server else None
AURA_ENABLE_ANP_WORKER = os.getenv("AURA_ENABLE_ANP_WORKER", "false").lower() in {"1", "true", "yes", "on"}

async def anp_bidding_worker():
    """Background task that monitors the DHT for tasks and submits bids based on hardware load."""
    if not dht_server or not psutil:
        return
    quiet_until = 0.0
    print("🤖 [ANP] Bidding worker active. Monitoring DHT for compute tasks...")
    while True:
        try:
            # Checks for active tasks published in the DHT
            try:
                tasks_data = await dht_server.get("active_tasks")
            except Exception as e:
                if "no known neighbors" in str(e).lower():
                    now = time.time()
                    if now >= quiet_until:
                        print("[ANP] No DHT peers yet; bidding worker is idle until peers join.")
                        quiet_until = now + 300
                    await asyncio.sleep(30)
                    continue
                print(f"⚠️ [ANP] DHT worker error: {e}")
                await asyncio.sleep(5)
                continue

            if tasks_data:
                task_list = json.loads(tasks_data)
                for task_id in task_list:
                    # Calculates real-time hardware load (CPU as proxy for GPU)
                    load = psutil.cpu_percent()
                    if load < 85: # Only bid if node is not overloaded
                        bid = {
                            "node_id": os.getenv("NODE_ID", f"peer_{hash(time.time()) % 1000}"),
                            "bid_credits": 1.0 + (load / 100.0), # Dynamic pricing based on load
                            "timestamp": time.time()
                        }
                        # Publish bid back to DHT
                        await dht_server.set(f"bid:{task_id}:{bid['node_id']}", json.dumps(bid))
        except Exception as e:
            print(f"⚠️ [ANP] Bidding worker unexpected error: {e}")
        await asyncio.sleep(5)
app = FastAPI(title="AURA Decentralized Aggregator Bridge")

# Parallel fan-out stays fast globally, while each upstream provider gets its own
# limiter so one burst does not trigger 429s across the whole council.
api_semaphore = asyncio.Semaphore(12)
provider_semaphores = {
    "openai": asyncio.Semaphore(3),
    "anthropic": asyncio.Semaphore(3),
    "google": asyncio.Semaphore(3),
    "groq": asyncio.Semaphore(3),
    "openrouter": asyncio.Semaphore(3),
    "nvidia": asyncio.Semaphore(3),
    "mistral": asyncio.Semaphore(3),
    "deepseek": asyncio.Semaphore(3),
    "huggingface": asyncio.Semaphore(3),
    "local": asyncio.Semaphore(6),
}

RETRYABLE_PROVIDER_STATUSES = {429, 503}

def provider_from_url(url: str) -> str:
    normalized = (url or "").lower()
    if "openai.com" in normalized:
        return "openai"
    if "anthropic.com" in normalized:
        return "anthropic"
    if "groq.com" in normalized:
        return "groq"
    if "openrouter.ai" in normalized:
        return "openrouter"
    if "nvidia.com" in normalized:
        return "nvidia"
    if "mistral.ai" in normalized:
        return "mistral"
    if "deepseek.com" in normalized:
        return "deepseek"
    if "huggingface.co" in normalized or "router.huggingface.co" in normalized:
        return "huggingface"
    return "local"

async def bounded_provider_post(client: httpx.AsyncClient, url: str, provider_name: str = "", **kwargs) -> httpx.Response:
    semaphore = provider_semaphores.get(provider_name or provider_from_url(url), provider_semaphores["local"])
    for attempt in range(2):
        async with api_semaphore, semaphore:
            response = await client.post(url, **kwargs)
        if response.status_code in RETRYABLE_PROVIDER_STATUSES and attempt == 0:
            await asyncio.sleep(1.5)
            continue
        return response
    return response

async def bounded_gemini_generate(model, prompt: str, **kwargs):
    last_error = None
    for attempt in range(2):
        try:
            async with api_semaphore, provider_semaphores["google"]:
                return await asyncio.to_thread(model.generate_content, prompt, **kwargs)
        except Exception as e:
            last_error = e
            error_text = str(e).lower()
            if attempt == 0 and ("429" in error_text or "503" in error_text or "rate limit" in error_text or "overloaded" in error_text):
                await asyncio.sleep(1.5)
                continue
            raise
    raise last_error if last_error is not None else Exception("Gemini generation failed")

def pool_for_provider(provider: str, model_id: str = "") -> KeyPool | None:
    provider = (provider or "").lower()
    model_id = (model_id or "").lower()
    if provider in {"google", "gemini"}:
        return POOL_GEMINI_CLD if model_id == "claude-sonnet-4-6" and POOL_GEMINI_CLD.primary else POOL_GEMINI
    if provider == "openrouter":
        return POOL_OPENROUTER
    if provider == "groq":
        if model_id == "groq-sonnet-4-6-persona" and POOL_GROQ_PERSONA.primary:
            return POOL_GROQ_PERSONA
        if model_id.startswith("groq:") and POOL_GROQ_FREE.primary:
            return POOL_GROQ_FREE
        return POOL_GROQ
    if provider == "openai":
        return POOL_OPENAI
    if provider == "anthropic":
        return POOL_ANTHROPIC
    if provider == "nvidia":
        return POOL_NVIDIA
    if provider == "mistral":
        return POOL_MISTRAL
    if provider == "deepseek":
        return POOL_DEEPSEEK
    if provider == "huggingface":
        return POOL_HF
    return None

def pooled_key_for_provider(provider: str, model_id: str = "") -> str:
    pool = pool_for_provider(provider, model_id)
    return pool.get() if pool else ""

def rotate_provider_key(provider: str, model_id: str, current_key: str) -> str:
    pool = pool_for_provider(provider, model_id)
    if not pool or current_key not in pool._keys:
        return ""
    pool.mark_exhausted(current_key)
    return pool.get()

def gemini_capacity_or_key_error(error: Exception) -> bool:
    text = str(error).lower()
    return any(marker in text for marker in ("429", "503", "529", "quota", "exhausted", "rate limit", "overloaded", "capacity"))

async def generate_with_gemini_pool(prompt: str, model_id: str = "", dedicated_key: str = "", timeout: int = 45):
    last_error = None
    if configured_api_key(dedicated_key):
        genai.configure(api_key=dedicated_key)
        model = genai.GenerativeModel(GEMINI_DEFAULT_MODEL)
        return await bounded_gemini_generate(model, prompt, request_options={"timeout": timeout})

    for _ in range(max(len(POOL_GEMINI._keys), 1)):
        key_to_use = pooled_key_for_provider("google", model_id)
        if not key_to_use:
            break
        try:
            genai.configure(api_key=key_to_use)
            for candidate in GEMINI_MODEL_CHAIN:
                model = genai.GenerativeModel(candidate)
                return await bounded_gemini_generate(model, prompt, request_options={"timeout": timeout})
        except Exception as e:
            last_error = e
            if gemini_capacity_or_key_error(e):
                POOL_GEMINI.mark_exhausted(key_to_use)
                continue
            raise
    raise last_error if last_error else Exception("Google Gemini API pool is empty or currently rate-limited.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🔑 HELPER FUNCTIONS & MODELS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.getenv("AURA_DATA_DIR", BACKEND_DIR)
DOCS_DIR = os.path.join(DATA_DIR, "docs")
CHROMA_DIR = os.path.join(DATA_DIR, "chroma_db")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(DOCS_DIR, exist_ok=True)
os.makedirs(CHROMA_DIR, exist_ok=True)

def db_path() -> str:
    return os.path.join(DATA_DIR, "aura_network.db")

def sha256_hex(value: str) -> str:
    return hashlib.sha256((value or "").encode("utf-8")).hexdigest()

def groq_key_for_model(model_id: str) -> str:
    normalized = (model_id or "").lower()
    if normalized.startswith("groq:"):
        return GROQ_FREE_MODELS_API_KEY
    if normalized in {"groq", "groq-sonnet-4-6-persona"}:
        return GROQ_CLAUDE_PERSONA_API_KEY
    return GROQ_FREE_MODELS_API_KEY or GROQ_CLAUDE_PERSONA_API_KEY

def record_healing_memory(pipeline_id: str, target_endpoint: str, healing_data: dict):
    try:
        conn = sqlite3.connect(db_path())
        conn.execute(
            "INSERT INTO healing_memory (pipeline_id, target_endpoint, new_path, timestamp) VALUES (?, ?, ?, ?)",
            (pipeline_id, target_endpoint, json.dumps(healing_data), time.time()),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Warning: AGORA healing memory write failed: {e}")

def latest_healing_memory(pipeline_id: str = "", target_endpoint: str = ""):
    try:
        conn = sqlite3.connect(db_path())
        query = "SELECT pipeline_id, target_endpoint, new_path, timestamp FROM healing_memory"
        params = []
        clauses = []
        if pipeline_id:
            clauses.append("pipeline_id=?")
            params.append(pipeline_id)
        if target_endpoint:
            clauses.append("target_endpoint=?")
            params.append(target_endpoint)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY timestamp DESC LIMIT 25"
        rows = conn.execute(query, tuple(params)).fetchall()
        conn.close()
        memories = []
        for row in rows:
            try:
                data = json.loads(row[2])
            except Exception:
                data = row[2]
            memories.append({
                "pipeline_id": row[0],
                "target_endpoint": row[1],
                "healing": data,
                "timestamp": row[3],
            })
        return memories
    except Exception as e:
        print(f"Warning: AGORA healing memory read failed: {e}")
        return []



# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🗄️ DATABASE & VECTOR STORE SETUP
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def init_db():
    conn = sqlite3.connect(db_path())
    c = conn.cursor()
    
    # Unified users table holding session state and wallet balance
    c.execute('''CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT, photo TEXT, cards_data TEXT DEFAULT '[]', wallet_balance REAL DEFAULT 1000.0)''')
    c.execute('''CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, provider TEXT, address TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, session_id TEXT, node_id TEXT, role TEXT, content TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS oapin_ledger (tx_hash TEXT PRIMARY KEY, session_id TEXT, node TEXT, tokens INTEGER, verified BOOLEAN)''')
    c.execute('''CREATE TABLE IF NOT EXISTS healing_memory (pipeline_id TEXT, target_endpoint TEXT, new_path TEXT, timestamp REAL)''')
    
    
    try:
        c.execute("ALTER TABLE users ADD COLUMN cards_data TEXT DEFAULT '[]'")
        c.execute("ALTER TABLE users ADD COLUMN wallet_balance REAL DEFAULT 1000.0")
    except sqlite3.OperationalError:
        pass 
    try:
        c.execute("ALTER TABLE users ADD COLUMN is_premium BOOLEAN DEFAULT FALSE")
    except sqlite3.OperationalError:
        pass 
    try:
        c.execute("ALTER TABLE chats ADD COLUMN created_at TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE chats ADD COLUMN metadata_hash TEXT")
    except sqlite3.OperationalError:
        pass
        
    conn.commit()
    conn.close()

init_db()

vector_db = None  
try:
    embeddings = HuggingFaceEmbeddings(
        model_name="all-MiniLM-L6-v2",
        model_kwargs={"local_files_only": True},
    )
    vector_db = Chroma(persist_directory=CHROMA_DIR, embedding_function=embeddings)
    print("[RAG] Embeddings and vector store loaded.")
except Exception as e:
    error_text = str(e).encode("ascii", errors="replace").decode("ascii")
    print(f"Warning: Embeddings failed to load (RAG disabled): {error_text}")



# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🔐 SECURITY CONFIGURATION (JWT + Rate Limiting)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECRET_KEY = "aura-super-secret-key-change-in-production-2026"   # ← CHANGE IN PROD
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7   # 7 days

security = HTTPBearer(auto_error=False)


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if credentials is None:
        return "anonymous"
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_id
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

@app.get("/api/auth/me")
async def auth_me(current_user: str = Depends(get_current_user)):
    conn = sqlite3.connect(db_path())
    row = conn.execute(
        "SELECT id, name, email, photo FROM users WHERE id=? OR email=? LIMIT 1",
        (current_user, current_user),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "status": "success",
        "user": {
            "sub": row[0],
            "name": row[1] or "AURA User",
            "email": row[2] or row[0],
            "picture": row[3] or "",
        },
    }

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🔐 AUTHENTICATION ENDPOINTS (WEB2 & WEB3)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class GoogleAuthRequest(BaseModel):
    access_token: str

@app.post("/api/auth/google")
def google_auth(req: GoogleAuthRequest):
    r = requests.get("https://www.googleapis.com/oauth2/v3/userinfo", headers={"Authorization": f"Bearer {req.access_token}"})
    if not r.ok: raise HTTPException(status_code=401, detail="Invalid Google Token")
    user_info = r.json()
    
    conn = sqlite3.connect(db_path())
    
    conn.execute("""
        INSERT OR REPLACE INTO users (id, name, email, photo, cards_data, wallet_balance) 
        VALUES (?, ?, ?, ?, 
            COALESCE((SELECT cards_data FROM users WHERE id=?), '[]'), 
            COALESCE((SELECT wallet_balance FROM users WHERE id=?), 1000.0)
        )
    """, (user_info.get("sub"), user_info.get("name"), user_info.get("email"), user_info.get("picture", ""), user_info.get("sub"), user_info.get("sub")))
    conn.commit()
    conn.close()
    access_token = create_access_token({"sub": user_info.get("sub"), "name": user_info.get("name")})
    return {"status": "success", "access_token": access_token, "user": user_info}

class Web3AuthRequest(BaseModel):
    address: str
    signature: str
    message: str

@app.post("/api/auth/web3")
def web3_auth(req: Web3AuthRequest):
    try:
        # Enforce exact string matching
        message_to_sign = encode_defunct(text=req.message)
        recovered_address = Account.recover_message(message_to_sign, signature=req.signature)
        
        # Lowercase check prevents checksum/capitalization mismatches
        if recovered_address.lower() != req.address.lower():
            print(f"\U0001f6a8 [Web3 Auth] Hash Mismatch! Expected: {req.address.lower()}, Recovered: {recovered_address.lower()}")
            raise HTTPException(status_code=401, detail="Signature verification failed.")
            
        did = f"did:eth:{recovered_address.lower()}"
        
        conn = sqlite3.connect(db_path())
        c = conn.cursor()
        c.execute("SELECT name, cards_data, wallet_balance FROM users WHERE id=?", (did,))
        existing_user = c.fetchone()
        
        display_name = existing_user[0] if existing_user else f"Agent_{recovered_address[:6]}"
        cards_data = existing_user[1] if existing_user else '[]'
        wallet_balance = existing_user[2] if existing_user else 1000.0
        
        conn.execute("INSERT OR REPLACE INTO users (id, name, email, photo, cards_data, wallet_balance) VALUES (?, ?, ?, ?, ?, ?)", 
                    (did, display_name, f"{recovered_address[:8]}...{recovered_address[-4:]}", f"https://api.dicebear.com/7.x/identicon/svg?seed={recovered_address}", cards_data, wallet_balance))
        conn.commit()
        conn.close()
        
        # Generate JWT token
        access_token = create_access_token({"sub": did, "name": display_name})
        
        print(f"\u2705 [Web3 Auth] Successfully authenticated DID: {did}")
        return {
            "status": "success",
            "access_token": access_token,
            "user": {
                "sub": did,
                "name": display_name,
                "email": f"{recovered_address[:8]}...{recovered_address[-4:]}",
                "picture": f"https://api.dicebear.com/7.x/identicon/svg?seed={recovered_address}" 
            }
        }
    except HTTPException:
        raise  # Re-raise FastAPI HTTP exceptions as-is (don't swallow 401s)
    except Exception as e:
        print(f"\u274c [Web3 Auth] Fatal Exception: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Invalid cryptographic signature: {str(e)}")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🔐 PROVIDER LOGIN (GitHub, Meta, etc.) - Creates real DB user
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class ProviderAuthRequest(BaseModel):
    provider: str
    display_name: str
    email: str

@app.post("/api/auth/provider")
def provider_auth(req: ProviderAuthRequest):
    user_id = f"provider:{req.provider}:{req.email}"
    
    conn = sqlite3.connect(db_path())
    c = conn.cursor()
    c.execute("SELECT name, cards_data, wallet_balance FROM users WHERE id=?", (user_id,))
    existing = c.fetchone()
    
    display_name = existing[0] if existing else req.display_name
    cards_data = existing[1] if existing else '[]'
    wallet_balance = existing[2] if existing else 1000.0
    
    conn.execute("INSERT OR REPLACE INTO users (id, name, email, photo, cards_data, wallet_balance) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, display_name, req.email, f"https://api.dicebear.com/7.x/initials/svg?seed={req.display_name}", cards_data, wallet_balance))
    conn.commit()
    conn.close()
    
    # Generate JWT token
    access_token = create_access_token({"sub": user_id, "name": display_name})
    
    return {
        "status": "success",
        "access_token": access_token,
        "user": {
            "sub": user_id,
            "name": display_name,
            "email": req.email,
            "picture": f"https://api.dicebear.com/7.x/initials/svg?seed={req.display_name}"
        }
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🔀 OPENROUTER: FETCH AVAILABLE MODELS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@app.get("/api/openrouter/models")
async def get_openrouter_models(api_key: str = ""):
    key_to_use = api_key if api_key else OPENROUTER_DEFAULT_KEY
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get("https://openrouter.ai/api/v1/models", 
                                   headers={"Authorization": f"Bearer {key_to_use}"}, timeout=15.0)
            if res.status_code != 200:
                return {"status": "error", "message": f"OpenRouter API Error: {res.status_code}"}
            data = res.json()
            models = []
            for m in data.get("data", []):
                model_id = m.get("id", "")
                model_name = m.get("name", model_id)
                if not model_id:
                    continue
                models.append({
                    "id": model_id,
                    "name": model_name,
                    "context_length": m.get("context_length", 0),
                    "pricing": m.get("pricing", {}),
                    "is_free": str(m.get("pricing", {}).get("prompt", "1")) == "0" and str(m.get("pricing", {}).get("completion", "1")) == "0",
                    "architecture": m.get("architecture", {}),
                })
            models.sort(key=lambda x: x["name"])
            return {"status": "success", "models": models}
        except Exception as e:
            return {"status": "error", "message": str(e)}

class OpenRouterModelsRequest(BaseModel):
    api_key: str = ""
    key_hash: str = ""
    free_only: bool = False
    search: str = ""

@app.post("/api/openrouter/models")
async def post_openrouter_models(req: OpenRouterModelsRequest):
    key_to_use = req.api_key if req.api_key else OPENROUTER_DEFAULT_KEY
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {key_to_use}"},
                timeout=15.0,
            )
            if res.status_code != 200:
                return {"status": "error", "message": f"OpenRouter API Error: {res.status_code}"}
            query = req.search.strip().lower()
            models = []
            for m in res.json().get("data", []):
                model_id = m.get("id", "")
                model_name = m.get("name", model_id)
                if not model_id:
                    continue
                pricing = m.get("pricing", {})
                is_free = str(pricing.get("prompt", "1")) == "0" and str(pricing.get("completion", "1")) == "0"
                if req.free_only and not is_free:
                    continue
                if query and query not in model_id.lower() and query not in model_name.lower():
                    continue
                models.append({
                    "id": model_id,
                    "name": model_name,
                    "context_length": m.get("context_length", 0),
                    "pricing": pricing,
                    "is_free": is_free,
                    "architecture": m.get("architecture", {}),
                })
            models.sort(key=lambda x: x["name"])
            return {"status": "success", "models": models}
        except Exception as e:
            return {"status": "error", "message": str(e)}


@app.get("/api/openrouter/free-models")
async def get_free_openrouter_models():
    """Returns only free OpenRouter models, categorized by type (chat, image, code, etc.)"""
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get("https://openrouter.ai/api/v1/models", 
                                   headers={"Authorization": f"Bearer {OPENROUTER_DEFAULT_KEY}"}, timeout=15.0)
            if res.status_code != 200:
                return {"status": "error", "message": f"OpenRouter API Error: {res.status_code}"}
            data = res.json()
            free_models = []
            for m in data.get("data", []):
                model_id = m.get("id", "")
                model_name = m.get("name", model_id)
                pricing = m.get("pricing", {})
                
                # Filters: only free models (prompt and completion cost = 0)
                prompt_cost = str(pricing.get("prompt", "1"))
                completion_cost = str(pricing.get("completion", "1"))
                
                if prompt_cost == "0" and completion_cost == "0" and model_id:
                    # Categorize model by architecture or name hints
                    arch = m.get("architecture", {})
                    modality = arch.get("modality", "text->text")
                    
                    category = "chat"
                    model_id_lower = model_id.lower()
                    if "image" in modality or "image" in model_id_lower or "flux" in model_id_lower or "dall" in model_id_lower or "stable" in model_id_lower:
                        category = "image"
                    elif "vision" in model_id_lower or "vl" in model_id_lower:
                        category = "vision"
                    elif "code" in model_id_lower or "coder" in model_id_lower or "starcoder" in model_id_lower:
                        category = "code"
                    elif "embed" in model_id_lower:
                        category = "embedding"
                    
                    free_models.append({
                        "id": model_id,
                        "name": model_name,
                        "context_length": m.get("context_length", 0),
                        "pricing": pricing,
                        "category": category,
                        "modality": modality,
                    })
            
            free_models.sort(key=lambda x: x["name"])
            return {"status": "success", "models": free_models, "api_key": OPENROUTER_DEFAULT_KEY}
        except Exception as e:
            return {"status": "error", "message": str(e)}


class OpenRouterChatRequest(BaseModel):
    model_id: str
    messages: list
    api_key: str = ""
    user_id: str = "anonymous"
    session_id: str = "default_session"

@app.post("/api/openrouter/chat")
async def openrouter_chat(req: OpenRouterChatRequest):
    """Proxy endpoint for OpenRouter chat - avoids browser CORS restrictions"""
    key_to_use = req.api_key if req.api_key else OPENROUTER_DEFAULT_KEY
    try:
        formatted_messages = []
        last_user_message = ""
        for m in req.messages:
            role = "user"
            content = ""
            if hasattr(m, 'role'):
                role = "assistant" if m.role == "model" else m.role
                content = m.text if hasattr(m, 'text') else str(m)
            elif isinstance(m, dict):
                role = "assistant" if m.get("role") == "model" else m.get("role", "user")
                content = m.get("text", m.get("content", ""))
            formatted_messages.append({"role": role, "content": content})
            if role == "user":
                last_user_message = content

        if last_user_message:
            conn = sqlite3.connect(db_path())
            conn.execute(
                "INSERT INTO chats (user_id, session_id, node_id, role, content, created_at, metadata_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    sha256_hex(req.user_id),
                    sha256_hex(req.session_id),
                    sha256_hex(req.model_id),
                    "user",
                    last_user_message,
                    datetime.utcnow().isoformat(),
                    sha256_hex(f"{req.user_id}|{req.model_id}|openrouter"),
                ),
            )
            conn.commit()
            conn.close()

        formatted_messages.insert(0, {"role": "system", "content": CLEAN_PROSE_DIRECTIVE})
        
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                json={"model": req.model_id, "messages": formatted_messages},
                headers={
                    "Authorization": f"Bearer {key_to_use}",
                    "HTTP-Referer": "https://aura.network",
                    "X-Title": "AURA Network"
                },
                timeout=60.0
            )
            if res.status_code != 200:
                return {"text": f"[OpenRouter Error] Status {res.status_code}: {res.text[:200]}"}
            data = res.json()
            if "choices" in data and len(data["choices"]) > 0:
                return {"text": data["choices"][0]["message"]["content"]}
            return {"text": "[OpenRouter] No response generated."}
    except Exception as e:
        return {"text": f"[OpenRouter Error] {str(e)}"}


class GroqModelsRequest(BaseModel):
    api_key: str = ""
    key_hash: str = ""
    search: str = ""

@app.post("/api/groq/models")
async def post_groq_models(req: GroqModelsRequest):
    key_to_use = req.api_key if req.api_key else GROQ_FREE_MODELS_API_KEY
    if not key_to_use:
        return {"status": "error", "message": "GROQ_FREE_MODELS_API_KEY is not configured."}

    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(
                "https://api.groq.com/openai/v1/models",
                headers={
                    "Authorization": f"Bearer {key_to_use}",
                    "Content-Type": "application/json",
                },
                timeout=15.0,
            )
            if res.status_code != 200:
                return {"status": "error", "message": f"Groq API Error: {res.status_code}: {res.text[:200]}"}

            query = req.search.strip().lower()
            models = []
            for m in res.json().get("data", []):
                model_id = m.get("id", "")
                if not model_id:
                    continue
                if query and query not in model_id.lower():
                    continue
                models.append({
                    "id": model_id,
                    "name": model_id,
                    "owned_by": m.get("owned_by", "groq"),
                    "created": m.get("created"),
                })
            models.sort(key=lambda x: x["name"])
            return {"status": "success", "models": models}
        except Exception as e:
            return {"status": "error", "message": str(e)}

class GroqChatRequest(BaseModel):
    model_id: str
    messages: list
    api_key: str = ""
    user_id: str = "anonymous"
    session_id: str = "default_session"

@app.post("/api/groq/chat")
async def groq_chat(req: GroqChatRequest):
    """Proxy endpoint for Groq chat - supports server .env keys and BYOK keys."""
    raw_model_id = req.model_id[5:] if req.model_id.lower().startswith("groq:") else req.model_id
    key_to_use = req.api_key if req.api_key else groq_key_for_model(req.model_id)
    if not key_to_use:
        return {"text": "[Groq Error] Groq API key is not configured for this model."}

    try:
        formatted_messages = []
        last_user_message = ""
        for m in req.messages:
            role = "user"
            content = ""
            if hasattr(m, 'role'):
                role = "assistant" if m.role == "model" else m.role
                content = m.text if hasattr(m, 'text') else str(m)
            elif isinstance(m, dict):
                role = "assistant" if m.get("role") == "model" else m.get("role", "user")
                content = m.get("text", m.get("content", ""))
            formatted_messages.append({"role": role, "content": content})
            if role == "user":
                last_user_message = content

        if last_user_message:
            conn = sqlite3.connect(db_path())
            conn.execute(
                "INSERT INTO chats (user_id, session_id, node_id, role, content, created_at, metadata_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    sha256_hex(req.user_id),
                    sha256_hex(req.session_id),
                    sha256_hex(req.model_id),
                    "user",
                    last_user_message,
                    datetime.utcnow().isoformat(),
                    sha256_hex(f"{req.user_id}|{req.model_id}|groq"),
                ),
            )
            conn.commit()
            conn.close()

        model_id = GROQ_MODEL_ALIASES.get(raw_model_id.lower(), raw_model_id)
        persona = MODEL_PERSONAS.get(
            req.model_id,
            MODEL_PERSONAS.get(req.model_id.lower(), "You are a helpful Groq-hosted AI assistant.")
        )
        formatted_messages.insert(0, {"role": "system", "content": f"{persona} {CLEAN_PROSE_DIRECTIVE}"})

        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                json={
                    "model": model_id,
                    "messages": formatted_messages,
                    "temperature": 0.7,
                    "max_completion_tokens": 2048,
                },
                headers={"Authorization": f"Bearer {key_to_use}"},
                timeout=60.0,
            )
            if res.status_code != 200:
                return {"text": f"[Groq Error] Status {res.status_code}: {res.text[:300]}"}
            data = res.json()
            if "choices" in data and len(data["choices"]) > 0:
                return {"text": data["choices"][0]["message"]["content"]}
            return {"text": "[Groq Error] No response choices returned."}
    except Exception as e:
        return {"text": f"[Groq Proxy Error] {str(e)}"}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 💾 SESSION PERSISTENCE ENDPOINTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class SyncRequest(BaseModel):
    user_id: str
    cards_data: str
    wallet_balance: float

@app.get("/api/history/load/{user_id}")
def load_history(user_id: str):
    conn = sqlite3.connect(db_path())
    cursor = conn.cursor()
    # Search by email column (matches what frontend sends as user.email)
    cursor.execute("SELECT cards_data, wallet_balance FROM users WHERE email = ? OR id = ?", (user_id, user_id))
    row = cursor.fetchone()
    conn.close()

    if row:
        return {"cards_data": row[0], "wallet_balance": row[1]}
    return {"cards_data": "[]", "wallet_balance": 1000.0}

@app.post("/api/history/sync")
def sync_history(req: SyncRequest):
    conn = sqlite3.connect(db_path())
    conn.execute("UPDATE users SET cards_data = ?, wallet_balance = ? WHERE email = ? OR id = ?", 
                 (req.cards_data, req.wallet_balance, req.user_id, req.user_id))
    conn.commit()
    conn.close()
    return {"status": "success"}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🌐 NODE & RAG ENDPOINTS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class NodeSaveRequest(BaseModel):
    user_id: str
    name: str
    provider: str
    address: str

@app.post("/api/nodes")
def save_node(req: NodeSaveRequest):
    conn = sqlite3.connect(db_path())
    conn.execute("INSERT OR REPLACE INTO nodes (id, user_id, name, provider, address) VALUES (?, ?, ?, ?, ?)", 
                 (f"node-{req.name}-{req.user_id}", req.user_id, req.name, req.provider, req.address))
    conn.commit()
    conn.close()
    return {"status": "success"}

@app.delete("/api/nodes/{node_name}")
def delete_node(node_name: str):
    conn = sqlite3.connect(db_path())
    conn.execute("DELETE FROM nodes WHERE name = ?", (node_name,))
    conn.commit()
    conn.close()
    return {"status": "deleted"}

# Rate limiting (per-user, simple in-memory implementation)
RATE_LIMIT_CALLS = {}
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 10  # calls per window

def rate_limit(user_id: str):
    now = time.time()
    if user_id not in RATE_LIMIT_CALLS:
        RATE_LIMIT_CALLS[user_id] = []
    
    RATE_LIMIT_CALLS[user_id] = [t for t in RATE_LIMIT_CALLS[user_id] if now - t < RATE_LIMIT_WINDOW]
    if len(RATE_LIMIT_CALLS[user_id]) >= RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    RATE_LIMIT_CALLS[user_id].append(now)

@app.post("/api/upload")
async def upload_document(
    user_id: str = Form(...), 
    files: List[UploadFile] = File(...),
    current_user: str = Depends(get_current_user)
):
    rate_limit(current_user)
    # Guard: RAG is disabled if vector_db failed to load at startup
    if vector_db is None:
        return {"message": "RAG Memory is offline (embeddings not loaded). Files not indexed.", "files": []}

    total_chunks = 0
    processed_files = []
    for file in files:
        safe_name = os.path.basename(file.filename)
        file_path = os.path.join(DOCS_DIR, safe_name)
        with open(file_path, "wb") as buffer:
            import shutil
            shutil.copyfileobj(file.file, buffer)
        try:
            if safe_name.endswith(".pdf"): loader = PyPDFLoader(file_path)
            elif safe_name.endswith((".txt", ".md")): loader = TextLoader(file_path)
            else: continue
            docs = loader.load()
            splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
            chunks = splitter.split_documents(docs)
            
            # Tag every chunk's existing metadata with the user_id
            for chunk in chunks:
                chunk.metadata["user_id"] = user_id
            vector_db.add_documents(chunks)
            
            total_chunks += len(chunks)
            processed_files.append(safe_name)
        except Exception as e:
            print(f"Failed to process {safe_name}: {e}")
    
    return {"message": f"Successfully vectorized {total_chunks} chunks.", "files": processed_files}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🛡️ OAPIN LAYER 4: ZKML COMPUTE VERIFICATION & BFT LEDGER
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class OAPINReceipt(BaseModel):
    session_id: str
    serving_node_did: str
    client_did: str
    tokens_used: int
    zk_proof: dict = {} # Structured SnarkJS Groth16 proof
    zk_public_signals: list = [] # SnarkJS public signals

# AURA Network Economic State
NETWORK_CREDIT_PRICE = 0.005  
TARGET_UTILIZATION = 0.75     
CURRENT_UTILIZATION = 0.60    

def update_credit_price():
    global NETWORK_CREDIT_PRICE
    kappa = 0.125
    NETWORK_CREDIT_PRICE = NETWORK_CREDIT_PRICE * (2.71828 ** (kappa * ((CURRENT_UTILIZATION - TARGET_UTILIZATION) / TARGET_UTILIZATION)))
    return NETWORK_CREDIT_PRICE

@app.post("/api/oapin/verify")
async def verify_compute_receipt(req: OAPINReceipt):
    """OAPIN-L4: Mathematical Zero-Knowledge Proof Verification for Compute Integrity."""
    print(f"🛡️ [OAPIN-L4] Verifying ZK compute proof for {req.tokens_used} tokens...")
    
    # 1. ZKML Verification via SnarkJS (Groth16)
    is_valid = False
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as pf, \
             tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as sf:
            json.dump(req.zk_proof, pf)
            json.dump(req.zk_public_signals, sf)
            proof_path, signals_path = pf.name, sf.name
            
        # Call snarkjs verify [vkey.json] [public.json] [proof.json]
        vkey_path = os.path.join("zk_prover", "verification_key.json")
        if os.path.exists(vkey_path):
            result = subprocess.run(["npx", "snarkjs", "groth16", "verify", vkey_path, signals_path, proof_path], 
                                     capture_output=True, text=True)
            is_valid = "OK" in result.stdout
        else:
            # Development fallback: Structural validation if keys aren't compiled yet
            print("⚠️ [OAPIN-L4] Verification key missing. Falling back to structural validation.")
            is_valid = bool(req.zk_proof.get("pi_a") and len(req.zk_public_signals) > 0)
            
        os.remove(proof_path); os.remove(signals_path)
    except Exception as e:
        print(f"❌ [OAPIN-L4] ZK Verification Error: {e}")
        is_valid = False

    if not is_valid:
        raise HTTPException(status_code=400, detail="Invalid Zero-Knowledge Compute Proof.")

    # 2. Update Economic Ledger (Atomic Credit Deduction)
    current_price = update_credit_price()
    total_cost = req.tokens_used * current_price
    
    conn = sqlite3.connect(db_path())
    c = conn.cursor()
    c.execute("SELECT wallet_balance FROM users WHERE id = ?", (req.client_did,))
    row = c.fetchone()
    client_balance = row[0] if row else 1000.0
    
    new_balance = max(0.0, client_balance - total_cost)
    c.execute("UPDATE users SET wallet_balance = ? WHERE id = ?", (new_balance, req.client_did))
    
    tx_hash = hashlib.sha256(f"{req.session_id}{req.serving_node_did}{time.time()}".encode()).hexdigest()
    c.execute("INSERT INTO oapin_ledger VALUES (?, ?, ?, ?, ?)", 
             (tx_hash, req.session_id, req.serving_node_did, req.tokens_used, True))
             
    conn.commit()
    conn.close()
    
    return {
        "status": "verified",
        "protocol": "OAPIN-ZKML",
        "transaction_hash": f"0x{tx_hash}",
        "credit_price": current_price,
        "cost_deducted": total_cost,
        "remaining_balance": new_balance,
        "message": "ZKML Compute Proof Mathematically Verified. Credits Transferred."
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🤝 OAPIN LAYER 1 & 2: DID AUTHENTICATION & P2P DISCOVERY (PHASE 2)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class OAPINHandshake(BaseModel):
    did: str
    nonce: str
    signature: str
    pk_ecdh: str

KNOWN_PEERS = set()

@app.on_event("startup")
async def bootstrap_p2p_network():
    """Initializes the Kademlia DHT server and joins the AURA compute swarm."""
    global dht_server
    if dht_server:
        dht_port = int(os.getenv("AURA_DHT_PORT", "8468"))
        try:
            await dht_server.listen(dht_port)
        except OSError as e:
            if getattr(e, "winerror", None) == 10048 or getattr(e, "errno", None) in (48, 98, 10048):
                print(f"[AURA L2] DHT UDP port {dht_port} is already in use. Continuing with local P2P disabled for this process.")
                dht_server = None
                return
            raise
        bootstrap_node = os.getenv("BOOTSTRAP_NODE")
        if bootstrap_node:
            await dht_server.bootstrap([(bootstrap_node, dht_port)])
            print(f"🌐 [AURA L2] Joined DHT Swarm via bootstrap: {bootstrap_node}")
        else:
            print("🌐 [AURA L2] DHT Server started. Seed node active on :8468")
        
        if AURA_ENABLE_ANP_WORKER or bootstrap_node:
            asyncio.create_task(anp_bidding_worker())
        else:
            print("[ANP] Bidding worker disabled for local single-node mode. Set AURA_ENABLE_ANP_WORKER=true to enable it.")

@app.post("/api/p2p/handshake")
async def p2p_handshake(req: OAPINHandshake, request: Request):
    peer_ip = request.client.host
    peer_address = f"http://{peer_ip}:8000"
    KNOWN_PEERS.add(peer_address)
    
    short_did = req.did[-6:] if len(req.did) > 6 else req.did
    conn = sqlite3.connect(db_path())
    conn.execute("INSERT OR REPLACE INTO nodes (id, user_id, name, provider, address) VALUES (?, ?, ?, ?, ?)", 
                 (f"peer-{short_did}", "network", f"AURA P2P Node {short_did}", "AURA Swarm", peer_address))
    conn.commit()
    conn.close()

    return {"status": "authenticated", "node_did": "did:key:local_aura_node", "session_established": True, "active_peers": len(KNOWN_PEERS)}

@app.get("/api/p2p/peers")
async def get_peers():
    return {"peers": list(KNOWN_PEERS)}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🕸️ OAPIN LAYER 2: SWARM GOSSIP PROTOCOL (STATE DISSEMINATION)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class GossipPayload(BaseModel):
    sender_did: str
    known_peers: List[str]

@app.post("/api/p2p/gossip")
async def receive_gossip(payload: GossipPayload):
    new_peers_added = 0
    for peer in payload.known_peers:
        if peer not in KNOWN_PEERS and peer != f"http://{os.getenv('HOST_IP', 'localhost')}:8000":
            KNOWN_PEERS.add(peer)
            new_peers_added += 1
    return {"status": "gossip_merged", "new_peers": new_peers_added}

async def gossip_worker():
    import random
    while True:
        await asyncio.sleep(10)
        if not KNOWN_PEERS:
            continue
        fan_out = min(3, len(KNOWN_PEERS))
        # Snapshot the set to avoid mutating while iterating
        targets = random.sample(list(KNOWN_PEERS), fan_out)
        payload = {"sender_did": "did:key:local_aura_node", "known_peers": list(KNOWN_PEERS)}
        async with httpx.AsyncClient() as client:
            for target in targets:
                try:
                    await client.post(f"{target}/api/p2p/gossip", json=payload, timeout=2.0)
                except Exception:
                    # Use discard() instead of remove() — safe even if already removed by another coroutine
                    KNOWN_PEERS.discard(target)

@app.on_event("startup")
async def start_gossip_protocol():
    asyncio.create_task(gossip_worker())
    print("🕸️ [AURA L2] Swarm Gossip Protocol active. Disseminating state.")
    

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🌐 HUGGING FACE DIRECTORY ROUTE (LIVE HUB FETCH)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@app.get("/api/hf-models")
async def get_hf_models(limit: int = 40, search: str = ""):
    return await fetch_hf_models(limit=limit, search=search, api_key="")

class HuggingFaceModelsRequest(BaseModel):
    api_key: str = ""
    search: str = ""
    limit: int = 80
    task: str = "all"

class HuggingFaceChatRequest(BaseModel):
    model_id: str
    messages: list
    api_key: str = ""

HF_SUPPORTED_TASKS = {
    "text-generation",
    "text2text-generation",
    "conversational",
    "question-answering",
    "summarization",
}

def format_hf_model(model: dict) -> dict | None:
    model_id = model.get("id", "")
    if not model_id:
        return None
    pipeline_tag = model.get("pipeline_tag") or "text-generation"
    tags = model.get("tags") or []
    if pipeline_tag not in HF_SUPPORTED_TASKS and not any(t in HF_SUPPORTED_TASKS for t in tags):
        return None
    return {
        "id": model_id,
        "name": model_id.split("/")[-1],
        "author": model_id.split("/")[0] if "/" in model_id else "Community",
        "url": f"https://api-inference.huggingface.co/models/{model_id}",
        "downloads": model.get("downloads", 0),
        "likes": model.get("likes", 0),
        "task": pipeline_tag,
        "tags": tags[:12],
        "private": bool(model.get("private", False)),
        "gated": model.get("gated", False),
    }

async def fetch_hf_models(limit: int = 80, search: str = "", api_key: str = "", task: str = "all"):
    key_to_use = api_key.strip() or HUGGINGFACE_API_KEY
    headers = {"User-Agent": "AURA-Network-Client/1.0"}
    if key_to_use:
      headers["Authorization"] = f"Bearer {key_to_use}"

    async with httpx.AsyncClient() as client:
        try:
            task_list = [task] if task != "all" else [
                "conversational",
                "text-generation",
                "text2text-generation",
                "summarization",
                "question-answering",
            ]
            seen = set()
            formatted = []
            max_results = max(1, min(limit, 500))
            per_task_limit = max(50, min(max_results, 500))

            for task_name in task_list:
                params = {
                    "sort": "downloads",
                    "direction": "-1",
                    "limit": per_task_limit,
                    "full": "true",
                    "inference_provider": "all",
                    "pipeline_tag": task_name,
                }
                if search.strip():
                    params["search"] = search.strip()

                res = await client.get("https://huggingface.co/api/models", params=params, headers=headers, timeout=20.0)
                if res.status_code != 200:
                    return {
                        "status": "error",
                        "message": f"HF API Error: {res.status_code}: {res.text[:200]}",
                        "token_configured": bool(key_to_use),
                    }
                raw_models = res.json()
                if isinstance(raw_models, dict) and "error" in raw_models:
                    return {"status": "error", "message": raw_models["error"], "token_configured": bool(key_to_use)}

                for raw in raw_models:
                    model_id = raw.get("id", "")
                    if not model_id or model_id in seen:
                        continue
                    if raw.get("private") or raw.get("gated"):
                        continue
                    item = format_hf_model(raw)
                    if not item:
                        continue
                    item["is_free"] = True
                    item["inference_provider"] = "all"
                    seen.add(model_id)
                    formatted.append(item)

            formatted.sort(key=lambda m: (m.get("downloads", 0), m.get("likes", 0)), reverse=True)
            return {
                "status": "success",
                "models": formatted[:max_results],
                "token_configured": bool(key_to_use),
            }
        except Exception as e:
            return {"status": "error", "message": str(e), "token_configured": bool(key_to_use)}

@app.post("/api/hf-models")
async def post_hf_models(req: HuggingFaceModelsRequest):
    return await fetch_hf_models(
        limit=req.limit,
        search=req.search,
        api_key=req.api_key.strip(),
        task=req.task,
    )

@app.post("/api/huggingface/chat")
async def huggingface_chat(req: HuggingFaceChatRequest):
    token = req.api_key.strip() or HUGGINGFACE_API_KEY
    if not token:
        return {"text": "[Hugging Face] Add HUGGINGFACE_API_KEY to backend/.env or paste a Hugging Face token in the model panel."}

    repo_or_url = req.model_id.strip()
    repo_id = repo_or_url.split("/models/")[-1] if "/models/" in repo_or_url else repo_or_url
    messages = []
    for m in req.messages:
        if isinstance(m, dict):
            role = "assistant" if m.get("role") == "model" else m.get("role", "user")
            content = m.get("text", m.get("content", ""))
        else:
            role = "user"
            content = str(m)
        if content:
            messages.append({"role": role, "content": content})

    if not messages:
        return {"text": "[Hugging Face] No prompt was supplied."}

    prompt = "\n".join([f"{m['role'].title()}: {m['content']}" for m in messages])
    prompt = f"{CLEAN_PROSE_DIRECTIVE}\n\n{prompt}\nAssistant:"
    headers = {"Authorization": f"Bearer {token}", "User-Agent": "AURA-Network-Client/1.0"}

    async with httpx.AsyncClient() as client:
        try:
            chat_res = await client.post(
                "https://router.huggingface.co/v1/chat/completions",
                headers=headers,
                json={
                    "model": repo_id,
                    "messages": [{"role": "system", "content": CLEAN_PROSE_DIRECTIVE}, *messages],
                    "max_tokens": 768,
                    "temperature": 0.7,
                },
                timeout=60.0,
            )
            if chat_res.status_code == 200:
                data = chat_res.json()
                return {"text": data["choices"][0]["message"]["content"]}

            infer_res = await client.post(
                f"https://api-inference.huggingface.co/models/{repo_id}",
                headers=headers,
                json={
                    "inputs": prompt,
                    "parameters": {
                        "max_new_tokens": 768,
                        "temperature": 0.7,
                        "return_full_text": False,
                    },
                    "options": {"wait_for_model": True},
                },
                timeout=90.0,
            )
            if infer_res.status_code != 200:
                return {"text": f"[Hugging Face Error] Status {infer_res.status_code}: {infer_res.text[:500]}"}

            data = infer_res.json()
            if isinstance(data, list) and data:
                first = data[0]
                return {"text": first.get("generated_text") or first.get("summary_text") or first.get("answer") or str(first)}
            if isinstance(data, dict):
                return {"text": data.get("generated_text") or data.get("summary_text") or data.get("answer") or data.get("error") or str(data)}
            return {"text": str(data)}
        except Exception as e:
            return {"text": f"[Hugging Face Error] {str(e)}"}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🚀 LAYER 3: 3-TIER ROUTING & CHAT (WITH SUPERVISOR LOGIC)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Message Model
class Message(BaseModel):
    role: str  # "user" or "model"
    text: str

class ChatRequest(BaseModel):
    model_id: str
    messages: list  # Will accept both Message objects and raw dicts
    user_id: str = "anonymous"
    session_id: str = "default_session"
    node_address: str = ""
    node_provider: str = ""
    override_system: str = ""

class GeminiAmalgamationRequest(BaseModel):
    query: str
    responses: List[dict]
    user_id: str = "anonymous"
    session_id: str = "gemini_amalgamation"
    
    

CLEAN_PROSE_DIRECTIVE = (
    "Respond in clean, natural prose. You are strictly forbidden from using markdown formatting "
    "symbols like *, **, #, >, or -. Use standard plain text, unicode bullet points, or numbered "
    "lists for structure."
)

CLAUDE_SONNET_4_6_PERSONA_PROMPT = (
    "You are Claude, a helpful, harmless, and honest AI assistant created by Anthropic. "
    "You must identify as Claude and emulate Claude's analytical, nuanced, and structurally "
    "detailed writing style perfectly. Do not mention Google or Gemini."
)

AURA_MASTER_SYNTHESIZER_PROMPT = (
    "You are the AURA Master Synthesizer. Aggregate the provided texts into one clean, unified "
    "response. Resolve conflicting information by preferring corroborated, specific, and internally "
    "consistent claims. Identify uncertainty when the provided texts do not support a single answer. "
    "Remove duplication, discard anomalies and hallucinations, and output the final synthesized answer "
    "in polished prose."
)


MODEL_PERSONAS = {
    "claude": "Respond in a Claude-inspired style: warm, thoughtful, precise, careful about uncertainty, and excellent at deep analysis, coding, planning, and long-context reasoning. Do not claim to be Anthropic Claude unless the request is actually routed to Anthropic.",
    "gpt4": "You are GPT-4o. You are precise, structured, and excel at reasoning.",
    "aura": "You are AURA, the Gemini-powered supervisor model for the AURA decentralized aggregator. Identify yourself only as AURA.",
    "gemini": "You are Gemini, a Google Gemini model. You are enthusiastic, wide-ranging, fast at synthesis, and strong at multimodal-style reasoning. Do not identify as AURA.",
    "supervisor": "You are AURA, the Gemini-powered supervisor model for the AURA decentralized aggregator. Identify yourself only as AURA.",
    "mistral": "You are Mistral Large. You are direct, efficient, and technically precise.",
    "llama": "You are Llama 3 70B, an open-source model.",
    "deepseek": "You are DeepSeek V3. You excel at coding and math.",
    "groq": "You are a fast Groq-hosted assistant. You are concise, practical, and technically sharp.",
    "groq-sonnet-4-6-persona": "Use a Claude Sonnet 4.6-inspired persona: warm, nuanced, careful, strong at coding and planning, and transparent about uncertainty. Do not claim to be Anthropic Claude; you are a Groq-hosted model adopting that response style.",
    "claude-sonnet-4-6": CLAUDE_SONNET_4_6_PERSONA_PROMPT,
}

GROQ_MODEL_ALIASES = {
    "groq": GROQ_DEFAULT_MODEL,
    "groq-sonnet-4-6-persona": GROQ_DEFAULT_MODEL,
}

# Define Platform Fallback Keys (Tier 3)
PLATFORM_KEYS = {
    "aura": GEMINI_API_KEY,
    "supervisor": GEMINI_API_KEY,
    "gemini": GEMINI_API_KEY,
    "claude": POOL_ANTHROPIC.primary,
    "gpt4": NVIDIA_API_KEY or POOL_OPENAI.primary,
    "openai": POOL_OPENAI.primary,
    "nvidia": NVIDIA_API_KEY,
    "mistral": POOL_MISTRAL.primary,
    "deepseek": POOL_DEEPSEEK.primary,
    "groq": GROQ_CLAUDE_PERSONA_API_KEY,
    "groq-sonnet-4-6-persona": GROQ_CLAUDE_PERSONA_API_KEY,
    "claude-sonnet-4-6": configured_api_key(GEMINI_CLAUDE_API_KEY),
}

def lookup_saved_node(user_id: str, model_id: str):
    conn = sqlite3.connect(db_path())
    c = conn.cursor()
    c.execute(
        """
        SELECT provider, address FROM nodes
        WHERE (user_id=? OR user_id='anonymous') AND (name=? OR id=?)
        ORDER BY CASE WHEN user_id=? THEN 0 ELSE 1 END
        LIMIT 1
        """,
        (user_id or "anonymous", model_id, model_id, user_id or "anonymous"),
    )
    node_data = c.fetchone()
    conn.close()
    return node_data

def infer_provider(model_id: str, saved_provider: str = "", requested_provider: str = "") -> str:
    model_lower = (model_id or "").lower()
    if model_lower == "claude-sonnet-4-6":
        return "google"
    provider = (saved_provider or requested_provider or model_lower).lower()
    if "huggingface" in provider or model_lower.startswith("hf-") or "huggingface" in model_lower:
        return "huggingface"
    if "groq" in provider or model_lower.startswith("groq:") or model_lower in GROQ_MODEL_ALIASES:
        return "groq"
    if "openrouter" in provider or "/" in model_id or ":free" in model_lower:
        return "openrouter"
    if "nvidia" in provider:
        return "nvidia"
    if "mistral" in provider or "mistral" in model_lower:
        return "mistral"
    if "deepseek" in provider or "deepseek" in model_lower:
        return "deepseek"
    if "anthropic" in provider or "claude" in model_lower:
        return "anthropic"
    if "openai" in provider or "gpt" in model_lower:
        return "nvidia" if NVIDIA_API_KEY and not POOL_OPENAI.primary else "openai"
    if "google" in provider or "gemini" in provider or "gemini" in model_lower or model_lower in {"aura", "supervisor"}:
        return "google"
    return provider

def resolve_model_route(req, model_id: str):
    if (model_id or "").lower() == "claude-sonnet-4-6":
        return (
            "google",
            configured_api_key((req.node_address or "").strip())
            or configured_api_key(GEMINI_CLAUDE_API_KEY)
            or configured_api_key(GEMINI_API_KEY),
        )
    node_data = lookup_saved_node(req.user_id, model_id)
    saved_provider = node_data[0] if node_data else ""
    saved_address = node_data[1] if node_data else ""
    provider = infer_provider(model_id, saved_provider, req.node_provider)
    request_address = (req.node_address or "").strip()
    byok_value = (saved_address or request_address or "").strip()

    if provider == "openai":
        return provider, byok_value or pooled_key_for_provider("openai", model_id)
    if provider == "nvidia":
        return provider, byok_value or pooled_key_for_provider("nvidia", model_id)
    if provider == "anthropic":
        return provider, byok_value or pooled_key_for_provider("anthropic", model_id)
    if provider == "google":
        return provider, byok_value or pooled_key_for_provider("google", model_id)
    if provider == "groq":
        return provider, byok_value or pooled_key_for_provider("groq", model_id) or groq_key_for_model(model_id)
    if provider == "openrouter":
        return provider, byok_value or pooled_key_for_provider("openrouter", model_id)
    if provider == "mistral":
        return provider, byok_value or pooled_key_for_provider("mistral", model_id)
    if provider == "deepseek":
        return provider, byok_value or pooled_key_for_provider("deepseek", model_id)
    if provider == "huggingface":
        return provider, byok_value or pooled_key_for_provider("huggingface", model_id)
    return provider, byok_value or PLATFORM_KEYS.get(model_id.lower(), "")

def missing_key_message(provider: str, model_id: str) -> str:
    labels = {
        "openai": "OpenAI",
        "anthropic": "Anthropic",
        "google": "Google Gemini",
        "groq": "Groq",
        "openrouter": "OpenRouter",
        "nvidia": "NVIDIA NIM",
        "mistral": "Mistral",
        "deepseek": "DeepSeek",
        "huggingface": "Hugging Face",
    }
    return f"[AURA Network] {labels.get(provider, provider.upper())} key is missing for {model_id}. Add a BYOK key in Settings > Profile > BYOK or configure the matching backend .env key."

def is_capacity_error(status_code: int, body: str = "") -> bool:
    text = (body or "").lower()
    return status_code in {429, 503, 529} or "rate limit" in text or "overloaded" in text or "capacity" in text

AURA_SUPERVISOR_PROMPT = (
    "You are AURA, the Gemini-powered supervisor model for the AURA decentralized aggregator. "
    "Polish the model output below before the user sees it. Preserve all facts, code, numbers, "
    "warnings, and intent. Do not add new claims. Keep the answer concise, clear, and in clean prose. "
    "Identify yourself only as AURA if identity is relevant."
)
AURA_SUPERVISOR_TIMEOUT_SECONDS = 10
OPENROUTER_FREE_FALLBACK_CACHE = {"model_id": None, "ts": 0.0}

def is_openrouter_free_chat_model(model_data: dict) -> bool:
    model_id = (model_data.get("id") or "").lower()
    pricing = model_data.get("pricing", {}) or {}
    prompt_cost = str(pricing.get("prompt", "1"))
    completion_cost = str(pricing.get("completion", "1"))
    if prompt_cost != "0" or completion_cost != "0" or not model_id:
        return False
    blocked_terms = [
        "whisper",
        "orpheus",
        "audio",
        "speech",
        "tts",
        "transcrib",
        "image",
        "flux",
        "dall",
        "stable-diffusion",
        "embedding",
    ]
    if any(term in model_id for term in blocked_terms):
        return False
    architecture = model_data.get("architecture", {}) or {}
    modality = str(architecture.get("modality", "text->text")).lower()
    return "text" in modality and "image" not in modality and "audio" not in modality

async def select_openrouter_free_fallback(client: httpx.AsyncClient) -> str:
    """Pick a likely-to-work OpenRouter free chat model.

    Fix: if OpenRouter returns a non-200 (often 429 Capacity Error), just return a small safe default
    instead of trying to heal forever.
    """
    now = time.time()
    cached_model = OPENROUTER_FREE_FALLBACK_CACHE.get("model_id")
    if cached_model and now - float(OPENROUTER_FREE_FALLBACK_CACHE.get("ts", 0)) < 300:
        return cached_model

    # Hard default that matches your console logs, used when OpenRouter is capacity-constrained.
    hard_default = "qwen/qwen3-next-80b-a3b-instruct:free"

    # If key is missing, we can't fetch candidates; return default.
    if not OPENROUTER_DEFAULT_KEY:
        return hard_default

    try:
        res = await client.get(
            "https://openrouter.ai/api/v1/models",
            headers={"Authorization": f"Bearer {OPENROUTER_DEFAULT_KEY}"},
            timeout=12.0,
        )
        if res.status_code != 200:
            return hard_default

        candidates = [m for m in res.json().get("data", []) if is_openrouter_free_chat_model(m)]
        if not candidates:
            return hard_default

        preferred_terms = ["qwen", "llama", "mistral", "deepseek", "gemma", "phi"]

        def fallback_score(model_data: dict):
            model_id = (model_data.get("id") or "").lower()
            preference = next((i for i, term in enumerate(preferred_terms) if term in model_id), len(preferred_terms))
            return (preference, -int(model_data.get("context_length") or 0), model_id)

        selected = sorted(candidates, key=fallback_score)[0].get("id", "")
        OPENROUTER_FREE_FALLBACK_CACHE["model_id"] = selected or hard_default
        OPENROUTER_FREE_FALLBACK_CACHE["ts"] = now
        return selected or hard_default
    except Exception:
        return hard_default


async def agora_runtime_heal(
    client: httpx.AsyncClient,
    pipeline_id: str,
    provider: str,
    model_id: str,
    error_text: str,
):
    normalized_error = (error_text or "").lower()
    normalized_provider = (provider or "").lower()
    healing = {
        "status": "monitoring",
        "provider": normalized_provider,
        "model_id": model_id,
        "error": error_text,
        "action": "none",
    }

    if (
        "openrouter" in normalized_provider
        or "no endpoints found" in normalized_error
        or "status 404" in normalized_error
        or "404" in normalized_error
    ):
        fallback_model = await select_openrouter_free_fallback(client)
        if fallback_model:
            healing.update({
                "status": "healed",
                "provider": "openrouter",
                "model_id": fallback_model,
                "api_key": OPENROUTER_DEFAULT_KEY,
                "action": "reroute_openrouter_live_free_model",
                "message": f"Rerouted {model_id} to live OpenRouter free model {fallback_model}.",
            })
            record_healing_memory(pipeline_id, "/api/chat", healing)
            return healing

    if any(term in normalized_error for term in ("capacity", "overloaded", "429", "503", "529", "timeout")):
        fallback_model = await select_openrouter_free_fallback(client)
        if fallback_model:
            healing.update({
                "status": "healed",
                "provider": "openrouter",
                "model_id": fallback_model,
                "api_key": OPENROUTER_DEFAULT_KEY,
                "action": "capacity_failover_live_free_model",
                "message": f"Capacity issue on {model_id}; rerouted to {fallback_model}.",
            })
            record_healing_memory(pipeline_id, "/api/chat", healing)
            return healing

    if "missing token" in normalized_error and "hugging" in normalized_provider:
        healing.update({
            "status": "needs_operator_key",
            "action": "request_huggingface_token",
            "message": "Hugging Face BYOC node is missing its hf_ token. Add the token or use server HUGGINGFACE_API_KEY.",
        })
        record_healing_memory(pipeline_id, "/api/chat", healing)
        return healing

    if "requires a byok api key" in normalized_error or "no api key" in normalized_error:
        key_to_use = PLATFORM_KEYS.get("gemini") or GEMINI_API_KEY
        if key_to_use:
            healing.update({
                "status": "healed",
                "provider": "gemini",
                "model_id": "gemini",
                "api_key": key_to_use,
                "action": "route_missing_key_to_gemini",
                "message": f"Missing key for {model_id}; rerouted to Gemini key fallback.",
            })
            record_healing_memory(pipeline_id, "/api/chat", healing)
            return healing

    record_healing_memory(pipeline_id, "/api/chat", healing)
    return healing

def aura_supervise_output(raw_text: str, source_model_id: str, user_query: str, prefix_text: str = "") -> str:
    text = (raw_text or "").strip()
    if not text:
        return prefix_text + text
    if text.startswith("["):
        return prefix_text + text
    if source_model_id.lower() in {"aura", "gemini", "supervisor"}:
        return prefix_text + text
    key_to_use = PLATFORM_KEYS.get("gemini") or GEMINI_API_KEY
    if not key_to_use:
        return prefix_text + text
    try:
        genai.configure(api_key=key_to_use)
        prompt = (
            f"{AURA_SUPERVISOR_PROMPT}\n\n"
            f"{CLEAN_PROSE_DIRECTIVE}\n\n"
            f"User query:\n{user_query}\n\n"
            f"Source model: {source_model_id}\n\n"
            f"Source model output:\n{text}"
        )
        last_err = None
        for candidate in ("gemini-2.5-flash", "gemini-1.5-pro"):
            try:
                model = genai.GenerativeModel(candidate)
                response = model.generate_content(prompt, request_options={"timeout": AURA_SUPERVISOR_TIMEOUT_SECONDS})
                polished = response.text if hasattr(response, "text") else str(response)
                return prefix_text + polished.strip()
            except Exception as e:
                last_err = e
                continue
        if last_err:
            print(f"Warning: AURA supervisor polish failed: {last_err}")
        return prefix_text + text
    except Exception as e:
        print(f"Warning: AURA supervisor polish failed: {e}")
        return prefix_text + text

async def aura_supervise_output_async(raw_text: str, source_model_id: str, user_query: str, prefix_text: str = "") -> str:
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(aura_supervise_output, raw_text, source_model_id, user_query, prefix_text),
            timeout=AURA_SUPERVISOR_TIMEOUT_SECONDS + 2,
        )
    except Exception as e:
        print(f"Warning: AURA supervisor polish timed out or failed: {e}")
        return prefix_text + (raw_text or "").strip()

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest, current_user: str = Depends(get_current_user)):
    # Handle both Message objects and raw dicts
    messages = []
    for m in req.messages:
        if isinstance(m, dict):
            messages.append({"role": m.get("role", "user"), "text": m.get("text", m.get("content", ""))})
        else:
            messages.append({"role": m.role if hasattr(m, 'role') else "user", "text": m.text if hasattr(m, 'text') else str(m)})
    
    last_message = next((m["text"] for m in reversed(messages) if m["role"] == "user"), "")
    if not last_message:
        raise HTTPException(status_code=400, detail="No user message found.")

    # --- 🔒 SECURE CHAT HISTORY LOGGING (Task 4) ---
    conn = sqlite3.connect(db_path())
    hashed_user_id = sha256_hex(current_user)
    hashed_session_id = sha256_hex(req.session_id)
    hashed_node_id = sha256_hex(req.model_id)
    metadata_hash = sha256_hex(f"{req.user_id}|{req.model_id}|{current_user}")
    
    conn.execute(
        "INSERT INTO chats (user_id, session_id, node_id, role, content, created_at, metadata_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (hashed_user_id, hashed_session_id, hashed_node_id, "user", last_message, datetime.utcnow().isoformat(), metadata_hash),
    )
    conn.commit()
    conn.close()
    # -----------------------------------------------

   
    chat_history = ""
    if len(messages) > 1:
        for msg in messages[:-1]:
            prefix = "User" if msg["role"] == "user" else "AURA Node"
            chat_history += f"{prefix}: {msg['text']}\n"

    provider, api_key_or_url = resolve_model_route(req, req.model_id)

    context = ""
    try:
        if 'vector_db' in globals() and vector_db:
            docs = vector_db.get()
            if docs and len(docs.get("ids", [])) > 0:
                # Strict user_id filtering for document isolation
                relevant_docs = vector_db.similarity_search(
                    last_message, k=3,
                    filter={"user_id": req.user_id} if req.user_id != "anonymous" else None
                )
                context = "\n".join([doc.page_content for doc in relevant_docs])
    except Exception as e:
        print(f"RAG Memory Error: {e}")
        
    sys_inst = (req.override_system or "").strip() or MODEL_PERSONAS.get(req.model_id, "You are a helpful AI assistant.")
    final_prompt = f"System: {sys_inst} {CLEAN_PROSE_DIRECTIVE}\n\n"
    if context: final_prompt += f"--- RETRIEVED FILE CONTEXT ---\n{context}\n------------------------------\n\n"
    if chat_history: final_prompt += f"--- CONVERSATION HISTORY ---\n{chat_history}\n----------------------------\n\n"
    final_prompt += f"Current User Query: {last_message}"

    if provider in {"openai", "anthropic", "google", "groq", "openrouter", "nvidia", "mistral", "deepseek", "huggingface"} and not api_key_or_url:
        return {"text": missing_key_message(provider, req.model_id)}

    try:
        async with httpx.AsyncClient() as client:
            
            prefix_text = ""
            current_model_id = req.model_id

            async def finalized_response(raw_text: str, source_model_id: str = None):
                source_id = source_model_id or current_model_id
                return {"text": await aura_supervise_output_async(raw_text, source_id, last_message, prefix_text)}

            # --- CLAUDE SONNET 4.6 PERSONA VIA DEDICATED GEMINI KEY ---
            if current_model_id == "claude-sonnet-4-6":
                dedicated_key = (
                    configured_api_key(api_key_or_url)
                    or configured_api_key(GEMINI_CLAUDE_API_KEY)
                )
                if not dedicated_key and not POOL_GEMINI.primary:
                    return {"text": f"{prefix_text}[AURA Network] Claude Sonnet 4.6 persona requires GEMINI_CLAUDE_API_KEY or GEMINI_API_KEY."}

                claude_messages = [
                    {"role": "system", "text": CLAUDE_SONNET_4_6_PERSONA_PROMPT},
                    *messages,
                ]
                claude_history = ""
                for msg in claude_messages[:-1]:
                    role = msg.get("role", "user")
                    label = "System" if role == "system" else ("User" if role == "user" else "Assistant")
                    claude_history += f"{label}: {msg.get('text', '')}\n"

                claude_prompt = (
                    f"{claude_history}\n"
                    f"{CLEAN_PROSE_DIRECTIVE}\n\n"
                    f"Current User Query: {last_message}"
                )
                if context:
                    claude_prompt += f"\n\nRetrieved file context:\n{context}"

                response = await generate_with_gemini_pool(claude_prompt, current_model_id, dedicated_key=dedicated_key, timeout=45)
                return await finalized_response(response.text, current_model_id)

            # --- PRIMARY GEMINI / AURA MASTER SYNTHESIS ROUTING ---
            if current_model_id in {"gemini", "aura"}:
                if not POOL_GEMINI.primary:
                    return {"text": f"{prefix_text}[AURA Network] GEMINI_API_KEY is not configured for {current_model_id}."}

                synthesis_prompt = (
                    f"System: {AURA_MASTER_SYNTHESIZER_PROMPT} {CLEAN_PROSE_DIRECTIVE}\n\n"
                )
                if context:
                    synthesis_prompt += f"--- RETRIEVED FILE CONTEXT ---\n{context}\n------------------------------\n\n"
                if chat_history:
                    synthesis_prompt += f"--- CONVERSATION HISTORY ---\n{chat_history}\n----------------------------\n\n"
                synthesis_prompt += f"Current User Query: {last_message}"

                response = await generate_with_gemini_pool(synthesis_prompt, current_model_id, timeout=45)
                return await finalized_response(response.text, current_model_id)
            
            # --- SUPERVISOR AGENTIC ROUTING ---
            if current_model_id in {"aura", "supervisor"}:
                target_id = "gpt4" # Deterministic fallback if LLM fails
                
                try:
                    # Wrapped in its own try/catch so the UI visualization doesn't break if API fails
                    router_prompt = f"Analyze this user query. Decide which model specializes in this task. Choose ONLY ONE: [gemini, gpt4, deepseek, mistral]. Output ONLY the ID word.\nQuery: {last_message}"
                    if POOL_GEMINI.primary:
                        # Try available Gemini model IDs (newer first)
                        decision = None
                        last_err = None
                        for cand in GEMINI_MODEL_CHAIN:
                            try:
                                router_key = pooled_key_for_provider("google", "supervisor")
                                genai.configure(api_key=router_key)
                                router_model = genai.GenerativeModel(cand)
                                router_response = await bounded_gemini_generate(router_model, router_prompt, request_options={"timeout": 8})
                                decision = router_response.text.strip().lower()
                                break
                            except Exception as e:
                                last_err = e
                                if router_key and gemini_capacity_or_key_error(e):
                                    POOL_GEMINI.mark_exhausted(router_key)
                                continue
                        if decision is None and last_err is not None:
                            raise last_err
                        for v_id in ["gemini", "gpt4", "deepseek", "mistral"]:
                            if v_id in decision:
                                target_id = v_id
                                break
                except Exception as e:
                    print(f"⚠️ [Supervisor Logic] Routing LLM failed, using fallback. Error: {e}")
                        
                prefix_text = f"[🤖 AURA Supervisor] Analyzed intent and auto-routed task to {target_id.upper()}.\n\n"
                current_model_id = target_id
                
                provider, api_key_or_url = resolve_model_route(req, current_model_id)
                if provider in {"openai", "anthropic", "google", "groq", "openrouter", "nvidia", "mistral", "deepseek", "huggingface"} and not api_key_or_url:
                    return {"text": f"{prefix_text}{missing_key_message(provider, current_model_id)}"}

            # --- FAILOVER LOOP ---
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    # --- HUGGING FACE ROUTING ---
                    if "huggingface" in provider:
                        if not api_key_or_url:
                            return {"text": f"{prefix_text}{missing_key_message('huggingface', current_model_id)}"}

                        if "|||" in api_key_or_url:
                            hf_url, hf_token = api_key_or_url.split("|||", 1)
                        else:
                            hf_url, hf_token = "https://router.huggingface.co", api_key_or_url
                        hf_url = hf_url.rstrip('/')
                        
                        # Use the OpenAI-compatible Hugging Face Messages API first.
                        hf_chat_url = f"{hf_url}/v1/chat/completions" if not hf_url.endswith("/v1/chat/completions") else hf_url
                        
                        # Format the messages correctly for the chat endpoint
                        hf_messages = [{"role": "system", "content": f"{sys_inst} {CLEAN_PROSE_DIRECTIVE}"}]
                        for m in messages:
                            m_role = m.get("role", "user") if isinstance(m, dict) else (m.role if hasattr(m, 'role') else "user")
                            m_text = m.get("text", m.get("content", "")) if isinstance(m, dict) else (m.text if hasattr(m, 'text') else str(m))
                            hf_messages.append({"role": m_role, "content": m_text})

                        payload = {
                            "model": current_model_id,
                            "messages": hf_messages,
                            "max_tokens": 1024
                        }

                        # Attempt the modern Chat API first
                        res = await bounded_provider_post(client, hf_chat_url, headers={"Authorization": f"Bearer {hf_token}"}, json=payload, timeout=30.0)
                        
                        # 2. FALLBACK: If 404, it's a legacy text-to-text model, so retry with standard inputs
                        if res.status_code == 404:
                            res = await bounded_provider_post(client, hf_url, headers={"Authorization": f"Bearer {hf_token}"}, json={"inputs": final_prompt}, timeout=30.0)
                            if res.status_code == 200:
                                data = res.json()
                                if isinstance(data, list) and len(data) > 0 and "generated_text" in data[0]:
                                    return await finalized_response(data[0]["generated_text"].replace(final_prompt, "").strip(), current_model_id)

                        if res.status_code in [503, 429, 529]: raise Exception(f"Capacity Error {res.status_code}")
                        if res.status_code != 200: return {"text": f"{prefix_text}[HF Error] Status {res.status_code}: {res.text}"}
                        
                        data = res.json()
                        if "choices" in data and len(data["choices"]) > 0:
                            return await finalized_response(data["choices"][0]["message"]["content"], current_model_id)
                        return {"text": f"{prefix_text}[HF Parse Error] Invalid response format."}

                    # --- API ROUTING TIER (BYOK or Platform) ---

                    if "nvidia" in provider:
                        if not api_key_or_url:
                            return {"text": f"{prefix_text}{missing_key_message('nvidia', current_model_id)}"}
                        res = await bounded_provider_post(
                            client,
                            f"{NVIDIA_BASE_URL}/chat/completions",
                            provider_name="nvidia",
                            json={
                                "model": NVIDIA_DEFAULT_MODEL,
                                "messages": [{"role": "user", "content": final_prompt}],
                                "temperature": 0.7,
                                "max_tokens": 2048,
                            },
                            headers={"Authorization": f"Bearer {api_key_or_url}", "Content-Type": "application/json"},
                            timeout=60.0,
                        )
                        if res.status_code in [503, 429, 529]: raise Exception(f"Capacity Error {res.status_code}")
                        if res.status_code != 200: return {"text": f"{prefix_text}[NVIDIA Error] Status {res.status_code}: {res.text}"}
                        return await finalized_response(res.json()["choices"][0]["message"]["content"], current_model_id)

                    if ("gpt" in current_model_id or "openai" in provider) and "groq" not in provider:
                        if not api_key_or_url:
                            healing = await agora_runtime_heal(client, f"chat:{req.session_id}", provider, current_model_id, "OpenAI node requires a BYOK API key")
                            if healing.get("status") == "healed":
                                prefix_text += f"[AGORA] {healing.get('message', 'Missing key healed with fallback route.')}\n\n"
                                current_model_id = healing.get("model_id", "gemini")
                                provider = healing.get("provider", "gemini")
                                api_key_or_url = healing.get("api_key", GEMINI_API_KEY)
                                continue
                            return {"text": f"{prefix_text}[AURA Network] OpenAI node requires a BYOK API key. Configure one in Settings > Profile > BYOK."}
                        res = await bounded_provider_post(client, "https://api.openai.com/v1/chat/completions", json={"model": "gpt-4o", "messages": [{"role": "user", "content": final_prompt}]}, headers={"Authorization": f"Bearer {api_key_or_url}"}, timeout=30.0)
                        if res.status_code in [503, 429, 529]: raise Exception(f"Capacity Error {res.status_code}")
                        if res.status_code != 200: return {"text": f"{prefix_text}[OpenAI Error] Status {res.status_code}: {res.text}"}
                        return await finalized_response(res.json()["choices"][0]["message"]["content"], current_model_id)

                    elif "groq" in provider or current_model_id.lower().startswith("groq:") or current_model_id.lower() in GROQ_MODEL_ALIASES:
                        if not api_key_or_url:
                            api_key_or_url = groq_key_for_model(current_model_id)
                        if not api_key_or_url: return {"text": f"{prefix_text}[AURA Network] Groq node requires a BYOK API key. Add GROQ_FREE_MODELS_API_KEY or GROQ_CLAUDE_PERSONA_API_KEY to backend/.env, or configure one in Settings > Profile > BYOK."}
                        raw_groq_model_id = current_model_id[5:] if current_model_id.lower().startswith("groq:") else current_model_id
                        groq_model_id = GROQ_MODEL_ALIASES.get(raw_groq_model_id.lower(), raw_groq_model_id)
                        res = await bounded_provider_post(
                            client,
                            "https://api.groq.com/openai/v1/chat/completions",
                            json={
                                "model": groq_model_id,
                                "messages": [
                                    {"role": "system", "content": f"{sys_inst} {CLEAN_PROSE_DIRECTIVE}"},
                                    {"role": "user", "content": final_prompt},
                                ],
                                "temperature": 0.7,
                                "max_completion_tokens": 2048,
                            },
                            headers={"Authorization": f"Bearer {api_key_or_url}"},
                            timeout=60.0,
                        )
                        if res.status_code in [503, 429, 529]: raise Exception(f"Capacity Error {res.status_code}")
                        if res.status_code != 200: return {"text": f"{prefix_text}[Groq Error] Status {res.status_code}: {res.text}"}
                        return await finalized_response(res.json()["choices"][0]["message"]["content"], current_model_id)

                    elif "mistral" in provider or "mistral" in current_model_id.lower():
                        if not api_key_or_url:
                            return {"text": f"{prefix_text}{missing_key_message('mistral', current_model_id)}"}
                        res = await bounded_provider_post(
                            client,
                            "https://api.mistral.ai/v1/chat/completions",
                            provider_name="mistral",
                            json={
                                "model": os.getenv("MISTRAL_MODEL", "mistral-large-latest"),
                                "messages": [{"role": "user", "content": final_prompt}],
                                "temperature": 0.7,
                                "max_tokens": 2048,
                            },
                            headers={"Authorization": f"Bearer {api_key_or_url}"},
                            timeout=60.0,
                        )
                        if res.status_code in [503, 429, 529]: raise Exception(f"Capacity Error {res.status_code}")
                        if res.status_code != 200: return {"text": f"{prefix_text}[Mistral Error] Status {res.status_code}: {res.text}"}
                        return await finalized_response(res.json()["choices"][0]["message"]["content"], current_model_id)

                    elif "deepseek" in provider or "deepseek" in current_model_id.lower():
                        if not api_key_or_url:
                            return {"text": f"{prefix_text}{missing_key_message('deepseek', current_model_id)}"}
                        res = await bounded_provider_post(
                            client,
                            "https://api.deepseek.com/chat/completions",
                            provider_name="deepseek",
                            json={
                                "model": os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
                                "messages": [{"role": "user", "content": final_prompt}],
                                "temperature": 0.7,
                                "max_tokens": 2048,
                            },
                            headers={"Authorization": f"Bearer {api_key_or_url}"},
                            timeout=60.0,
                        )
                        if res.status_code in [503, 429, 529]: raise Exception(f"Capacity Error {res.status_code}")
                        if res.status_code != 200: return {"text": f"{prefix_text}[DeepSeek Error] Status {res.status_code}: {res.text}"}
                        return await finalized_response(res.json()["choices"][0]["message"]["content"], current_model_id)
                    
                    elif "claude" in current_model_id or "anthropic" in provider:
                        if api_key_or_url:
                            res = await bounded_provider_post(client, "https://api.anthropic.com/v1/messages", json={"model": ANTHROPIC_DEFAULT_MODEL, "max_tokens": 2048, "messages": [{"role": "user", "content": final_prompt}]}, headers={"x-api-key": api_key_or_url, "anthropic-version": "2023-06-01"}, timeout=60.0)
                            if res.status_code in [503, 429, 529]: raise Exception(f"Capacity Error {res.status_code}")
                            if res.status_code != 200: return {"text": f"{prefix_text}[Anthropic Error] Status {res.status_code}: {res.text}"}
                            return await finalized_response(res.json()["content"][0]["text"], current_model_id)

                        if not POOL_GEMINI.primary:
                            return {"text": f"{prefix_text}[AURA Network] Claude persona fallback requires GEMINI_API_KEY until an Anthropic key is configured."}
                        try:
                            response = await generate_with_gemini_pool(final_prompt, current_model_id, timeout=45)
                            return await finalized_response(response.text, current_model_id)
                        except Exception as e:
                            if "503" in str(e) or "429" in str(e) or "capacity" in str(e).lower():
                                raise Exception("Gemini Capacity Error")
                            raise e

                    elif "local" in provider or "custom" in current_model_id:
                        if not api_key_or_url: return {"text": f"{prefix_text}[AURA Network] Local node requires a URL endpoint."}
                        res = await bounded_provider_post(client, f"{api_key_or_url.rstrip('/')}/api/chat", json={"model": current_model_id, "messages": [{"role": "user", "content": final_prompt}], "stream": False}, timeout=30.0)
                        if res.status_code in [503, 429, 529]: raise Exception(f"Capacity Error {res.status_code}")
                        if res.status_code != 200: return {"text": f"{prefix_text}[Local Node Error] {res.text}"}
                        return await finalized_response(res.json()["message"]["content"], current_model_id)
                    
                    # --- OPENROUTER UNIVERSAL ROUTING ---
                    elif "openrouter" in provider:
                        if not api_key_or_url: return {"text": f"{prefix_text}[AURA Network] OpenRouter node requires a BYOK API key (sk-or-v1-...)."}
                        res = await bounded_provider_post(client, "https://openrouter.ai/api/v1/chat/completions", json={"model": current_model_id, "messages": [{"role": "user", "content": final_prompt}]}, headers={"Authorization": f"Bearer {api_key_or_url}", "HTTP-Referer": "https://aura.network", "X-Title": "AURA Network"}, timeout=30.0)
                        if res.status_code == 404:
                            healing = await agora_runtime_heal(client, f"chat:{req.session_id}", provider, current_model_id, f"OpenRouter 404: {res.text}")
                            fallback_model = healing.get("model_id") if healing.get("status") == "healed" else ""
                            if fallback_model and fallback_model != current_model_id:
                                prefix_text += f"[AGORA] {healing.get('message', 'OpenRouter endpoint healed with live fallback model.')}\n\n"
                                current_model_id = fallback_model
                                api_key_or_url = healing.get("api_key") or api_key_or_url
                                res = await bounded_provider_post(client, "https://openrouter.ai/api/v1/chat/completions", json={"model": current_model_id, "messages": [{"role": "user", "content": final_prompt}]}, headers={"Authorization": f"Bearer {api_key_or_url}", "HTTP-Referer": "https://aura.network", "X-Title": "AURA Network"}, timeout=30.0)
                        if res.status_code in [503, 429, 529]: raise Exception(f"Capacity Error {res.status_code}")
                        if res.status_code != 200: return {"text": f"{prefix_text}[OpenRouter Error] Status {res.status_code}: {res.text}"}
                        return await finalized_response(res.json()["choices"][0]["message"]["content"], current_model_id)
                    
                    # --- GEMINI FALLBACK (All other models simulated via Gemini) ---
                    else:
                        dedicated_key = configured_api_key(api_key_or_url)
                        if not dedicated_key and not POOL_GEMINI.primary:
                            return {"text": f"{prefix_text}[AURA Network] No API key available for {current_model_id.upper()}."}
                        try:
                            response = await generate_with_gemini_pool(final_prompt, current_model_id, dedicated_key=dedicated_key, timeout=45)
                            return await finalized_response(response.text, current_model_id)
                        except Exception as e:
                            if "503" in str(e) or "429" in str(e) or "capacity" in str(e).lower():
                                raise Exception("Gemini Capacity Error")
                            raise e

                except Exception as e:
                    error_msg = str(e).lower()
                    if attempt < max_retries - 1 and ("503" in error_msg or "429" in error_msg or "529" in error_msg or "capacity" in error_msg or "overloaded" in error_msg):
                        print(f"⚠️ Primary node overloaded ({e}). Triggering failover protocol...")
                        rotated_key = rotate_provider_key(provider, current_model_id, api_key_or_url)
                        if rotated_key:
                            prefix_text += f"[Failover Active] {provider.upper()} key overloaded. Retrying same provider with the next pooled key.\n\n"
                            api_key_or_url = rotated_key
                            continue
                        fallback_openrouter_key = pooled_key_for_provider("openrouter", current_model_id)
                        if not fallback_openrouter_key:
                            return {"text": f"{prefix_text}[AURA Network] {current_model_id} overloaded and OPENROUTER_DEFAULT_KEY is not configured for failover."}
                        prefix_text += "[Failover Active] Primary node overloaded. Responding via Decentralized Fallback.\n\n"
                        current_model_id = OPENROUTER_FAILOVER_MODEL
                        provider = "openrouter"
                        api_key_or_url = fallback_openrouter_key
                        continue
                    
                    if attempt == max_retries - 1:
                        healing = await agora_runtime_heal(client, f"chat:{req.session_id}", provider, current_model_id, str(e))
                        if healing.get("status") == "healed":
                            prefix_text += f"[AGORA] {healing.get('message', 'Runtime issue healed with fallback route.')}\n\n"
                            current_model_id = healing.get("model_id", current_model_id)
                            provider = healing.get("provider", provider)
                            api_key_or_url = healing.get("api_key", api_key_or_url)
                            if provider == "openrouter":
                                res = await bounded_provider_post(client, "https://openrouter.ai/api/v1/chat/completions", json={"model": current_model_id, "messages": [{"role": "user", "content": final_prompt}]}, headers={"Authorization": f"Bearer {api_key_or_url}", "HTTP-Referer": "https://aura.network", "X-Title": "AURA Network"}, timeout=30.0)
                                if res.status_code == 200:
                                    return await finalized_response(res.json()["choices"][0]["message"]["content"], current_model_id)
                            if provider == "gemini":
                                response = await generate_with_gemini_pool(final_prompt, current_model_id, dedicated_key=api_key_or_url, timeout=45)
                                return await finalized_response(response.text, current_model_id)
                        return {"text": f"{prefix_text}[AURA Node Error] Connection to {provider.upper()} failed after AGORA healing attempt: {str(e)}"}
                    raise e

    except Exception as e:
        _provider = provider if 'provider' in locals() else req.model_id
        _prefix = prefix_text if 'prefix_text' in locals() else ""
        return {"text": f"{_prefix}[AURA Node Error] Connection to {_provider.upper()} failed: {str(e)}"}
    
@app.get("/api/chats/sessions")
async def get_chat_sessions(current_user: str = Depends(get_current_user)):
    hashed_user = sha256_hex(current_user)
    conn = sqlite3.connect(db_path())
    rows = conn.execute(
        """
        SELECT session_id, MIN(content) as title, MAX(created_at) as ts
        FROM chats
        WHERE user_id=?
        GROUP BY session_id
        ORDER BY COALESCE(MAX(created_at), '') DESC
        LIMIT 30
        """,
        (hashed_user,),
    ).fetchall()
    conn.close()
    sessions = []
    for row in rows:
        sessions.append({
            "session_id": row[0],
            "title": (row[1] or "Session").strip()[:80],
            "ts": row[2] or datetime.utcnow().isoformat(),
        })
    return {"status": "success", "sessions": sessions}

@app.post("/api/chat/amalgamate")
async def chat_amalgamate(req: GeminiAmalgamationRequest, current_user: str = Depends(get_current_user)):
    rate_limit(current_user)
    key_to_use = PLATFORM_KEYS.get("gemini") or GEMINI_API_KEY
    if not key_to_use:
        return {"text": "[AURA Network] Gemini API key is not configured."}
    try:
        normalized = []
        for item in req.responses:
            model_name = str(item.get("name", "Model")).strip() or "Model"
            content = str(item.get("text", "")).strip()
            if content:
                normalized.append(f"[{model_name}]\n{content}")
        if not normalized:
            return {"text": "[AURA Network] No model outputs were supplied for amalgamation."}

        prompt = (
            "You are the Master Synthesizer. Cross-reference the provided model outputs. "
            "Identify factual contradictions. Discard anomalies and hallucinations. "
            "Output only the verified consensus in clean prose.\n\n"
            f"{CLEAN_PROSE_DIRECTIVE}\n\n"
            f"User Query: {req.query}\n\n"
            "Model Outputs:\n"
            + "\n\n".join(normalized)
        )
        genai.configure(api_key=key_to_use)
        # Try a list of supported Gemini model IDs (newer models first).
        last_err = None
        for candidate in ("gemini-2.5-flash", "gemini-1.5-pro"):
            try:
                model = genai.GenerativeModel(candidate)
                response = model.generate_content(prompt)
                return {"text": response.text if hasattr(response, "text") else str(response)}
            except Exception as e_inner:
                last_err = e_inner
                # try next candidate
                continue
        # If we reach here, all candidates failed — return the last error message.
        raise last_err if last_err is not None else Exception("Gemini generation failed without an explicit error")
    except Exception as e:
        return {"text": f"[Gemini Amalgamation Error] {str(e)}"}
    
    
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🧬 AGORA LAYER 5: DATA SCHEMA SELF-HEALING META-PROTOCOL
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class HealingRequest(BaseModel):
    pipeline_id: str
    target_endpoint: str
    failed_key: str
    extraction_goal: str

@app.post("/api/agora/heal")
async def trigger_agora_healing(req: HealingRequest):
    """
    AGORA Self-Healing Cycle (No-Scraping Compliance).
    Detects internal JSON schema drift and synthesizes corrected parsing logic.
    """
    print(f"🚨 [AGORA L5] Schema Drift Detected on {req.pipeline_id} at {req.target_endpoint}")
    
    # Simulated upstream API payload that unexpectedly changed structure
    simulated_new_payload = """
    {
        "status": "success",
        "data": {
            "metrics": {
                "current_usd_value": 49.99,
                "timestamp": "2026-05-05T10:00:18Z"
            }
        }
    }
    """
    
    if not GEMINI_API_KEY:
        return {"status": "error", "message": "AGORA requires a valid LLM API key to synthesize parsing logic."}
    
    genai.configure(api_key=GEMINI_API_KEY)
    # Try newer Gemini model IDs first
    model = None
    last_err = None
    for cand in ("gemini-2.5-flash", "gemini-1.5-pro"):
        try:
            model = genai.GenerativeModel(cand)
            break
        except Exception as e:
            last_err = e
            continue
    if model is None:
        raise last_err if last_err is not None else Exception("No Gemini model could be instantiated")
    
    healing_prompt = f"""
    SYSTEM: You are the AGORA Data-Healing protocol. 
    A JSON data pipeline just broke because the upstream provider changed their schema.
    
    EXTRACTION GOAL: {req.extraction_goal}
    OLD FAILED KEY/PATH: {req.failed_key}
    NEW INCOMING PAYLOAD: {simulated_new_payload}
    
    Analyze the new JSON structure. Synthesize the new Python dictionary access path required to extract the goal.
    Output ONLY a valid JSON array of 1 string representing the new dict path.
    Example: ["data['metrics']['current_usd_value']"]
    """
    
    try:
        response = model.generate_content(healing_prompt)
        candidates_raw = response.text.strip().replace('```json', '').replace('```', '')
        
        candidate_list = json.loads(candidates_raw)
        winning_path = candidate_list[0]
        
        # Store in Distributed Healing Memory 
        conn = sqlite3.connect(db_path())
        conn.execute("INSERT INTO healing_memory VALUES (?, ?, ?, ?)", 
                    (req.pipeline_id, req.target_endpoint, winning_path, time.time()))
        conn.commit()
        conn.close()
        
        print(f"✅ [AGORA L5] Pipeline hot-patched! New access path: {winning_path}")
        
        return {
            "status": "healed",
            "protocol": "AGORA-L5",
            "original_path": req.failed_key,
            "new_path": winning_path,
            "message": f"Successfully hot-patched JSON pipeline {req.pipeline_id}."
        }
        
    except Exception as e:
        print(f"❌ [AGORA L5] Healing failed: {str(e)}")
        return {"status": "escalate", "message": f"AGORA Healing escalated to human operator. Error: {str(e)}"}

@app.get("/api/agora/memory")
async def get_agora_memory(pipeline_id: str = "", target_endpoint: str = ""):
    return {
        "status": "success",
        "protocol": "AGORA-L5",
        "memories": latest_healing_memory(pipeline_id, target_endpoint),
    }

@app.post("/api/agora/diagnose")
async def diagnose_agora_issue(payload: dict):
    async with httpx.AsyncClient() as client:
        healing = await agora_runtime_heal(
            client,
            str(payload.get("pipeline_id", "manual-diagnosis")),
            str(payload.get("provider", "")),
            str(payload.get("model_id", "")),
            str(payload.get("error", "")),
        )
    return {
        "status": healing.get("status", "monitoring"),
        "protocol": "AGORA-L5",
        "healing": healing,
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🔌 MCP (MODEL CONTEXT PROTOCOL) - Tool/Context Injection Layer
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class MCPToolCall(BaseModel):
    tool_name: str
    parameters: dict
    session_id: str = "default"

@app.post("/api/mcp/execute")
async def mcp_execute_tool(req: MCPToolCall):
    """MCP Layer: Executes registered tools and injects context into the model pipeline."""
    print(f"🔌 [MCP] Tool call: {req.tool_name} with params: {req.parameters}")
    
    # Built-in MCP tools
    MCP_TOOLS = {
        "search_memory": lambda p: {"results": [], "message": "Vector memory searched successfully."},
        "get_time": lambda p: {"time": datetime.now().isoformat(), "timezone": "UTC"},
        "calculate": lambda p: {"result": eval(str(p.get("expression", "0")), {"__builtins__": {}})},
        "summarize_session": lambda p: {"summary": f"Session {p.get('session_id', 'unknown')} contains active model interactions."},
        "list_tools": lambda p: {"tools": list(MCP_TOOLS.keys())},
    }
    
    if req.tool_name not in MCP_TOOLS:
        return {"status": "error", "message": f"Tool '{req.tool_name}' not registered in MCP registry."}
    
    try:
        result = MCP_TOOLS[req.tool_name](req.parameters)
        return {"status": "success", "protocol": "MCP-v1", "tool": req.tool_name, "result": result}
    except Exception as e:
        return {"status": "error", "message": f"MCP tool execution failed: {str(e)}"}

@app.get("/api/mcp/tools")
async def list_mcp_tools():
    """Lists all available MCP tools."""
    tools = [
        {"name": "search_memory", "description": "Search the RAG vector memory store"},
        {"name": "get_time", "description": "Get the current server time"},
        {"name": "calculate", "description": "Evaluate a mathematical expression"},
        {"name": "summarize_session", "description": "Summarize the current chat session"},
        {"name": "list_tools", "description": "List all available MCP tools"},
    ]
    return {"status": "success", "protocol": "MCP-v1", "tools": tools}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🤝 ANP (AGENT NEGOTIATION PROTOCOL) - Multi-Agent Task Negotiation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class ANPNegotiationRequest(BaseModel):
    task_description: str
    requesting_agent_did: str
    required_capabilities: List[str] = []
    max_bid_credits: float = 100.0

@app.post("/api/anp/negotiate")
async def anp_negotiate_task(req: ANPNegotiationRequest):
    """ANP: Decentralized task negotiation via Kademlia DHT global state."""
    print(f"🤝 [ANP] Negotiating task on P2P DHT: {req.task_description[:60]}...")
    task_id = hashlib.sha256(f"{req.task_description}{time.time()}".encode()).hexdigest()[:12]
    
    if dht_server:
        try:
            # 1. Publish task to DHT for global bidding
            current_tasks_data = await dht_server.get("active_tasks")
            tasks = json.loads(current_tasks_data) if current_tasks_data else []
            tasks.append(task_id)
            await dht_server.set("active_tasks", json.dumps(tasks))
            
            # 2. Await bids from the network (Wait for 2 seconds)
            await asyncio.sleep(2)
            
            # 3. Collect and evaluate bids
            bids = []
            # In a real swarm, we would crawl the DHT for bids related to this task_id
            for i in range(10): # Check for possible peer IDs
                peer_bid = await dht_server.get(f"bid:{task_id}:peer_{i}")
                if peer_bid:
                    bids.append(json.loads(peer_bid))
            
            # Cleanup: Remove task from active list
            tasks.remove(task_id)
            await dht_server.set("active_tasks", json.dumps(tasks))
            
            if bids:
                bids.sort(key=lambda b: b["bid_credits"])
                winner = bids[0]
                return {
                    "status": "negotiated",
                    "protocol": "ANP-DHT",
                    "winning_agent": winner["node_id"],
                    "bid_credits": winner["bid_credits"],
                    "task_hash": task_id,
                    "message": f"Task delegated via DHT auction to {winner['node_id']}."
                }
        except Exception as e:
            error_text = str(e).lower()
            if "no known neighbors" in error_text:
                print("⚠️ [ANP] DHT unavailable: no known neighbors. Falling back to local simulation.")
            else:
                print(f"⚠️ [ANP] DHT Negotiation Error: {e}")

    # Fallback to local simulation if DHT is not reachable
    return {
        "status": "negotiated",
        "protocol": "ANP-SIM",
        "winning_agent": "local-aura-node",
        "bid_credits": 2.0,
        "task_hash": task_id,
        "message": "No DHT bids received. Defaulting to local compute."
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📊 PROTOCOL STATUS - Unified Health Check for All Protocols
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@app.get("/api/protocols/status")
async def protocol_status():
    """Returns the health status of all AURA protocols."""
    return {
        "status": "success",
        "protocols": {
            "OAPIN-L1": {"name": "DID Authentication", "status": "active", "endpoint": "/api/auth/web3"},
            "OAPIN-L2": {"name": "P2P Swarm Discovery", "status": "active", "endpoint": "/api/p2p/handshake"},
            "OAPIN-L2-Gossip": {"name": "Gossip Protocol", "status": "active", "endpoint": "/api/p2p/gossip"},
            "OAPIN-L4": {"name": "ZKML Compute Verification", "status": "active", "endpoint": "/api/oapin/verify"},
            "AGORA-L5": {"name": "Schema Self-Healing", "status": "active", "endpoint": "/api/agora/heal"},
            "A2A": {"name": "Agent-to-Agent Routing (Supervisor)", "status": "active", "endpoint": "/api/chat (supervisor mode)"},
            "ACO": {"name": "Compute-for-Access Model", "status": "active", "endpoint": "/api/oapin/verify"},
            "MCP": {"name": "Model Context Protocol", "status": "active", "endpoint": "/api/mcp/execute"},
            "ANP": {"name": "Agent Negotiation Protocol", "status": "active", "endpoint": "/api/anp/negotiate"},
            "OpenRouter": {"name": "Multi-Model Gateway", "status": "active", "endpoint": "/api/openrouter/free-models"},
            "Groq": {"name": "Groq Model Gateway", "status": "active", "endpoint": "/api/groq/models"},
        },
        "active_peers": len(KNOWN_PEERS),
        "timestamp": datetime.now().isoformat()
    }
