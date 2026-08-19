---
risks:
  - id: r1
    text: The legacy system has no test environment
    likelihood: high
    impact: high
    mitigation: Prove a round-trip against staging first
assumptions:
  - id: a1
    text: A phased cutover is acceptable
    validated: true
  - id: a2
    text: One super per building is stable
    validated: false
---
