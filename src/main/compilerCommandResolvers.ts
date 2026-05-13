export interface ResolvedCommandLike {
  name: string
  englishName: string
  returnType: string
  commandIndex: number
  libraryName: string
  libraryFileName: string
  params: Array<{ type: string }>
}

export interface NormalizedCommandBindingLike {
  library: string
  command: string
  commandEnglishName: string
  emit: string
}

export type DirectCallableNames = Set<string>
export type CommandMap = Map<string, any>

export type CommandCodeGenerator = (args: string[], commandMap?: CommandMap, directCallables?: DirectCallableNames) => string
export type CommandExprGenerator = (args: string[], commandMap?: CommandMap, directCallables?: DirectCallableNames) => string

export interface CommandResolverDeps {
  resolveCommandByProtocol: (
    protocolBindings: NormalizedCommandBindingLike[],
    libraryFileName: string,
    commandName: string,
    commandEnglishName: string,
    args: string[],
  ) => string | null
  resolveCommandExprByProtocol: (
    protocolBindings: NormalizedCommandBindingLike[],
    libraryFileName: string,
    commandName: string,
    commandEnglishName: string,
    args: string[],
    commandMap?: CommandMap,
    directCallables?: DirectCallableNames,
  ) => string | null
  loadCompileProtocols: () => { commands: NormalizedCommandBindingLike[] }
  generateYcGenericCommandCall: (cmd: ResolvedCommandLike, args: string[]) => string
}

export function createCommandResolvers(deps: CommandResolverDeps): {
  COMMAND_EXPR_GENERATORS: Record<string, CommandExprGenerator>
  COMMAND_CODE_GENERATORS: Record<string, CommandCodeGenerator>
  generateCCodeForCommand: (cmd: ResolvedCommandLike, args: string[], commandMap?: CommandMap, directCallables?: DirectCallableNames) => string
} {
  const COMMAND_EXPR_GENERATORS: Record<string, CommandExprGenerator> = {
  }

  const COMMAND_CODE_GENERATORS: Record<string, CommandCodeGenerator> = {
  }

  const generateCCodeForCommand = (cmd: ResolvedCommandLike, args: string[], commandMap?: CommandMap, directCallables?: DirectCallableNames): string => {
    const protocols = deps.loadCompileProtocols()
    const protocolCode = deps.resolveCommandByProtocol(
      protocols.commands,
      cmd.libraryFileName,
      cmd.name,
      cmd.englishName,
      args,
    )
    if (protocolCode) {
      return protocolCode
    }

    const protocolExpr = deps.resolveCommandExprByProtocol(
      protocols.commands,
      cmd.libraryFileName,
      cmd.name,
      cmd.englishName,
      args,
      commandMap,
      directCallables,
    )
    if (protocolExpr) {
      return `(void)${protocolExpr};`
    }

    const generator = COMMAND_CODE_GENERATORS[cmd.name]
    if (generator) {
      return generator(args, commandMap, directCallables)
    }

    return deps.generateYcGenericCommandCall(cmd, args)
  }

  return {
    COMMAND_EXPR_GENERATORS,
    COMMAND_CODE_GENERATORS,
    generateCCodeForCommand,
  }
}
