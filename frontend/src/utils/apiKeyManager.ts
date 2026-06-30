/*
Known API key save failure modes handled here:
- localStorage blocked by browser privacy settings: falls back to sessionStorage, then memory.
- localStorage quota exceeded: reports a quota-specific recovery message.
- sessionStorage blocked or full: falls back to memory and reports that it clears on refresh.
- Write assumed successful: every save reads the value back and verifies the exact payload.
- Missing try/catch around storage: every storage access is guarded and returns a typed result.
- UI updates before save confirmation: callers await saveApiKeyRecord before updating success state.
- Clipboard unavailable or denied: copyApiKey returns an actionable error without exposing the key.
- Invalid or truncated keys: validateApiKey checks provider prefixes and reasonable length.
*/

export type ApiKeyProvider = "openai" | "anthropic" | "google" | "mistral" | "deepseek" | "groq" | "openrouter";
export type ApiKeyStorageMethod = "localStorage" | "sessionStorage" | "memory";
export type ApiKeyStatusKind = "success" | "error" | "warning" | "info";

export interface ApiKeyRecord {
  provider: ApiKeyProvider | string;
  modelId: string;
  displayName: string;
  apiKey: string;
  savedAt: string;
}

export interface ApiKeyStorageResult {
  ok: boolean;
  method: ApiKeyStorageMethod;
  record?: ApiKeyRecord;
  message: string;
  error?: unknown;
}

const STORAGE_KEY_PREFIX = "aura_api_key:";
const memoryStore = new Map<string, string>();

/**
 * Returns a deterministic storage key for a provider and model.
 */
export function apiKeyStorageKey(provider: string, modelId: string): string {
  return `${STORAGE_KEY_PREFIX}${provider}:${modelId}`;
}

/**
 * Returns the user-facing label for the selected storage method.
 */
export function storageMethodMessage(method: ApiKeyStorageMethod): string {
  if (method === "localStorage") return "Saved to browser storage (persists across sessions)";
  if (method === "sessionStorage") return "Saved to session storage (clears when you close the tab)";
  return "Saved in memory only (clears on page refresh)";
}

/**
 * Identifies browser storage quota errors across browsers.
 */
export function isQuotaExceededError(error: unknown): boolean {
  const err = error as DOMException | undefined;
  return !!err && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED" || err.code === 22 || err.code === 1014);
}

/**
 * Identifies blocked-storage errors across browsers.
 */
export function isSecurityError(error: unknown): boolean {
  return (error as DOMException | undefined)?.name === "SecurityError";
}

/**
 * Converts a storage exception into a helpful recovery message.
 */
export function storageErrorMessage(error: unknown): string {
  if (isQuotaExceededError(error)) return "Browser storage is full. Clear site data and try again.";
  if (isSecurityError(error)) return "Storage is blocked by your browser. Check privacy settings or try a different browser.";
  return "The browser could not save the key. Try refreshing the page or using a different browser.";
}

/**
 * Validates an API key for the selected provider without logging or exposing it.
 */
export function validateApiKey(provider: string, rawKey: string): { ok: boolean; message: string } {
  const key = rawKey.trim();
  if (!key) return { ok: false, message: "API key is required." };
  if (key.length < 16) return { ok: false, message: "That key looks too short. Paste the full API key and try again." };

  const rules: Record<string, { prefix: RegExp; label: string }> = {
    anthropic: { prefix: /^sk-ant-/i, label: "sk-ant-" },
    openrouter: { prefix: /^sk-or-/i, label: "sk-or-" },
    groq: { prefix: /^gsk_/i, label: "gsk_" },
    google: { prefix: /^AIza/i, label: "AIza" },
    openai: { prefix: /^sk-/i, label: "sk-" },
    mistral: { prefix: /^[A-Za-z0-9_-]{24,}$/i, label: "a valid Mistral key" },
    deepseek: { prefix: /^sk-/i, label: "sk-" },
  };
  const rule = rules[provider];
  if (rule && !rule.prefix.test(key)) {
    return { ok: false, message: `That doesn't look like a valid API key. It should start with ${rule.label}` };
  }
  return { ok: true, message: "" };
}

/**
 * Masks an API key for UI display.
 */
export function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (key.length <= 12) return `${key.slice(0, 4)}••••`;
  return `${key.slice(0, 7)}••••••••••••${key.slice(-4)}`;
}

