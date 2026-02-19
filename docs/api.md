# mini_engine HTTP API (Phase 1 contract)

Source of truth: [`docs/openapi.yaml`](./openapi.yaml)

## Endpoints

- `GET /health` — health check
- `GET /metrics` — Prometheus metrics
- `POST /documents` — bulk ingest documents
- `POST /search` — search

## Conventions

- Request/response content type: `application/json` unless stated otherwise.
- Errors use **RFC 7807**: `application/problem+json`.
- Pagination for search is **cursor-based**.

## Error model (RFC 7807)

All non-2xx responses should be:

```json
{
  "type": "https://errors.mini-engine.local/invalid-argument",
  "title": "Invalid argument",
  "status": 400,
  "detail": "query must be non-empty",
  "instance": "/search",
  "code": "INVALID_ARGUMENT",
  "requestId": "01HZY8T9Y4TRN9F4ZYKQ8V6A3B",
  "errors": [
    { "path": "$.query", "message": "must be non-empty" }
  ]
}
```

### Recommended error codes

- `INVALID_ARGUMENT` (400)
- `UNSUPPORTED_MEDIA_TYPE` (415)
- `UNPROCESSABLE_ENTITY` (422)
- `RATE_LIMITED` (429)
- `INTERNAL` (500)

## POST /documents (bulk ingest)

### Request

```json
{
  "documents": [
    { "id": "doc_1", "text": "hello world" },
    { "id": "doc_2", "text": "hello there", "metadata": {"lang": "en"} }
  ],
  "options": { "onDuplicate": "replace" }
}
```

### Response (200 ok)

```json
{
  "ingested": 2,
  "failed": 0,
  "failures": []
}
```

### Response (207 partial)

```json
{
  "ingested": 1,
  "failed": 1,
  "failures": [
    {
      "index": 1,
      "id": "doc_2",
      "code": "INVALID_ARGUMENT",
      "message": "text must be non-empty"
    }
  ]
}
```

## POST /search

### Request (fulltext)

```json
{
  "query": "hello world",
  "topK": 10,
  "mode": "fulltext"
}
```

### Request (prefix/typeahead)

```json
{
  "query": "hel",
  "topK": 5,
  "mode": "prefix"
}
```

### Response

```json
{
  "results": [
    {
      "id": "doc_2",
      "score": 0.82,
      "highlights": [{"field": "text", "snippets": ["...hello there..."]}],
      "metadata": {"category": "greeting"}
    }
  ],
  "page": { "nextCursor": null },
  "tookMs": 3
}
```

### Pagination

Send the returned `page.nextCursor` back:

```json
{
  "query": "shoes",
  "topK": 10,
  "page": { "cursor": "<opaque>" }
}
```
