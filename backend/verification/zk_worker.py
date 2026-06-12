from __future__ import annotations

from typing import Any, Dict, List

from app.services.zk_verifier import Proof, VerificationKey, verify_groth16_proof as _verify_groth16_proof


async def verify_groth16_proof(
    proof: Dict[str, Any],
    public_inputs: List[str],
    verification_key: Dict[str, Any],
) -> bool:
    vk = VerificationKey.model_validate(verification_key)
    parsed_proof = Proof.model_validate(proof)
    return _verify_groth16_proof(vk, parsed_proof, public_inputs)

