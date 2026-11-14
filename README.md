# Aimo Trust Gateway

A hackathon concept for safe, agent-to-agent foodservice purchasing. An external purchasing agent sends a structured request; an Aimo-operated gateway validates customer policy, finds and compares eligible products, and commits an order only within delegated authority or after customer approval.

**Status:** concept and design, not an implemented product. Names, APIs, policies and screens in these documents are proposals unless explicitly identified as challenge resources. “Aimo” refers to Valio Aimo; the working repository name is `valio-aimo-challenges`.

## Start here

- [Vision, scope and pitch](docs/01-vision-and-scope.md)
- [Architecture and agent roles](docs/02-architecture.md)
- [Request, matching and ordering protocol](docs/03-protocol.md)
- [Customer guardrails and approval](docs/04-guardrails-and-approval.md)
- [Trust, security and audit](docs/05-trust-security-audit.md)
- [Synthetic data exploration](docs/06-synthetic-data.md) · [visual overview](synthetic-data-overview.svg)
- [Hackathon demo and delivery plan](docs/07-demo-and-plan.md)
- [Open decisions and mentor questions](docs/08-open-questions.md)

## One-sentence pitch

**The agent can recommend; the policy engine authorizes; the order service commits.**

## Challenge resources

The [challenge portal](https://junction26.valioaimo.fi/) provides synthetic product data, historical delivery reliability, product-group carbon estimates and documentation for mock price and availability APIs. It requires the event password. Obtain credentials from the challenge organizers; do not commit credentials or downloaded datasets without checking their sharing terms. Synthetic data is challenge-only and is not suitable for real purchasing or safety decisions.
