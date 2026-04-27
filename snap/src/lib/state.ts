/**
 * Persistent Snap state, stored via `snap_manageState`. Encrypted at rest by
 * MetaMask using the user's secret recovery phrase.
 *
 * The schema is intentionally narrow — a few key shapes only:
 *  - lastSelectedAccount: address most recently used (so screens don't have to
 *    re-prompt the user on every reload).
 *  - uploads: per-account list of {reference, batchId, expiryDate, filename}
 *    so the uploads list survives across sessions. There is no central index
 *    of uploads on Swarm; this is the user's local record.
 *  - pendingNonces: per-account map of {batchId → nonce} so we can recover
 *    state if a buy is interrupted between Relay step submission and final
 *    confirmation. Not used in v1, kept for future top-up flow.
 *  - settings: a tiny user-editable bag (custom backend URL, custom node addr).
 *
 * NOTE: We deliberately do NOT cache stamp lists locally — the registry on
 * Gnosis is the source of truth; reading it on every render is fast enough
 * and avoids stale-data bugs.
 */

export interface UploadRecord {
  /** Swarm reference hash — what you'd put after `bzz://` to retrieve. */
  reference: string;
  /** Batch ID this file was uploaded against (no 0x prefix, matches stamps API). */
  batchId: string;
  /** Stamp expiry as unix ms — copied from the stamp's batchTTL at upload time. */
  expiryDate: number;
  /** Original filename — display only. */
  filename: string;
  /** Bytes — display only. May be 0 if unknown. */
  fileSize: number;
  /** Whether this was uploaded as a website (sets Swarm-Index-Document). */
  isWebsite: boolean;
  /** Unix ms when the upload finished — newest-first sort key. */
  uploadedAt: number;
}

export interface SnapSettings {
  /** Override for the Bee API proxy URL. Defaults to DEFAULT_BEE_API_URL. */
  beeApiUrl?: string;
  /** Override for the Swarm node address. Defaults to DEFAULT_NODE_ADDRESS. */
  nodeAddress?: string;
}

export interface SnapState {
  lastSelectedAccount?: string;
  /** Per-lowercased-address upload history. */
  uploads: Record<string, UploadRecord[]>;
  settings: SnapSettings;
  /**
   * Per-interface-id "active poll generation". A background polling loop
   * captures the gen at start and re-checks it before each render — if the
   * stored gen has been overwritten or cleared (because the user navigated
   * to a different screen), the poll aborts.
   */
  activePolls?: Record<string, number>;
}

const EMPTY_STATE: SnapState = {
  uploads: {},
  settings: {},
  activePolls: {},
};

/** Read the full state (encrypted). Returns the empty schema on first run. */
export async function getState(): Promise<SnapState> {
  const raw = (await snap.request({
    method: 'snap_manageState',
    params: { operation: 'get' },
  })) as SnapState | null;

  if (!raw) return { ...EMPTY_STATE };

  // Defensive: older shapes might be missing newer fields.
  return {
    lastSelectedAccount: raw.lastSelectedAccount,
    uploads: raw.uploads ?? {},
    settings: raw.settings ?? {},
    activePolls: raw.activePolls ?? {},
  };
}

/** Replace the full state. */
export async function setState(next: SnapState): Promise<void> {
  await snap.request({
    method: 'snap_manageState',
    params: { operation: 'update', newState: next as any },
  });
}

/** Convenience: shallow-merge a patch into state and persist. */
export async function patchState(patch: Partial<SnapState>): Promise<SnapState> {
  const current = await getState();
  const next = { ...current, ...patch };
  await setState(next);
  return next;
}

/** Append an upload record for the given account. */
export async function addUpload(
  account: string,
  record: UploadRecord,
): Promise<void> {
  const state = await getState();
  const key = account.toLowerCase();
  const existing = state.uploads[key] ?? [];
  state.uploads[key] = [record, ...existing];
  await setState(state);
}

/** Read upload history for a specific account, newest-first. */
export async function getUploads(account: string): Promise<UploadRecord[]> {
  const state = await getState();
  return state.uploads[account.toLowerCase()] ?? [];
}

/** Remember which account the user was last working with. */
export async function rememberAccount(account: string): Promise<void> {
  const state = await getState();
  state.lastSelectedAccount = account;
  await setState(state);
}

// ── Active-poll tracking ─────────────────────────────────────────────────────

/**
 * Mark a polling loop as the active one for an interface id. Any earlier
 * loop that captured a different gen will see the mismatch on its next
 * iteration and abort.
 *
 * Pass `null` for `gen` to *clear* the active poll — call this any time the
 * user navigates away from the screen that started the poll.
 */
export async function setActivePoll(
  id: string,
  gen: number | null,
): Promise<void> {
  const state = await getState();
  const polls = { ...(state.activePolls ?? {}) };
  if (gen === null) {
    delete polls[id];
  } else {
    polls[id] = gen;
  }
  state.activePolls = polls;
  await setState(state);
}

/** True iff this gen is the currently-active poll for `id`. */
export async function isActivePoll(
  id: string,
  gen: number,
): Promise<boolean> {
  const state = await getState();
  return state.activePolls?.[id] === gen;
}
