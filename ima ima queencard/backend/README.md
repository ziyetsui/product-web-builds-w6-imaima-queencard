# Backend

This directory is reserved for a future standalone backend service.

Current backend-like responsibilities are implemented inside the Next.js app:

```text
../frontend/src/app/api/
../frontend/src/services/
../frontend/src/db/
../frontend/src/payment/
../frontend/src/lib/api/
../frontend/src/lib/auth/
```

Create real backend code here only when the project needs a separate service
boundary, such as FastAPI, workers, long-running jobs, or APIs that should not
live inside the Next.js app.
