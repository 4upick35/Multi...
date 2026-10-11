import {create} from 'zustand';

interface UiState {
  activeAccountId: string | null;
  setActiveAccountId: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeAccountId: null,
  setActiveAccountId: (id) => set({activeAccountId: id}),
}));
