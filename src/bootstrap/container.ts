import { StateRepository, ModelAdapter, ToolAdapter } from "../domain/contracts";
import { UnitOfWork } from "../domain/unit-of-work";
import { InMemoryUnitOfWork } from "../infrastructure/persistence/inMemoryUnitOfWork";
import { PostgresUnitOfWork, PgPoolLike } from "../infrastructure/persistence/postgresUnitOfWork";
import { PolicyEngine } from "../application/policy-engine";
import { BudgetController } from "../application/budget-controller";
import { ToolGateway } from "../application/tool-gateway";
import { ModelGateway } from "../application/model-gateway";
import { Scheduler } from "../application/scheduler";
import { GateEngine, Gate } from "../application/gate-engine";
import { Supervisor } from "../application/supervisor";
import { NamlaLoop, TaskExecutor } from "../application/namla-loop";

export interface ContainerConfig {
  stateRepository: StateRepository;
  unitOfWork: UnitOfWork;
  toolAdapters: readonly ToolAdapter[];
  modelAdapters: readonly ModelAdapter[];
  gates: readonly Gate[];
  supervisor: Supervisor;
  taskExecutor: TaskExecutor;
}

export class Container {
  public readonly state: StateRepository;
  public readonly unitOfWork: UnitOfWork;
  public readonly policy: PolicyEngine;
  public readonly budgets: BudgetController;
  public readonly tools: ToolGateway;
  public readonly models: ModelGateway;
  public readonly scheduler: Scheduler;
  public readonly gateEngine: GateEngine;
  public readonly namlaLoop: NamlaLoop;

  constructor(config: ContainerConfig) {
    this.state = config.stateRepository;
    this.unitOfWork = config.unitOfWork;
    this.policy = new PolicyEngine();
    this.budgets = new BudgetController();
    this.tools = new ToolGateway(config.toolAdapters, this.state, this.policy);
    this.models = new ModelGateway(config.modelAdapters, this.state, this.budgets);
    this.scheduler = new Scheduler(this.state);
    this.gateEngine = new GateEngine(config.gates);
    this.namlaLoop = new NamlaLoop(
      this.state,
      config.taskExecutor,
      this.gateEngine,
      config.supervisor,
    );
  }

  static createTestContainer(config: Omit<ContainerConfig, "unitOfWork"> & { unitOfWork?: UnitOfWork }): Container {
    const unitOfWork = config.unitOfWork ?? new InMemoryUnitOfWork(config.stateRepository);
    return new Container({ ...config, unitOfWork });
  }

  static createPostgresContainer(
    pool: PgPoolLike,
    config: Omit<ContainerConfig, "unitOfWork">,
  ): Container {
    const unitOfWork = new PostgresUnitOfWork(pool);
    return new Container({ ...config, unitOfWork });
  }
}