/**
 * Attempts to read a value from a specific storage method.
 */
function readRaw(method: ApiKeyStorageMethod, key: string): string | null {
  if (method === "memory") return memoryStore.get(key) ?? null;
  return window[method].getItem(key);
}

/**
 * Attempts to write and verify a value with a specific storage method.
 */
function writeAndVerifyRaw(method: ApiKeyStorageMethod, key: string, value: string): void {
  if (method === "memory") {
    memoryStore.set(key, value);
  } else {
    window[method].setItem(key, value);
  }
  if (readRaw(method, key) !== value) {
    throw new Error("Storage write verification failed. The saved value did not match.");
  }
}

/**
 * Removes a value from a specific storage method.
 */
function removeRaw(method: ApiKeyStorageMethod, key: string): void {
  if (method === "memory") memoryStore.delete(key);
  else window[method].removeItem(key);
}

/**
 * Saves an API key record with localStorage -> sessionStorage -> memory fallback and write verification.
 *
 * Security note: localStorage and sessionStorage are not encrypted. Users should only save keys on trusted devices.
 */
export async function saveApiKeyRecord(storageKey: string, record: ApiKeyRecord): Promise<ApiKeyStorageResult> {
  const payload = JSON.stringify(record);
  const attempts: ApiKeyStorageMethod[] = ["localStorage", "sessionStorage", "memory"];
  let lastError: unknown = null;

  for (const method of attempts) {
    try {
      writeAndVerifyRaw(method, storageKey, payload);
      return { ok: true, method, record, message: storageMethodMessage(method) };
    } catch (error) {
      lastError = error;
      console.warn(`API key storage failed using ${method}.`, error);
    }
  }

  return {
    ok: false,
    method: "memory",
    message: storageErrorMessage(lastError),
    error: lastError,
  };
}

/**
 * Loads a saved API key record from localStorage, sessionStorage, or memory.
 */
export function loadApiKeyRecord(storageKey: string): ApiKeyStorageResult {
  const methods: ApiKeyStorageMethod[] = ["localStorage", "sessionStorage", "memory"];
  for (const method of methods) {
    try {
      const value = readRaw(method, storageKey);
      if (!value) continue;
      return { ok: true, method, record: JSON.parse(value) as ApiKeyRecord, message: storageMethodMessage(method) };
    } catch (error) {
      console.warn(`API key load failed using ${method}.`, error);
      return { ok: false, method, message: "The saved key could not be read. Remove it and save a fresh key.", error };
    }
  }
  return { ok: true, method: "memory", message: "No saved key found." };
}

/**
 * Removes a saved API key record from every storage method.
 */
export function removeApiKeyRecord(storageKey: string): ApiKeyStorageResult {
  const methods: ApiKeyStorageMethod[] = ["localStorage", "sessionStorage", "memory"];
  let lastError: unknown = null;
  for (const method of methods) {
    try {
      removeRaw(method, storageKey);
    } catch (error) {
      lastError = error;
      console.warn(`API key removal failed using ${method}.`, error);
    }
  }
  if (lastError) return { ok: false, method: "memory", message: storageErrorMessage(lastError), error: lastError };
  return { ok: true, method: "memory", message: "Key removed." };
}

/**
 * Copies an API key to the clipboard without logging the key value.
 */
export async function copyApiKey(apiKey: string): Promise<{ ok: boolean; message: string; error?: unknown }> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API is unavailable.");
    await navigator.clipboard.writeText(apiKey);
    return { ok: true, message: "Copied!" };
  } catch (error) {
    console.warn("API key copy failed.", error);
    return { ok: false, message: "Clipboard access was blocked. Select and copy the key manually.", error };
  }
}

/**
 * Builds the HTML structure used by the standalone API key manager.
 */
export function apiKeyManagerHTML(): string {
  return `
    <section class="api-key-manager" aria-label="API key manager">
      <div class="api-key-status" role="status" aria-live="polite"></div>
      <label class="api-key-label">API Key</label>
      <div class="api-key-input-row">
        <input class="api-key-input" type="password" autocomplete="off" placeholder="sk-ant-..." />
        <button class="api-key-toggle" type="button" aria-label="Show API key">Show</button>
      </div>
      <div class="api-key-error" aria-live="polite"></div>
      <div class="api-key-saved"></div>
      <div class="api-key-actions">
        <button class="api-key-save" type="button">Save key</button>
        <button class="api-key-copy" type="button">Copy</button>
        <button class="api-key-remove" type="button">Remove key</button>
      </div>
    </section>`;
}

