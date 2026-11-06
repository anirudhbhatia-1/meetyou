import { createContext, useContext } from 'react';

import type { LibraryApi } from '../api/types.ts';

export const ApiContext = createContext<LibraryApi | null>(null);

export function useApi(): LibraryApi {
  const api = useContext(ApiContext);
  if (api === null) throw new Error('ApiContext missing');
  return api;
}
