// 命令注册表：命令 ID → 处理函数。清单只声明命令，处理函数由插件在激活时注册，
// 注册返回 disposable，插件停用时统一注销（设计稿 §1「可撤销」、§5 commands）。

export interface Disposable {
  dispose(): void
}

export type CommandHandler = (...args: unknown[]) => unknown

export class CommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>()

  register(id: string, handler: CommandHandler): Disposable {
    if (this.handlers.has(id)) {
      throw new Error(`命令 ${id} 已经注册过处理函数`)
    }
    this.handlers.set(id, handler)
    return {
      dispose: () => {
        if (this.handlers.get(id) === handler) this.handlers.delete(id)
      },
    }
  }

  has(id: string): boolean {
    return this.handlers.has(id)
  }

  /** 执行命令；命令没有处理函数时只记日志不抛错（菜单里可能声明了尚未实现的命令） */
  async execute(id: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(id)
    if (!handler) {
      console.warn(`[commands] 命令 ${id} 没有注册处理函数`)
      return undefined
    }
    return handler(...args)
  }

  getRegisteredIds(): string[] {
    return [...this.handlers.keys()]
  }
}
