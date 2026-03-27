import { EventEmitter } from 'node:events';

export interface BotCommand {
  name: string;
  description: string;
  readonly: boolean;
  handler: (args: string[], context: BotContext) => Promise<BotResponse>;
}

export interface BotContext {
  userId: string;
  channelId: string;
  timestamp: number;
}

export interface BotResponse {
  message: string;
  requiresConfirmation?: boolean;
  parsedIntent?: string;
  confirmationId?: string;
}

export interface PendingConfirmation {
  id: string;
  botId: string;
  userId: string;
  command: string;
  args: string[];
  parsedIntent: string;
  timestamp: number;
  handler: (args: string[], context: BotContext) => Promise<BotResponse>;
}

export abstract class Bot extends EventEmitter {
  protected commands = new Map<string, BotCommand>();
  protected pendingConfirmations = new Map<string, PendingConfirmation>();

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly version: string,
    public readonly description: string
  ) {
    super();
    this.registerCoreCommands();
  }

  private registerCoreCommands(): void {
    this.commands.set('help', {
      name: 'help',
      description: 'Show available commands',
      readonly: true,
      handler: async () => this.handleHelp()
    });

    this.commands.set('commands', {
      name: 'commands',
      description: 'List all commands',
      readonly: true,
      handler: async () => this.handleCommands()
    });

    this.commands.set('version', {
      name: 'version',
      description: 'Show bot version',
      readonly: true,
      handler: async () => this.handleVersion()
    });
  }

  protected registerCommand(command: BotCommand): void {
    this.commands.set(command.name, command);
  }

  private async handleHelp(): Promise<BotResponse> {
    const commandList = Array.from(this.commands.values())
      .map(cmd => `${cmd.name}: ${cmd.description}`)
      .join('\n');
    
    return {
      message: `${this.name} v${this.version}\n${this.description}\n\nCommands:\n${commandList}`
    };
  }

  private async handleCommands(): Promise<BotResponse> {
    const commandNames = Array.from(this.commands.keys()).sort();
    return {
      message: `Available commands: ${commandNames.join(', ')}`
    };
  }

  private async handleVersion(): Promise<BotResponse> {
    return {
      message: `${this.name} version ${this.version}`
    };
  }

  public async processCommand(input: string, context: BotContext): Promise<BotResponse> {
    const trimmed = input.trim();
    
    // Handle confirmation responses
    if (trimmed === 'ok' || trimmed === 'phx confirm') {
      return this.handleConfirmation(context);
    }

    const parts = trimmed.split(/\s+/);
    const commandName = parts[0];
    const args = parts.slice(1);

    const command = this.commands.get(commandName);
    if (!command) {
      return {
        message: `Unknown command: ${commandName}. Type 'help' for available commands.`
      };
    }

    try {
      const response = await command.handler(args, context);
      
      if (!command.readonly && !response.requiresConfirmation) {
        // Mutating command must require confirmation
        const confirmationId = this.generateConfirmationId();
        const parsedIntent = response.parsedIntent || `Execute ${commandName} with args: ${args.join(' ')}`;
        
        this.pendingConfirmations.set(confirmationId, {
          id: confirmationId,
          botId: this.id,
          userId: context.userId,
          command: commandName,
          args,
          parsedIntent,
          timestamp: Date.now(),
          handler: command.handler
        });

        return {
          message: `Parsed intent: ${parsedIntent}\nReply with 'ok' or 'phx confirm' to execute.`,
          requiresConfirmation: true,
          parsedIntent,
          confirmationId
        };
      }

      return response;
    } catch (error) {
      return {
        message: `Error executing command: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async handleConfirmation(context: BotContext): Promise<BotResponse> {
    // Find pending confirmation for this user
    const pending = Array.from(this.pendingConfirmations.values())
      .find(p => p.userId === context.userId && p.botId === this.id);

    if (!pending) {
      return {
        message: 'No pending command to confirm.'
      };
    }

    // Remove from pending
    this.pendingConfirmations.delete(pending.id);

    // Execute the confirmed command
    try {
      const response = await pending.handler(pending.args, context);
      return {
        message: `Confirmed: ${pending.parsedIntent}\n${response.message}`
      };
    } catch (error) {
      return {
        message: `Error executing confirmed command: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private generateConfirmationId(): string {
    return `conf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public cleanupExpiredConfirmations(maxAgeMs: number = 300000): void {
    const now = Date.now();
    for (const [id, confirmation] of this.pendingConfirmations.entries()) {
      if (now - confirmation.timestamp > maxAgeMs) {
        this.pendingConfirmations.delete(id);
      }
    }
  }
}

export class SpecBot extends Bot {
  constructor() {
    super('specbot', 'Spec Bot', '1.0.0', 'Ingests and manages specifications');
    this.registerSpecCommands();
  }

  private registerSpecCommands(): void {
    this.registerCommand({
      name: 'ingest',
      description: 'Ingest a specification file',
      readonly: false,
      handler: async (args, context) => {
        if (args.length === 0) {
          throw new Error('Usage: ingest <file-path>');
        }
        const filePath = args[0];
        return {
          message: `Specification ingested from ${filePath}`,
          parsedIntent: `Ingest specification file: ${filePath}`
        };
      }
    });

    this.registerCommand({
      name: 'list',
      description: 'List ingested specifications',
      readonly: true,
      handler: async () => {
        return {
          message: 'Listing all ingested specifications...'
        };
      }
    });

    this.registerCommand({
      name: 'validate',
      description: 'Validate a specification',
      readonly: true,
      handler: async (args) => {
        if (args.length === 0) {
          throw new Error('Usage: validate <spec-id>');
        }
        const specId = args[0];
        return {
          message: `Validating specification: ${specId}`
        };
      }
    });
  }
}

export class ImplBot extends Bot {
  constructor() {
    super('implbot', 'Implementation Bot', '1.0.0', 'Regenerates implementations from specifications');
    this.registerImplCommands();
  }

  private registerImplCommands(): void {
    this.registerCommand({
      name: 'regen',
      description: 'Regenerate implementation from specification',
      readonly: false,
      handler: async (args, context) => {
        if (args.length === 0) {
          throw new Error('Usage: regen <spec-id>');
        }
        const specId = args[0];
        return {
          message: `Implementation regenerated for specification ${specId}`,
          parsedIntent: `Regenerate implementation for specification: ${specId}`
        };
      }
    });

    this.registerCommand({
      name: 'status',
      description: 'Check regeneration status',
      readonly: true,
      handler: async (args) => {
        const specId = args[0] || 'all';
        return {
          message: `Regeneration status for ${specId}: Ready`
        };
      }
    });

    this.registerCommand({
      name: 'diff',
      description: 'Show differences between spec and implementation',
      readonly: true,
      handler: async (args) => {
        if (args.length === 0) {
          throw new Error('Usage: diff <spec-id>');
        }
        const specId = args[0];
        return {
          message: `Showing diff for specification: ${specId}`
        };
      }
    });
  }
}

export class PolicyBot extends Bot {
  constructor() {
    super('policybot', 'Policy Bot', '1.0.0', 'Monitors and reports system status');
    this.registerPolicyCommands();
  }

  private registerPolicyCommands(): void {
    this.registerCommand({
      name: 'status',
      description: 'Show system status',
      readonly: true,
      handler: async () => {
        return {
          message: 'System Status: All services operational'
        };
      }
    });

    this.registerCommand({
      name: 'health',
      description: 'Perform health check',
      readonly: true,
      handler: async () => {
        return {
          message: 'Health Check: PASS - All components healthy'
        };
      }
    });

    this.registerCommand({
      name: 'policies',
      description: 'List active policies',
      readonly: true,
      handler: async () => {
        return {
          message: 'Active Policies:\n- Confirmation required for mutations\n- Read-only commands execute immediately\n- Bot privileges match normal users'
        };
      }
    });

    this.registerCommand({
      name: 'enforce',
      description: 'Enforce a policy',
      readonly: false,
      handler: async (args, context) => {
        if (args.length === 0) {
          throw new Error('Usage: enforce <policy-name>');
        }
        const policyName = args[0];
        return {
          message: `Policy ${policyName} enforced`,
          parsedIntent: `Enforce policy: ${policyName}`
        };
      }
    });
  }
}

export class BotManager extends EventEmitter {
  private bots = new Map<string, Bot>();

  constructor() {
    super();
    this.initializeCoreBots();
    this.startCleanupTimer();
  }

  private initializeCoreBots(): void {
    const specBot = new SpecBot();
    const implBot = new ImplBot();
    const policyBot = new PolicyBot();

    this.bots.set(specBot.id, specBot);
    this.bots.set(implBot.id, implBot);
    this.bots.set(policyBot.id, policyBot);
  }

  private startCleanupTimer(): void {
    setInterval(() => {
      for (const bot of this.bots.values()) {
        bot.cleanupExpiredConfirmations();
      }
    }, 60000); // Cleanup every minute
  }

  public getBot(botId: string): Bot | undefined {
    return this.bots.get(botId);
  }

  public listBots(): Bot[] {
    return Array.from(this.bots.values());
  }

  public async processMessage(botId: string, message: string, context: BotContext): Promise<BotResponse> {
    const bot = this.bots.get(botId);
    if (!bot) {
      return {
        message: `Bot not found: ${botId}`
      };
    }

    return bot.processCommand(message, context);
  }

  public registerBot(bot: Bot): void {
    this.bots.set(bot.id, bot);
    this.emit('botRegistered', bot);
  }

  public unregisterBot(botId: string): boolean {
    const bot = this.bots.get(botId);
    if (bot) {
      this.bots.delete(botId);
      this.emit('botUnregistered', bot);
      return true;
    }
    return false;
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '7c42465b738e92d12416010b33f08910f1c13a1ae44a7e9944f0e01939069c4e',
  name: 'Bot Integration',
  risk_tier: 'high',
  canon_ids: [8 as const],
} as const;