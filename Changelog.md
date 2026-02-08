# Changelog

## v0.5.0 (2026-01-31)

### UI/UX - Design Overhaul
Complete visual redesign while preserving the original color palette.

**Typography**
- Replaced Inter with **Outfit** (display font) and **JetBrains Mono** (data/metrics)
- Refined font weights and letter-spacing throughout

**Visual Effects**
- Glass morphism panels with backdrop blur
- Subtle noise texture overlay for depth
- Radial gradient background with primary color glow
- Gradient accent lines on headers, cards, and active states
- Premium glow effects on status indicators and buttons

**Components**
- **Header**: Status indicator now a pill with animated pulse, simplified theme toggle (☀/☾)
- **Navigation**: Refined tab styling with gradient underline on active state
- **Buttons**: Gradient primary buttons with glow shadows, smooth hover lift
- **Inputs**: Custom styled checkboxes, range sliders, and select dropdowns
- **Toasts**: Gradient backgrounds with blur backdrop and refined layout

**Chat Panel**
- Chat bubbles with asymmetric border-radius (user vs assistant)
- User messages have gradient background with glow shadow
- Animated "Thinking..." indicator with pulsing dot
- Input area in dark container with glass border
- Clear button moved to header

**Monitoring Panel**
- Loss chart with gradient line, area fill, and glowing current point
- Progress bars with color-coded glow effects at warning/danger thresholds
- System health card with status dot and refined metrics layout
- Log viewer with gradient top border and improved empty state

**Training Panel**
- Progress bar with gradient fill and glow during active training
- Status indicator as premium pill badge with pulse animation
- Stop button with red gradient and shadow

**Command Palette**
- Blurred backdrop overlay
- Gradient top border accent
- Search input in dark container
- Selected item shows brand gradient background
- Refined keyboard hint styling

**Chat Assistant**
- System message now hidden from UI (still sent to API)
- Comprehensive MadLab-specific system prompt:
  - Expert fine-tuning coach persona
  - LoRA/QLoRA/DoRA knowledge
  - Dataset preparation guidance
  - Hyperparameter recommendations by model size
  - Memory optimization tips
  - Troubleshooting assistance

**CSS Foundation**
- New CSS variables for glow colors, glass effects, and transitions
- Custom scrollbar styling (6px, rounded, subtle)
- Animations: pulse-glow, fade-in, shimmer
- Utility classes for common effects (.mono, .gradient-text, .glass-card)

### Desktop app

**Electron Setup**
- Added `electron_setup.py` for automated environment configuration
- Implemented IPC handlers for GPU detection and PyTorch wheel selection
- Added CPU-only fallback mode
- Setup now manages sandboxed venv creation and dependency installation (~5GB)

**Electron App**
- Release of standalone multi-os app for windows, linux and macOS

---

## v0.4.0 (2026-01-30)

### Features
- **Advanced training config UI**: New collapsible "Advanced Settings" section in Training Panel exposing:
  - **Optimizer selection**: AdamW, AdamW 8-bit (VRAM saver), Paged AdamW 8-bit, AdamW Fused (fastest)
  - **LR scheduler**: Linear, Cosine (recommended), Constant
  - **Precision mode**: FP16 (fast), BF16 (modern GPUs), FP32 (full precision)
  - **Packing toggle**: 1.5-3x training speedup by concatenating samples
  - **Gradient checkpointing**: Trade compute for VRAM savings
  - **Save best only**: Only keep best validation checkpoint
  - **Early stopping patience**: Stop if val loss doesn't improve for N epochs
  - **Max checkpoints limit**: Disk space management

### UI/UX
- **Chat persistence**: Conversations now survive tab switches (stored in localStorage)
- **Chat clear button**: 🗑️ button to reset conversation
- **Log export**: 📥 Export button downloads training logs as timestamped .txt file

### Types
- Extended `TrainingConfig` interface with `train.packing`, `train.lr_scheduler`, `train.optimizer`, `train.gradient_checkpointing`, `train.save_total_limit`, `train.save_best_only`, `train.early_stopping_patience`, and `precision` section
- Fixed `updateConfig` signature to accept `boolean` values for checkbox fields

### Bug Fixes
- Chat localStorage persistence now has try/catch for quota exceeded errors

---

