import { StateRepository } from "./contracts";

export interface UnitOfWork {
  transaction<T>(
    fn: (state: StateRepository) => Promise<T>,
  ): Promise<T>;
}
