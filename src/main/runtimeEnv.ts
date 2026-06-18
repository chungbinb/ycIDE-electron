// 运行环境注入：把 Electron 主进程独有的路径/版本信息（app.getAppPath / isPackaged /
// getPath('userData') / getVersion）抽成普通数据，由主进程在启动时注入。
// 这样 compiler / libraryManager / ycmd-registry 不再直接依赖 electron，
// 可以在 worker_threads（拿不到 app/BrowserWindow）里原样运行。

export interface RuntimeEnv {
  appPath: string
  isPackaged: boolean
  userDataPath: string
  appVersion: string
}

let env: RuntimeEnv | null = null

export function setRuntimeEnv(next: RuntimeEnv): void {
  env = next
}

export function getRuntimeEnv(): RuntimeEnv {
  if (!env) {
    throw new Error('runtimeEnv 未初始化：必须先调用 setRuntimeEnv（主进程启动或 worker 初始化时）')
  }
  return env
}
