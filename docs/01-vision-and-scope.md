# Vision and scope

## The opportunity

Professional kitchens increasingly delegate purchasing to software agents. Aimo needs a structured interface through which external agents can find suitable products, check fixed prices and availability, and place orders while respecting customer authority. The challenge is to make that interface understandable, auditable and safe without exposing production systems or building the future marketplace.

## Concept

Aimo Trust Gateway is an Aimo-operated interface between a customer's external purchasing agent and simulated webshop/backend services. It represents both sides' interests explicitly:

- **Customer interests:** requirements, budget, delivery date, product preferences, dietary constraints, spending authority and approval rules.
- **Aimo responsibilities:** provide available information with provenance, enforce orderability and fixed prices, protect backend services, and make commitments traceable.

The customer's external agent is distinct from the customer-interest component inside the gateway. The latter evaluates customer rules, produces explanations and helps surface exceptions. It is not authorized to approve on the customer's behalf.

## Challenge alignment

Core: structured product, price and availability lookup; an inquiry-to-order flow at fixed prices; and permissions with human approval. Add a clear decision record and comparison of alternatives as differentiators. Delivery reliability, sustainability labels and substitution can enrich the demo where data supports them.

The catalog represents Aimo's own assortment. Compare available products or offers, not an imagined multi-supplier marketplace or negotiated supplier quotes. The portal states that price and availability are mock APIs; whether an order API exists remains to be confirmed. Use a mock order ledger if it does not.

## Product principles

1. **Customer control:** rules are customer-managed; the customer's agent chooses among presented options.
2. **Separation of duties:** agents interpret and recommend; deterministic services enforce rules and commit.
3. **Evidence, not claims:** show the source, time and limitations of data; unknown is not a pass.
4. **Narrow authority:** approval applies to the exact order and is not a general purchase authorization.
5. **Open interface:** document schemas and behavior so different agent implementations can interoperate. OpenAPI/JSON are a practical baseline; MCP can be an adapter, not a prerequisite.
6. **Synthetic only:** no production systems or real purchasing.

## Non-goals

A replacement webshop, a new marketplace, autonomous negotiation, real payments, production deployment, an authoritative allergen-safety system or a full logistics platform. Cryptographic credentials and carbon optimization are optional stretch work, not dependencies for the core demo.
