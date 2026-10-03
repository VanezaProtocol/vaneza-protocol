# Vaneza Whitepaper

## 1. The problem

A public ledger is honest about everything, including things it has no business recording. One swap ties an address to a strategy, a size and a habit. Over time an address becomes a biography. Anyone can read it; some will act on it by copying, front-running or targeting.

Traders on open chains currently choose between full exposure and leaving the venue they want to use.

## 2. The idea

Separate the **wallet** from the **trade history**.

Vaneza lets a holder deposit from an address they already use, trade through a shielded pool, and exit to the same address. In between, ownership lives inside sealed notes. A trade shows what changed hands and that a valid proof backed it. It does not show whose notes were spent.

## 3. Principles

- **Prove, do not disclose.** Spending rights are demonstrated by proof, never by revealing identity.
- **Local first.** Proofs are produced in the holder's own browser.
- **Open settlement.** Anyone may run a solver; no single operator decides who gets filled.
- **Always a way out.** Funds can return to the originating address.
- **Say the limits.** Less exposure is the promise. Invisibility is not.

## 4. What Vaneza is not

- Not a promise of anonymity against a determined observer who correlates timing and amounts.
- Not a statement about launch dates, tokens or returns. Those do not exist in this document.

## 5. Why Robinhood Chain

Vaneza is built for Robinhood Chain (chain id 4663). The network's audience and tooling suit a venue where ordinary traders want practical privacy without leaving familiar wallets.

## 6. Vision

A trading venue where privacy is the default behaviour rather than an advanced setting, where the public record proves the market works without cataloguing the people in it.

See [architecture.md](architecture.md) for mechanics and [roadmap.md](roadmap.md) for sequencing.
