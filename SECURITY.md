# AURA 2.0 Security Invariants

INVARIANT_1: No LLM-generated string is run as program text. AGORA accepts only JMESPath and the Makefile security lint scans backend AST calls.

INVARIANT_2: Inter-node communication is modeled as Noise-encrypted and Ed25519-authenticated libp2p traffic, with GossipSub message signature validation.

INVARIANT_3: Client-side sensitive storage uses AES-GCM with 256-bit keys derived by PBKDF2 in `cryptoStorage.ts`.

INVARIANT_4: Protected API requests carry timestamped HMAC-SHA256 signatures verified with constant-time comparison in FastAPI middleware.

INVARIANT_5: ZK proof verification stays memory-resident. The verifier does not write proof, public input, or verification key material to disk.

The HMAC middleware derives the request signing key from the authenticated JWT `sub` claim. Service-to-service deployments can set `AURA_HMAC_SECRET` to use a shared server-managed key instead.

