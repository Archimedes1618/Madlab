# Madlab Improvements Changelog

## Security Fixes

### Path Traversal Prevention
- `utils/security.ts`: New `sanitizePath()` function validates file paths stay within allowed directories
- `utils/security.ts`: New `validateFilename()` rejects paths with separators
- Applied to `datasets.ts` DELETE, POST `/datasets/clean`, POST `/datasets/select`
- Blocks `../` attacks that could read/delete arbitrary files

### Input Validation
- `utils/security.ts`: `validateHFRepo()` validates HuggingFace repo format (owner/repo pattern)
- Applied before all HuggingFace dataset operations
- Rejects malformed repo names that could be used for injection

### CORS Lockdown
- `server.ts`: Restricted CORS via `ALLOWED_ORIGINS` env var
- Defaults to `http://localhost:5173` instead of allowing all origins

### Request Timeouts
- `utils/fetch.ts`: New `fetchWithTimeout()` wrapper with configurable timeout
- Applied to all LM Studio API calls via centralized config
- Default 30s for general requests, 120s for LLM calls

---

## Type Safety

### Backend Type Definitions
Created `src/types/index.ts` with interfaces for:
- `TrainingConfig` - YAML config structure
- `InstillationPair`, `InstillationsData` - instillation rules
- `ConversionJob` - model conversion params
- `LMStudioResponse` - typed LLM responses
- `WebSocketMessage` - union of all WS message types

### Replaced `any` Types (Backend)
- `server.ts`: `broadcast(data: any)` → `broadcast(data: WebSocketMessage)`
- `datasets.ts`: Added `VariationItem`, `ToolOutput`, `TrainingConfig` interfaces
- `proxy.ts`: `(p: any)` → `(p: InstillationPair)`
- `train.ts`, `models.ts`, `instillations.ts`: All `catch (e: any)` → `catch (e: unknown)` with instanceof checks
- `modelConverter.ts`: Added `StaticReport`, `JudgmentResult`, `EvaluationSample` interfaces

### Frontend Type Definitions
Expanded `src/types.ts` with:
- `LogType`, `LogPayload`, `TrainingMetrics`
- `TrainingConfig`, `TrainingStatus`, `DatasetInfo`
- `Instillation`, `InstillationMatch`
- `ChatMessage`, `ApiError`

### Replaced `any` Types (Frontend)
- `App.tsx`: `monitoringMetrics: any` → `TrainingMetrics`
- `TrainingPanel.tsx`: `status: any` → `TrainingStatus`, `configData: any` → `TrainingConfig | null`
- `TrainingPanel.tsx`: `artifacts: any[]` → `ModelArtifact[]`, `datasets: any[]` → `DatasetInfo[]`
- `MonitoringPanel.tsx`: `metrics: any` → `TrainingMetrics`
- `ChatPanel.tsx`: `catch (e: any)` → proper instanceof check

---

## Error Handling

### Empty Catch Blocks Fixed
- `TrainingPanel.tsx`: All empty catches now log errors
- `datasets.ts:runTool()`: Added proper error parsing from Python output

### Consistent Error Format
All API errors return standardized structure:
```json
{ "error": { "code": "ERROR_CODE", "message": "Human readable message" } }
```
Error codes: `PATH_TRAVERSAL`, `INVALID_INPUT`, `NOT_FOUND`, `INTERNAL_ERROR`

---

## Performance

### Async File I/O
Converted sync to async in:
- `datasets.ts`: All file operations use `fs/promises`
- `instillations.ts`: File reads via async API
- `train.ts`: Config and history file ops

### Instillations Caching
- New `services/instillationsCache.ts` with mtime-based cache invalidation
- `proxy.ts`: Uses `getInstillations()` instead of reading file per-request
- `instillations.ts`: Calls `invalidateCache()` on writes

### Centralized Configuration
- New `config.ts`: All paths, URLs, and timeouts in one place
- `getPythonPath()`: Detects venv across platforms (Windows/Unix)
- Eliminates duplicate constant definitions

