import { StateRepository } from "../../domain/contracts";
import { UnitOfWork } from "../../domain/unit-of-work";

export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly repository: StateRepository) {}

  async transaction<T>(fn: (state: StateRepository) => Promise<T>): Promise<T> {
    return fn(this.repository);
  }
}