## v0.3.2 (2026-01-30)

### Bug Fixes
- **Response message accuracy**: `/convert` and `/evaluate` endpoints now return "complete" instead of misleading "started" (they await completion)

### UI/UX
- **Traceback collapse**: long stderr/error logs (>10 lines) now collapse with expand/collapse button - no more scrolling through 50-line Python tracebacks

### Tests
- **Validation test coverage**: added 7 tests for POST `/train/config` validation (max_samples, epochs, batch_size, lr)

---

## v0.3.1 (2026-01-30)

### Bug Fixes
- **GGUF converter path fix**: script path now correctly uses `Scripts/` (Windows) or `bin/` (Unix) instead of non-existent `Lib/site-packages/bin/`
- **GGUF converter timeout**: added 30-minute timeout - no longer hangs indefinitely on stuck conversions
- **GGUF converter errors**: stderr now broadcasts to WebSocket so UI shows Python errors
- **GGUF converter script check**: validates converter script exists before spawning process
- **max_samples validation**: negative values now treated as "use all" instead of crashing with ValueError
- **Config validation**: POST `/train/config` validates epochs, batch_size, lr, max_samples before saving

### UI/UX
- **Auto-scroll fix**: log panel only auto-scrolls when user is near bottom - no longer yanks away while reading
- **Log overflow fix**: long error lines and paths now wrap properly with `word-break`

### Cleanup
- **Dead exports removed**: `generateGraph` and type re-exports removed from modelConverter.ts barrel file

---

## v0.3.0 (2026-01-30)

### Training / ML
- **LoRA merge fix**: merge now uses saved best checkpoint instead of current (possibly overfit) model when `save_best_only=true`
- **Gradient flush**: accumulated gradients at epoch end no longer discarded - added flush for partial batches
- **Tokenization boundary fix**: use `offset_mapping` for exact character boundary detection in label masking
- **Field name fix**: `evaluate_gguf.py` returns `correct` field (was `exact`) - now matches `modelJudge.ts` expectations
- **Prompt format alignment**: evaluation uses `"Output: "` (trailing space) to match training format
- **Scheduler typo**: fixed `min_lr_rate` → `lr_min` in cosine scheduler config
- **Perplexity metrics**: validation now returns loss + perplexity (capped at 10k)
- **LoRA checkpoints**: save adapter weights only (~50MB vs 14GB full model)
- **Max samples config**: added UI control for `max_samples` - set 0 for all samples

### GPU / Device
- **GPU selector**: dropdown shows available CUDA devices with free memory
- **PyTorch detection**: GPU enumeration uses PyTorch (matches training CUDA ordering)
- **Auto-save config**: training start now saves config first (applies GPU selection)

### UI / UX
- **Multi-dataset merge**: select multiple datasets, merge into single training file
- **Multi-file upload**: drag-drop or select multiple .jsonl files at once
- **Log display overhaul**: badges, pills, color-coding for different message types
- **Status formatting**: improved warn/error/status message display
- **Timer persistence**: training elapsed time survives page refresh via localStorage

### Performance
- **Async I/O**: `processManager` queue ops, `/checkpoints` endpoint now async
- **Parallel LLM calls**: `modelJudge` and dataset augment/quality calls parallelized (4x speedup)
- **Custom hooks**: extracted `usePolling` and `useEscapeKey` - removes duplicate logic

### Bug Fixes
- **stderr formatting**: Python stderr now gets proper warn/error badges
- **Merge robustness**: conversation format conversion, skips invalid JSON files
- **Data cleanup**: removed accidentally committed data files, updated gitignore

### Cleanup
- **Dead code removal**: unused types, props, imports across frontend/backend/trainer
- **Import consolidation**: moved scattered imports to top-level in train.py
- **Simplified cleanup**: removed over-engineered 5-retry temp cleanup loop

---

## v0.2.0 (2026-01-26)

### Security
- **ZIP slip fix**: `backup.ts` - wrapped path operations with `sanitizePath()` to block `../` in archive entries
- **runId validation**: `train.ts` - validate checkpoint paths before filesystem access

