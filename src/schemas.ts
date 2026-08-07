// GENERATED from openapi.json — do not edit by hand.
//
// Per-route invocation contracts published inside the x402 402 challenge as
// `accepts[].outputSchema`. `input` tells an agent how to build the request
// (method, query/path params, JSON body fields); `output` is the JSON Schema of
// the 200 body it gets back once payment settles.
//
// Deriving these from `openapi.json` keeps the runtime challenge — which the
// x402scan discovery spec treats as authoritative — from ever contradicting the
// published spec. Regenerate whenever a paid route's parameters or response
// schema change.
//
// Keys match the paywall route map in `server.ts` exactly (`"<METHOD> <path>"`,
// with `:param` for path segments).

import type { RouteSchema } from "./payments.js";

export const ROUTE_SCHEMAS: Record<string, RouteSchema> = {
  "GET /check": {
    "input": {
      "type": "http",
      "method": "GET",
      "queryParams": {
        "market": {
          "type": "string",
          "enum": [
            "crypto",
            "flight"
          ],
          "x-required": true
        },
        "ids": {
          "type": "string",
          "description": "crypto only. Comma-separated CoinGecko ids, max 25, e.g. bitcoin,ethereum"
        },
        "vs": {
          "type": "string",
          "default": "usd",
          "description": "crypto only. Quote currency."
        },
        "origin": {
          "type": "string",
          "description": "flight only. IATA airport code."
        },
        "destination": {
          "type": "string",
          "description": "flight only. IATA airport code."
        },
        "departureDate": {
          "type": "string",
          "format": "date",
          "description": "flight only. YYYY-MM-DD."
        },
        "returnDate": {
          "type": "string",
          "format": "date",
          "description": "flight only."
        },
        "adults": {
          "type": "integer",
          "default": 1,
          "description": "flight only."
        },
        "cabin": {
          "type": "string",
          "description": "flight only. ECONOMY | PREMIUM_ECONOMY | BUSINESS | FIRST."
        },
        "cursor": {
          "type": "string",
          "description": "Opaque signed cursor from your previous /check. Scoped to the exact same parameters; a mismatch is reported in delta.cursorStatus rather than failing the call."
        }
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "check": {
          "type": "object",
          "properties": {
            "payload": {
              "type": "object",
              "properties": {
                "checkId": {
                  "type": "string"
                },
                "market": {
                  "type": "string",
                  "enum": [
                    "crypto",
                    "flight"
                  ]
                },
                "watchKey": {
                  "type": "string",
                  "description": "Normalized watch identity. Cursors are scoped to it."
                },
                "source": {
                  "type": "string",
                  "enum": [
                    "coingecko",
                    "amadeus",
                    "fixture"
                  ]
                },
                "live": {
                  "type": "boolean"
                },
                "observedAt": {
                  "type": "string"
                },
                "snapshot": {
                  "type": "object",
                  "properties": {
                    "items": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string"
                          },
                          "label": {
                            "type": "string"
                          },
                          "priceUsd": {
                            "type": "number"
                          },
                          "extra": {
                            "type": "object"
                          }
                        }
                      }
                    },
                    "missing": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    }
                  }
                },
                "delta": {
                  "type": "object",
                  "properties": {
                    "hasCursor": {
                      "type": "boolean"
                    },
                    "cursorStatus": {
                      "type": "string",
                      "enum": [
                        "none",
                        "applied",
                        "malformed",
                        "bad_signature",
                        "wrong_watch",
                        "unsupported_version"
                      ]
                    },
                    "since": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "elapsedSeconds": {
                      "type": [
                        "integer",
                        "null"
                      ]
                    },
                    "changes": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string"
                          },
                          "label": {
                            "type": "string"
                          },
                          "previousUsd": {
                            "type": [
                              "number",
                              "null"
                            ]
                          },
                          "currentUsd": {
                            "type": "number"
                          },
                          "absUsd": {
                            "type": [
                              "number",
                              "null"
                            ]
                          },
                          "pct": {
                            "type": [
                              "number",
                              "null"
                            ]
                          },
                          "direction": {
                            "type": "string",
                            "enum": [
                              "up",
                              "down",
                              "flat",
                              "new"
                            ]
                          }
                        }
                      }
                    },
                    "summary": {
                      "type": [
                        "object",
                        "null"
                      ],
                      "properties": {
                        "up": {
                          "type": "integer"
                        },
                        "down": {
                          "type": "integer"
                        },
                        "flat": {
                          "type": "integer"
                        },
                        "new": {
                          "type": "integer"
                        },
                        "biggestMoverId": {
                          "type": [
                            "string",
                            "null"
                          ]
                        },
                        "biggestMovePct": {
                          "type": [
                            "number",
                            "null"
                          ]
                        }
                      }
                    }
                  }
                },
                "trend": {
                  "type": "object",
                  "properties": {
                    "direction": {
                      "type": "string",
                      "enum": [
                        "up",
                        "down",
                        "flat",
                        "unknown"
                      ]
                    },
                    "basis": {
                      "type": "string",
                      "enum": [
                        "cursor",
                        "provider_24h",
                        "none"
                      ]
                    },
                    "pct": {
                      "type": [
                        "number",
                        "null"
                      ]
                    },
                    "note": {
                      "type": "string"
                    }
                  }
                },
                "cursor": {
                  "type": "string",
                  "description": "Opaque signed cursor. Send it on your next /check to get the delta from this snapshot."
                },
                "notes": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              }
            },
            "signature": {
              "type": "string"
            },
            "algorithm": {
              "type": "string",
              "const": "HMAC-SHA256"
            },
            "canonicalization": {
              "type": "string",
              "const": "sorted-json"
            }
          }
        },
        "payment": {
          "type": [
            "object",
            "null"
          ],
          "description": "Settlement receipt for this call \u2014 same content as X-PAYMENT-RESPONSE."
        }
      }
    }
  },
};