### React Performance
- `App.tsx`: Added `memo()` wrapped `TabButton` component
- `App.tsx`: `useCallback` for tab change handler
- `MonitoringPanel.tsx`: Wrapped with `memo()`, extracted `MetricCard` and `LogEntry` components
- `MonitoringPanel.tsx`: Removed duplicate useEffect
- `ChatPanel.tsx`: `useCallback` for handleSend, extracted `MessageBubble` component
- `TrainingPanel.tsx`: `useCallback` for fetch functions

---

## Python/ML Fixes

### train.py - Data Leakage Fix
```python
# BEFORE: Sequential split (biased - always same samples in val)
val_ds = torch.utils.data.Subset(ds, range(n_val))
train_ds = torch.utils.data.Subset(ds, range(n_val, len(ds)))

# AFTER: Random shuffle before split
indices = list(range(len(ds)))
random.shuffle(indices)
val_indices = indices[:n_val]
train_indices = indices[n_val:]
```

### train.py - NaN Handling
Added loss sanity check:
```python
if torch.isnan(loss) or torch.isinf(loss):
    print(json.dumps({"warning": f"NaN/Inf loss detected at step {step}, skipping batch"}))
    model.zero_grad()
    continue
```

### train.py - Reproducibility
Added random seed initialization:
```python
SEED = 42
random.seed(SEED)
torch.manual_seed(SEED)
```

---

## Reliability & Initialization

### Directory Auto-Creation
- `server.ts`: On startup, creates `data/` and `models/` directories if missing
- Prevents runtime crashes when directories don't exist on fresh clone

### Default File Initialization
- `server.ts`: Creates `instillations.json` with default content `{ version: '1.0', pairs: [] }` if missing
- Prevents cache/read errors on fresh installations

### Type Dependencies Cleanup
- `package.json`: Moved `@types/node-fetch`, `@types/js-yaml`, `@types/multer` from dependencies to devDependencies
- Proper separation of runtime vs build-time dependencies

### Type Cast Fixes
- `utils/fetch.ts`: `controller.signal as any` → `controller.signal as AbortSignal`
- Proper typing for AbortController signal

---

## Error Recovery (Frontend)

### Error Boundary
- New `components/ErrorBoundary.tsx` - React class component catching render errors
- Wraps entire app in `main.tsx`
- Displays user-friendly error message with reload button
- Logs full error + component stack to console for debugging

---

## UX Improvements

### Keyboard Support
- `ChatPanel.tsx`: Enter key sends message (existing, preserved)

---

## Files Created

### Backend
- `src/types/index.ts` - TypeScript interfaces
- `src/utils/fetch.ts` - Fetch with timeout
- `src/utils/security.ts` - Path validation, input sanitization
- `src/config.ts` - Centralized configuration
- `src/services/instillationsCache.ts` - Cached file reads

### Frontend
- `src/components/ErrorBoundary.tsx` - React error boundary component

## Files Modified

### Backend
- `package.json` - Moved @types/* to devDependencies
- `src/server.ts` - CORS config, typed broadcast, health endpoint, directory init
- `src/routes/datasets.ts` - Security validation, async I/O, types
- `src/routes/proxy.ts` - Cache usage, types
- `src/routes/train.ts` - Async I/O, centralized config
- `src/routes/models.ts` - Timeout, limit validation
- `src/routes/instillations.ts` - Cache invalidation, typo fix
- `src/services/modelConverter.ts` - Types, centralized config
- `src/services/processManager.ts` - Types, centralized config
- `src/services/fileMonitor.ts` - Centralized config
- `src/services/datasetBuilder.ts` - Cache usage
- `src/utils/fetch.ts` - Fixed AbortSignal type cast

### Frontend
- `src/types.ts` - Expanded type definitions, aligned with backend
- `src/main.tsx` - ErrorBoundary wrapper
- `src/App.tsx` - Types, memo, useCallback
- `src/components/MonitoringPanel.tsx` - Types, memo
- `src/components/ChatPanel.tsx` - Types, useCallback
- `src/components/TrainingPanel.tsx` - Types, useCallback

### Python
- `trainer/train.py` - Data leakage fix, NaN handling, seeding
