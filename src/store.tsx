import { createContext, useContext, useMemo, useState } from 'react';
import type { User } from './types';

interface StoreValue {
  user: User | null;
  users: User[];
  setUser: (user: User) => void;
  setUsers: (users: User[]) => void;
}

const StoreContext = createContext<StoreValue>({
  user: null,
  users: [],
  setUser: () => undefined,
  setUsers: () => undefined,
});

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const value = useMemo(() => ({ user, users, setUser, setUsers }), [user, users]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}
