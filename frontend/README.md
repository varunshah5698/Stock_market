# StockPulse AI — frontend

React 19 + TypeScript + Vite SPA. See the root [README](../README.md) for setup, architecture and limitations.

```bash
npm ci
npm run dev      # http://localhost:5173, proxies /api to :8000
npm test         # Vitest
npm run build    # production bundle in dist/
npm run lint     # oxlint (warnings only)
```

Manual browser verification scripts live in `e2e/` and require a running API on port 8010.
