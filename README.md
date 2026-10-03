# vaneza_

**Trade without the trail.** Vaneza is a shielded trading layer being built for Robinhood Chain. Funds enter from the address you already hold, rest as sealed notes, and move only when proof made on your own machine says they may. Solvers anyone can run settle the swap. Public history keeps outcomes, never owners.

Website: [vaneza.dev](https://vaneza.dev)

---

## At a glance

| | |
|---|---|
| Network | Robinhood Chain |
| Chain ID | `4663` |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Model | shielded pool, sealed notes, local proofs, open solvers |
| Exit | back to the address you deposited from |

## How a private trade moves

```
funding address -> shield vault -> sealed notes -> local proof -> solver
```

1. **Deposit.** Move funds into the vault from any address you hold. Sealed notes come back as your balance.
2. **Prove.** Code running in your tab demonstrates spending rights while revealing neither which note nor whose.
3. **Settle.** Solvers race to fill orders. The vault verifies each proof before value is released.
4. **Exit.** Withdrawals arrive back at your starting address.

Privacy here means less exposure, not none. Tokens and sums stay readable on-chain and timing can still hint at things. See [docs/architecture.md](docs/architecture.md) for the exact boundaries.

## Public facts

Each outside fact is a single record with a state. A record stays empty until the team states it.

| Record | State | Value |
|---|---|---|
| Contract | not yet | no address announced |
| X | not yet | no account announced |
| GitHub | not yet | no organisation announced |
| App | not yet | no release announced |
| Website | stated | [vaneza.dev](https://vaneza.dev) |
| Network | stated | Robinhood Chain, id 4663 |

Nothing in this repository promises dates, tokens or returns.

## Documentation

- [Whitepaper](docs/whitepaper.md): the problem, the idea, the vision
- [Architecture](docs/architecture.md): components, flows, trust boundaries
- [Tokenomics](docs/tokenomics.md): what is and is not decided
- [Roadmap](docs/roadmap.md): phases without dates
- [Contributing](.github/CONTRIBUTING.md) and [Security](.github/SECURITY.md)

## Website development

```bash
npm install
npm run build   # bundles the site into dist/
npm run gates   # runs the quality gates
```

## License

MIT. See [LICENSE](LICENSE).