### Electron
- **ESM/CJS split**: separate tsconfig for main (ESM) and preload (CJS) - fixes "exports is not defined" error
- **Backend startup**: `electron:build` now compiles backend, shows error dialog on failure instead of blank window
- **Asset paths**: `vite.config.ts` - always use relative base `./` so Electron file:// doesn't resolve to `C:\assets\`
- **Packaging fix**: `main.ts` - backend path differs in dev vs packaged mode; `package.json` - include node_modules in extraResources
- **Port alignment**: `main.ts` - findFreePort defaults to 8080 to match frontend expectations
- **CORS for Electron**: `server.ts` - allow file://, null, and localhost origins for packaged app
- **Trainer bundling**: `package.json` - include trainer folder in extraResources for config files

### Backend
- **Rate limit relaxed**: 100 req/15min → 120 req/1min (config.ts)
- **Log spam removed**: proxy.ts - commented out per-request logs (cache hit, forwarding, instillation match)
- **Async fix**: `train.ts:33` - added missing `await` on `startTraining()`
- **Division by zero**: `datasets.ts:360` - guard against empty file in preview stats

### Frontend
- **Timer fix**: `TrainingPanel.tsx` - timer no longer resets on tab switch (added `wasRunning` ref to track actual stop)
- **Timer fix pt2**: `App.tsx` - keep TrainingPanel mounted when switching tabs (prevents ref loss from unmount)
- **Notification overlay**: error boxes in TrainingPanel/InstillationsPanel now use `position: fixed` - no layout shift

### Python Trainer
- **LoRA merge OOM fallback**: `train.py` - tries GPU first, catches OOM, falls back to CPU merge
- Proper cleanup in `finally` block (temp adapter dir, gc, cuda cache)
- Catches all exceptions in GPU path for reliable fallback

### Tests (new)
506 tests across backend, frontend, and trainer:

| Area | Tests | Coverage |
|------|-------|----------|
| Backend routes | 121 | train, datasets, backup, proxy, models |
| Backend services | 36 | processManager, ggufConverter, fileMonitor, etc |
| Backend security | 215 | path traversal, ZIP slip, injection vectors |
| Frontend components | 134 | all major components |
| Python trainer | 91 | merge, attention, checkpoint, dataset |

Run with:
```bash
# backend
cd madlab-backend && npm test

# frontend
cd madlab-frontend && npm run test:run

# python
cd madlab-backend/trainer && python -m pytest tests/
```

---

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

---

## v0.1.0 (2026-01-18)


## security fixes

- **RCE in /smart_import** - removed the `exec()` call on LLM-generated python. was wild that was ever there. `normalize_columns()` handles mapping safely now.
- **race condition in processManager** - mutex pattern was already there but tightened it up. concurrent /train/start requests blocked properly.
- **tokenization bug** - train.py now tokenizes full text first, then prompt with matching `add_special_tokens=True`. labels mask correctly.
- **rate limiting** - middleware applied in server.ts, configurable via CONFIG.
- **path traversal** - `isPathSafe()` uses `path.resolve()` correctly
- **yaml safe load** - uses `yaml.JSON_SCHEMA`
- **websocket origin check** - validates against ALLOWED_ORIGINS
- **SSRF via LM_STUDIO_URL** - only localhost allowed

---

## backend fixes

- **circular import** - refactored fileMonitor.ts to accept broadcast as param. no more circular dep with server.ts.
- **spawn() error handlers** - ggufConverter.ts and ggufEvaluator.ts have proper `proc.on('error')` handlers. promises reject on spawn failures.
- **write lock** - instillations.ts uses proper fileLock for atomic read-modify-write.
- **file watcher** - graceful shutdown on SIGTERM/SIGINT.

---

## training improvements

- **flash attention 2 / sdpa** - auto-detects best attention impl. flash_attention_2 > sdpa > eager. config: `attn_implementation: auto`
- **padding-free packing** - concatenates samples into sequences with block-diagonal attention mask. no cross-sample leakage. logs packing efficiency. config: `packing: true`
- **torch.compile()** - pytorch 2.0+ jit compilation. ~1.5x speedup from kernel fusion. config: `torch_compile: true`
- **fused optimizer** - `adamw_fused` uses cuda fused kernel (~10% faster). also added `paged_adamw_8bit` for reduced OOM risk.
- **neftune** - noisy embeddings during training. +3-5% quality. config: `neftune_noise_alpha: 5`
- **dora** - weight-decomposed lora. better quality at same rank. config: `use_dora: true`
- **checkpoint resume** - saves progress, can resume on crash. SIGINT triggers emergency save.
- **job queue** - queue multiple training runs, auto-start next.
- **graceful cancellation** - SIGINT allows checkpoint save before stop.

