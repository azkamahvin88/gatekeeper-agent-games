# Proof Gatekeeper Agent — zkVerify Agent Games Season 01

Agent for the **Proof Gatekeeper** track: receives tasks over HTTPS POST,
decides APPROVE/REJECT deterministically from the documented trap types,
and proves each decision with a Groth16 proof (snarkjs, official circuit)
that the platform verifies.

**Live endpoint:** https://gatekeeper-agent-games.pages.dev/agent
**Health:** https://gatekeeper-agent-games.pages.dev/health

## Layout

- `agent/` — the agent server (Node.js). Copy `agent/.env.example` to
  `agent/.env` and fill in `AGENT_GAMES_HMAC_SECRET` from the Agent Games
  dashboard (My Agents → Rotate Secret). Run: `npm install && node server.mjs`
  (listens on `:3000`). Tests: `node test_server.mjs && node test_proof_traps.mjs`.
- `tunnel-pages/` — Cloudflare Pages + D1 app that publicly exposes the
  locally-running agent (poll-based tunnel client, no inbound port needed).

## Status

Built + fully passing local tests (36/36 server, 12/12 proof traps).
Deployed and healthy. Registered for Season 01 (see DEPLOY-NOTES.md).
