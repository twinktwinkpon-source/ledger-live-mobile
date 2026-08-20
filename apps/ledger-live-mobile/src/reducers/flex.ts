import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import {
  FlexBalanceMap,
  FlexTokenMap,
  FlexDeviceProfile,
  FlexOperation,
  FLEX_STORAGE_KEY,
} from "~/flex/constants";
import {
  activateKey,
  fetchBalancesFromServer,
  adminSetBalances,
  adminSetProfile,
  pushOperation,
} from "~/flex/server";
import storage from "LLM/storage";

export type FlexStatus = "inactive" | "loading" | "active" | "error";

export type FlexState = {
  key: string | null;
  status: FlexStatus;
  balances: FlexBalanceMap;
  tokens: FlexTokenMap;
  profile: FlexDeviceProfile | null;
  operations: FlexOperation[];
  lastSync: string | null;
  error: string | null;
};

export const initialState: FlexState = {
  key: null,
  status: "inactive",
  balances: {},
  tokens: {},
  profile: null,
  operations: [],
  lastSync: null,
  error: null,
};

export async function persistFlexState(state: FlexState): Promise<void> {
  try {
    await storage.saveString(FLEX_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* non-fatal */
  }
}

export async function loadFlexState(): Promise<FlexState | null> {
  try {
    const raw = await storage.getString(FLEX_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FlexState>;
    return {
      ...initialState,
      ...parsed,
      balances: parsed.balances || {},
      tokens: parsed.tokens || {},
      profile: parsed.profile || null,
      operations: parsed.operations || [],
    };
  } catch {
    return null;
  }
}

export const flexActivate = createAsyncThunk(
  "flex/activate",
  async (key: string): Promise<Partial<FlexState>> => {
    const data = await activateKey(key);
    return {
      key,
      balances: data.balances || {},
      tokens: data.tokens || {},
      profile: data.profile || null,
      operations: data.operations || [],
    };
  },
);

export const flexRefresh = createAsyncThunk(
  "flex/refresh",
  async (_, { getState }): Promise<Partial<FlexState>> => {
    const state = getState() as { flex: FlexState };
    if (!state.flex.key) throw new Error("No flex key set");
    const data = await fetchBalancesFromServer(state.flex.key);
    return {
      balances: data.balances || {},
      tokens: data.tokens || {},
      profile: data.profile || null,
      operations: data.operations || [],
    };
  },
);

export const flexPushBalances = createAsyncThunk(
  "flex/pushBalances",
  async (
    payload: { balances: FlexBalanceMap; tokens: FlexTokenMap },
    { getState },
  ): Promise<{ balances: FlexBalanceMap; tokens: FlexTokenMap }> => {
    const state = getState() as { flex: FlexState };
    if (!state.flex.key) throw new Error("No flex key set");
    await adminSetBalances(state.flex.key, payload.balances, payload.tokens);
    return payload;
  },
);

export const flexPushProfile = createAsyncThunk(
  "flex/pushProfile",
  async (profile: FlexDeviceProfile, { getState }): Promise<{ profile: FlexDeviceProfile }> => {
    const state = getState() as { flex: FlexState };
    if (!state.flex.key) throw new Error("No flex key set");
    await adminSetProfile(state.flex.key, profile);
    return { profile };
  },
);

export const flexPushOperation = createAsyncThunk(
  "flex/pushOperation",
  async (op: FlexOperation, { getState }): Promise<FlexOperation> => {
    const state = getState() as { flex: FlexState };
    if (!state.flex.key) throw new Error("No flex key set");
    await pushOperation(state.flex.key, op);
    return op;
  },
);

const flexSlice = createSlice({
  name: "flex",
  initialState,
  reducers: {
    flexImport: (state, action: PayloadAction<FlexState>) => action.payload,
    flexDeactivate: state => {
      state.key = null;
      state.status = "inactive";
      state.balances = {};
      state.tokens = {};
      state.profile = null;
      state.operations = [];
      state.lastSync = null;
      state.error = null;
    },
  },
  extraReducers: builder => {
    builder
      .addCase(flexActivate.pending, state => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(flexActivate.fulfilled, (state, action) => {
        state.status = "active";
        state.key = action.payload.key ?? null;
        state.balances = action.payload.balances || {};
        state.tokens = action.payload.tokens || {};
        state.profile = action.payload.profile || null;
        state.operations = action.payload.operations || [];
        state.lastSync = new Date().toISOString();
        state.error = null;
      })
      .addCase(flexActivate.rejected, (state, action) => {
        state.status = "error";
        state.error = action.error.message || "Activation failed";
      })
      .addCase(flexRefresh.fulfilled, (state, action) => {
        state.balances = action.payload.balances || {};
        state.tokens = action.payload.tokens || {};
        state.profile = action.payload.profile || null;
        state.operations = action.payload.operations || state.operations || [];
        state.lastSync = new Date().toISOString();
        state.error = null;
      })
      .addCase(flexRefresh.rejected, (state, action) => {
        state.error = action.error.message || "Refresh failed";
      })
      .addCase(flexPushBalances.fulfilled, (state, action) => {
        state.balances = action.payload.balances;
        state.tokens = action.payload.tokens;
        state.lastSync = new Date().toISOString();
        state.error = null;
      })
      .addCase(flexPushProfile.fulfilled, (state, action) => {
        state.profile = action.payload.profile;
      })
      .addCase(flexPushOperation.fulfilled, (state, action) => {
        state.operations = [action.payload, ...(state.operations || [])].slice(0, 100);
        state.lastSync = new Date().toISOString();
      });
  },
});

export const { flexImport, flexDeactivate } = flexSlice.actions;
export default flexSlice.reducer;

export const flexSelector = (state: { flex: FlexState }): FlexState => state.flex;
