/**
 * Bot Router — parses commands and routes to the right handler.
 *
 * Command format: BotName: action arg1=val1 arg2=val2
 * No fuzzy NLU in v1 — strict grammar only.
 */

import type { BotCommand, BotResponse, BotName } from './models/bot.js';
import { sha256 } from './semhash.js';

const VALID_BOTS = new Set<BotName>(['SpecBot', 'ImplBot', 'PolicyBot']);

const BOT_COMMANDS: Record<BotName, Record<string, { mutating: boolean; description: string }>> = {
  SpecBot: {
    ingest: { mutating: true, description: 'Ingest a spec document' },
    diff: { mutating: false, description: 'Show clause diff for a document' },
    clauses: { mutating: false, description: 'List clauses for a document' },
    help: { mutating: false, description: 'Show available commands' },
    commands: { mutating: false, description: 'List commands' },
    version: { mutating: false, description: 'Show version' },
  },
  ImplBot: {
    plan: { mutating: true, description: 'Plan IUs from canonical graph' },
    regen: { mutating: true, description: 'Regenerate code for an IU' },
    drift: { mutating: false, description: 'Check for drift in generated files' },
    help: { mutating: false, description: 'Show available commands' },
    commands: { mutating: false, description: 'List commands' },
    version: { mutating: false, description: 'Show version' },
  },
  PolicyBot: {
    status: { mutating: false, description: 'Show trust dashboard' },
    evidence: { mutating: false, description: 'Show evidence for an IU' },
    cascade: { mutating: false, description: 'Show cascade effects' },
    evaluate: { mutating: false, description: 'Evaluate policy for an IU' },
    help: { mutating: false, description: 'Show available commands' },
    commands: { mutating: false, description: 'List commands' },
    version: { mutating: false, description: 'Show version' },
  },
};

/**
 * Parse a raw command string into a BotCommand.
 */
export function parseCommand(raw: string): BotCommand | { error: string } {
  const trimmed = raw.trim();

  // Match: BotName: action ...args
  const match = trimmed.match(/^(\w+):\s+(\w+)\s*(.*)?$/);
  if (!match) {
    return { error: `Invalid command format. Expected: BotName: action [args]. Got: "${trimmed}"` };
  }

  const botName = match[1] as BotName;
  const action = match[2];
  const argsStr = (match[3] || '').trim();

  if (!VALID_BOTS.has(botName)) {
    return { error: `Unknown bot: ${botName}. Valid bots: ${[...VALID_BOTS].join(', ')}` };
  }

  const botCommands = BOT_COMMANDS[botName];
  if (!botCommands[action]) {
    return { error: `Unknown command: ${botName}: ${action}. Try: ${botName}: help` };
  }

  // Parse key=value args. The value may be "quoted with spaces", empty (key=), or bare;
  // leftover tokens are captured as the positional '_' arg instead of being dropped.
  const args: Record<string, string> = {};
  if (argsStr) {
    const kvRe = /(\w+)=(?:"([^"]*)"|'([^']*)'|(\S*))/g;
    let rest = argsStr;
    let m: RegExpExecArray | null;
    while ((m = kvRe.exec(argsStr)) !== null) {
      args[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
      rest = rest.replace(m[0], '');
    }
    const positional = rest.trim().replace(/\s+/g, ' ');
    if (positional) args['_'] = positional;
  }

  return { bot: botName, action, args, raw: trimmed };
}

/**
 * Route a parsed command and produce a response.
 * For mutating commands, returns the intent for confirmation.
 * For read-only commands, executes immediately.
 */
export function routeCommand(cmd: BotCommand): BotResponse {
  const commandDef = BOT_COMMANDS[cmd.bot]?.[cmd.action];
  if (!commandDef) {
    return { bot: cmd.bot, action: cmd.action, mutating: false, message: `Unknown command: ${cmd.action}` };
  }

  // Handle help/commands/version for all bots
  if (cmd.action === 'help' || cmd.action === 'commands') {
    const cmds = BOT_COMMANDS[cmd.bot];
    const lines = Object.entries(cmds).map(([name, def]) => {
      const tag = def.mutating ? ' [mutating]' : '';
      return `  ${cmd.bot}: ${name}${tag} — ${def.description}`;
    });
    return {
      bot: cmd.bot,
      action: cmd.action,
      mutating: false,
      result: Object.keys(cmds),
      message: `${cmd.bot} commands:\n${lines.join('\n')}`,
    };
  }

  if (cmd.action === 'version') {
    return {
      bot: cmd.bot,
      action: 'version',
      mutating: false,
      result: { version: '0.1.0' },
      message: `${cmd.bot} v0.1.0 (Phoenix VCS)`,
    };
  }

  // Mutating commands: echo intent, require confirmation
  if (commandDef.mutating) {
    const confirmId = sha256(`${cmd.bot}:${cmd.action}:${JSON.stringify(cmd.args)}:${Date.now()}`).slice(0, 12);
    const intent = describeIntent(cmd);
    return {
      bot: cmd.bot,
      action: cmd.action,
      mutating: true,
      confirm_id: confirmId,
      intent,
      message: `${cmd.bot} wants to: ${intent}\n\nReply 'ok' or 'phx confirm ${confirmId}' to proceed.`,
    };
  }

  // Read-only commands: execute immediately (return description)
  return {
    bot: cmd.bot,
    action: cmd.action,
    mutating: false,
    message: describeReadAction(cmd),
  };
}

function describeIntent(cmd: BotCommand): string {
  switch (`${cmd.bot}:${cmd.action}`) {
    case 'SpecBot:ingest':
      return `Ingest spec document: ${cmd.args['_'] || cmd.args['doc'] || '(no doc specified)'}`;
    case 'ImplBot:plan':
      return 'Plan Implementation Units from the current canonical graph';
    case 'ImplBot:regen': {
      const iu = cmd.args['iu'] || cmd.args['_'] || '(all)';
      return `Regenerate code for IU: ${iu}`;
    }
    default:
      return `${cmd.bot} ${cmd.action} ${JSON.stringify(cmd.args)}`;
  }
}

function describeReadAction(cmd: BotCommand): string {
  switch (`${cmd.bot}:${cmd.action}`) {
    case 'SpecBot:diff':
      return `Showing clause diff for: ${cmd.args['_'] || cmd.args['doc'] || '(current)'}`;
    case 'SpecBot:clauses':
      return `Listing clauses for: ${cmd.args['_'] || cmd.args['doc'] || '(all)'}`;
    case 'ImplBot:drift':
      return 'Checking drift status for all generated files';
    case 'PolicyBot:status':
      return 'Trust dashboard: showing full phoenix status';
    case 'PolicyBot:evidence':
      return `Evidence for IU: ${cmd.args['iu'] || cmd.args['_'] || '(all)'}`;
    case 'PolicyBot:cascade':
      return 'Showing cascade effects from current failures';
    case 'PolicyBot:evaluate':
      return `Policy evaluation for IU: ${cmd.args['iu'] || cmd.args['_'] || '(all)'}`;
    default:
      return `${cmd.bot}: ${cmd.action}`;
  }
}

/**
 * Get all available commands across all bots.
 */
export function getAllCommands(): Record<BotName, string[]> {
  const result: Record<string, string[]> = {};
  for (const [bot, cmds] of Object.entries(BOT_COMMANDS)) {
    result[bot] = Object.keys(cmds);
  }
  return result as Record<BotName, string[]>;
}