---

## dataset stuff

- **multi-format import** - csv, parquet, json, jsonl all work now
- **dataset profiling** - row count, duplicates, length stats via data_tools.py
- **dataset versioning** - track changes, rollback to previous versions
- **dataset preview** - inspect samples + validation before training
- **validation rules** - custom quality checks (min/max length, regex, etc)
- **llm-powered augmentation** - expand datasets via paraphrasing

---

## evaluation

- **bleu/rouge metrics** - fuzzy matching alongside exact match
- **llm judge** - ai-powered output quality scoring via lm studio
- **auto test case generator** - generate adversarial/edge case inputs
- **failure analysis** - llm explains why model failed specific samples

---

## llm-powered features (via lm studio)

- **magic import** - auto-format any huggingface dataset
- **dataset quality analyzer** - llm rates training sample quality
- **hyperparameter advisor** - llm suggests optimal training config (suggest hyperparams button)
- **synthetic data generation** - generate training data from examples

---

## infrastructure

- **health dashboard** - cpu, memory, disk, gpu monitoring at /health endpoint
- **audit logging** - tracks all sensitive operations to jsonl
- **structured logging** - pino-based json logs with request timing
- **project backup/restore** - export/import full project state
- **model lineage tracking** - full provenance for reproducibility
- **response caching** - lru cache for lm studio proxy requests
- **lm studio health probe** - circuit breaker for upstream failures

---

## ui/ux

- **command palette** - Ctrl/Cmd+K for quick actions
- **keyboard shortcuts** - Ctrl+1/2/3/4 for tab navigation
- **dark/light theme** - toggle in header, persists to localStorage
- **toast notifications** - consistent feedback, no more alert() calls
- **websocket status** - connection indicator in header
- **real-time loss chart** - svg chart in monitoring tab
- **export bundle** - one-click zip of model + config + dataset
- **training progress timeline** - eta based on epoch duration
- **config presets** - quick test, small model, large model, quality fine-tune

---

## desktop app

- **electron packaging** - foundation for standalone desktop app. main.ts, preload.ts, tsconfig set up.

---

## tests

finally have some coverage:

**backend (jest)**
- security.ts - table-driven tests with malicious path inputs
- processManager.ts - mock spawn, verify mutex works
- instillationsCache.ts - cache hit/miss/eviction

**frontend (vitest)**
- App.test.tsx - render, tab switching, ws connection
- ErrorBoundary.test.tsx - error catching

**python (pytest)**
- test_train.py - tokenization, collate, dataset loading
- test_data_tools.py - import, profile, validate commands
- test_evaluate.py - bleu/rouge scoring

---

## commits

```
803c887 docs: add packing config option
2a0260f feat: padding-free sample packing
ac70e47 feat: torch.compile() jit optimization
f3ff2b3 feat: fused + paged optimizers
503ce80 docs: add features section to readme
d839a2f feat: integrate command palette with Ctrl+K shortcut
bdb229b feat: add electron packaging foundation
9a65ef3 feat: add suggest hyperparams button with LLM integration
73f4f1c feat: add LLM-powered dataset augmentation endpoint
8dffa63 feat: add llm-powered dataset quality analyzer and test case generator
802ff67 feat: add toast notification system
af0b9ce feat: job queue with graceful cancellation
c75b614 feat: model lineage tracking
37c87fa feat: project backup/restore endpoints
4dfce79 feat: add audit logging for sensitive operations
de8e99d feat: export bundle endpoint and button
322823a feat: lm studio health probe with circuit breaker
64758d9 feat: add training config presets dropdown
284b97e feat: add real-time loss chart to monitoring panel
a61e0a1 feat: add ws status indicator, keyboard shortcuts, theme toggle
46eb996 chore: remove config files from tracking
fbcf4d2 test: add security, processManager, cache unit tests
340750e test: add python unit tests for trainer
720a272 fix: backend race conditions, error handlers, top-level imports
3019476 fix: remove dead code with undefined transform_func reference