/**
 * Returns CSS for the standalone API key manager.
 */
export function apiKeyManagerCSS(): string {
  return `
    .api-key-manager{display:grid;gap:12px;max-width:520px}
    .api-key-input-row{display:flex;gap:8px}
    .api-key-input{flex:1;min-width:0;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px}
    .api-key-actions{display:flex;gap:8px;flex-wrap:wrap}
    .api-key-actions button,.api-key-toggle{padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;cursor:pointer}
    .api-key-status.success{color:#047857}.api-key-status.error,.api-key-error{color:#dc2626}.api-key-status.warning{color:#b45309}
    .api-key-saved{font-size:13px;color:#374151}
    @media(max-width:520px){.api-key-input-row,.api-key-actions{flex-direction:column}}
  `;
}

/**
 * Initializes a standalone API key manager in any container element.
 */
export function initAPIKeyManager(containerElement: HTMLElement): void {
  const storageKey = apiKeyStorageKey("anthropic", "default");
  containerElement.innerHTML = apiKeyManagerHTML();
  const input = containerElement.querySelector<HTMLInputElement>(".api-key-input")!;
  const status = containerElement.querySelector<HTMLDivElement>(".api-key-status")!;
  const error = containerElement.querySelector<HTMLDivElement>(".api-key-error")!;
  const saved = containerElement.querySelector<HTMLDivElement>(".api-key-saved")!;
  const saveButton = containerElement.querySelector<HTMLButtonElement>(".api-key-save")!;
  const copyButton = containerElement.querySelector<HTMLButtonElement>(".api-key-copy")!;
  const removeButton = containerElement.querySelector<HTMLButtonElement>(".api-key-remove")!;
  const toggleButton = containerElement.querySelector<HTMLButtonElement>(".api-key-toggle")!;

  let savedRecord = loadApiKeyRecord(storageKey).record;

  /** Renders current standalone state. */
  const render = (): void => {
    saved.innerHTML = savedRecord ? `<strong>Key active</strong> ${maskApiKey(savedRecord.apiKey)} · saved ${new Date(savedRecord.savedAt).toLocaleString()}` : "";
    saveButton.textContent = savedRecord ? "Update key" : "Save key";
    copyButton.disabled = !savedRecord;
    removeButton.disabled = !savedRecord;
  };

  /** Shows an in-page status message. */
  const showStatus = (kind: ApiKeyStatusKind, message: string): void => {
    status.className = `api-key-status ${kind}`;
    status.textContent = message;
    window.setTimeout(() => {
      status.textContent = "";
      status.className = "api-key-status";
    }, 5000);
  };

  toggleButton.addEventListener("click", () => {
    input.type = input.type === "password" ? "text" : "password";
    toggleButton.textContent = input.type === "password" ? "Show" : "Hide";
    toggleButton.setAttribute("aria-label", input.type === "password" ? "Show API key" : "Hide API key");
  });
  saveButton.addEventListener("click", async () => {
    const validation = validateApiKey("anthropic", input.value);
    error.textContent = validation.message;
    if (!validation.ok) return;
    saveButton.disabled = true;
    const result = await saveApiKeyRecord(storageKey, {
      provider: "anthropic",
      modelId: "default",
      displayName: "Anthropic key",
      apiKey: input.value.trim(),
      savedAt: new Date().toISOString(),
    });
    saveButton.disabled = false;
    if (!result.ok || !result.record) {
      showStatus("error", result.message);
      return;
    }
    savedRecord = result.record;
    input.value = "";
    showStatus("success", result.message);
    render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveButton.click();
  });
  copyButton.addEventListener("click", async () => {
    if (!savedRecord) return;
    showStatus("success", (await copyApiKey(savedRecord.apiKey)).message);
  });
  removeButton.addEventListener("click", () => {
    if (removeButton.dataset.confirm !== "true") {
      removeButton.dataset.confirm = "true";
      removeButton.textContent = "Are you sure?";
      return;
    }
    removeApiKeyRecord(storageKey);
    savedRecord = undefined;
    removeButton.dataset.confirm = "false";
    removeButton.textContent = "Remove key";
    showStatus("success", "Key removed");
    render();
  });
  render();
}
