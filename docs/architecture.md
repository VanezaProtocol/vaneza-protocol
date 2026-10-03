# Architecture

This document describes the intended design. Parameters not yet fixed are marked **open**; none are guessed.

## Components

| Component | Role |
|---|---|
| Funding address | the holder's existing wallet; the only public identity involved |
| Shield vault | on-chain contract holding deposits and verifying proofs |
| Sealed notes | encrypted records of value and owner, readable only by their holder |
| Local prover | code in the holder's browser that produces spending proofs |
| Solver | any party that fills orders and submits settlement |

## Flows

### Deposit
1. Holder sends funds from the funding address to the vault. This step is public: address, asset, amount.
2. The vault records a commitment to a new sealed note.
3. The holder's browser keeps the secrets needed to spend it.

### Trade
1. The holder states an intent in the browser.
2. The prover shows: the note exists, the holder can spend it, value is conserved, and it has not been spent before.
3. A solver fills the order and submits the proof with the settlement.
4. The vault verifies the proof, retires the spent notes and creates the new ones.

### Exit
Withdrawal returns funds to the address the deposit came from, with a proof of ownership. Exit does not depend on any solver.

## Visible and hidden

| Action | Visible on-chain | Hidden |
|---|---|---|
| Deposit | address, asset, amount | note secrets |
| Trade | solver, assets, amounts, proof | which note, whose |
| Exit | address, asset, amount | note secrets |

## Trust boundaries

- **Browser:** holds secrets; compromise of the device compromises the notes.
- **Vault:** correctness of contract and circuits is the central assumption, hence independent review before release.
- **Solvers:** can see order contents they fill, but cannot move funds without a valid proof and cannot learn note ownership from it.
- **Observers:** can correlate timing and amounts. Reused routes and round figures weaken privacy.

## Open items

- Proof system and curve
- Note encryption scheme
- Fee model
- Supported assets at launch
- Admission screening, if any

Each will be published with its rationale before release.
