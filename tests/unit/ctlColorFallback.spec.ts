// 【未配色控件的 WM_CTLCOLOR 兜底 · 运行时】用户报「新建编辑框没设任何颜色，设计器白底、运行后黑底」。
//
// 根因：颜色表为空时填的占位项 id 是 0，而查表处 `colorParentId = GetDlgCtrlID(父窗口)`——
// **顶层窗体没有控件 ID，GetDlgCtrlID 对它返回 0**，占位项于是被 colorParentId 撞上，
// 未配色控件全部拿到占位项的 backColor=0 → CreateSolidBrush(0) → 整片黑底。
// （建表处原注释写的是「空占位 id=0 永不匹配」，这个前提本身就是错的。）
//
// 触发条件很刁：只有当**没有任何控件产生颜色表条目**时才有占位项。标签/选择框/单选框/分组框
// 默认白底恒进表（见 defaultBgColor.spec.ts），编辑框/列表框默认色则不进表——所以
// 「编辑框+按钮」的空项目全黑，**往窗口上拖一个标签就又白了**。
//
// 为什么必须真跑：defaultBgColor.spec.ts 已经在断言色表内容了，却照样漏掉这个 bug——
// 因为错的不是表、是查表。codegen 断言证不了「WM_CTLCOLOR 最终返回了哪把刷子」。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setRuntimeEnv } from '../../src/main/runtimeEnv'
import { setCompilerHost, compileProject, type CompileMessage } from '../../src/main/compiler'

const repoRoot = resolve(__dirname, '..', '..')
const zigAvailable = existsSync(join(repoRoot, 'compiler', 'zig', 'zig.exe'))
const messages: CompileMessage[] = []
const tmpDirs: string[] = []

beforeAll(() => {
  setRuntimeEnv({ appPath: repoRoot, isPackaged: false, userDataPath: mkdtempSync(join(tmpdir(), 'ycide-ctlclr-userdata-')), appVersion: 'test' })
  setCompilerHost({ emitOutput: (m) => { messages.push(m) }, requestFocusIdeWindow: () => {}, notifyProcessExit: () => {}, openPathExternally: async () => '' })
})
afterAll(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* 进程可能还占着，交给系统清理 */ } } })

// 启动生成的 GUI 程序 → 按进程 ID 找顶层窗口 → 量各子控件客户区像素 → 无论成败都结束进程。
// 三个坑：
//  ①CharSet=Unicode 不能省——默认 Ansi 会把 GetClassNameW 的宽串读成首字母（"Edit"→"E"）。
//  ②脚本内**只许 ASCII**：Windows PowerShell 5.1 读无 BOM 的 .ps1 按 ANSI 解，中文会碎成语法错误
//    （落盘时另加 BOM 双保险）。给机器读的探针不需要中文，说明写在这边注释里。
//  ③finally 里必须杀进程：GUI 窗口不会自己退。
const PROBE_PS = String.raw`
param([string]$Exe)
Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] public static extern uint GetPixel(IntPtr dc, int x, int y);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] public static extern uint GetSysColor(int i);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  public static List<IntPtr> TopLevelOf(uint pid) { var r = new List<IntPtr>();
    EnumWindows((h,l) => { uint p; GetWindowThreadProcessId(h, out p); if (p==pid && IsWindowVisible(h)) r.Add(h); return true; }, IntPtr.Zero); return r; }
  public static List<IntPtr> ChildrenOf(IntPtr p) { var r = new List<IntPtr>();
    EnumChildWindows(p, (h,l) => { r.Add(h); return true; }, IntPtr.Zero); return r; }
  public static string Cls(IntPtr h) { var sb = new StringBuilder(64); GetClassNameW(h, sb, 64); return sb.ToString(); }
}
"@
$p = Start-Process -FilePath $Exe -PassThru
try {
  $tops = @()
  foreach ($i in 1..40) { Start-Sleep -Milliseconds 250; $tops = [W]::TopLevelOf($p.Id); if ($tops.Count -gt 0) { break } }
  if ($tops.Count -eq 0) { Write-Output "ERR=no-window"; exit 1 }
  Start-Sleep -Milliseconds 600   # let controls finish first paint
  Write-Output ("SYSWINDOW=" + ("#{0:X2}{1:X2}{2:X2}" -f (([W]::GetSysColor(5)) -band 0xFF), ((([W]::GetSysColor(5)) -shr 8) -band 0xFF), ((([W]::GetSysColor(5)) -shr 16) -band 0xFF)))
  foreach ($h in $tops) {
    foreach ($c in [W]::ChildrenOf($h)) {
      $cls = [W]::Cls($c)
      $r = New-Object W+RECT; [void][W]::GetClientRect($c, [ref]$r)
      if ($r.right -lt 30 -or $r.bottom -lt 30) { continue }
      $dc = [W]::GetDC($c)
      $col = [W]::GetPixel($dc, 15, 15)
      [void][W]::ReleaseDC($c, $dc)
      Write-Output ("PIXEL=" + $cls + "=" + ("#{0:X2}{1:X2}{2:X2}" -f ($col -band 0xFF), (($col -shr 8) -band 0xFF), (($col -shr 16) -band 0xFF)))
    }
  }
} finally { try { $p | Stop-Process -Force } catch {} }
`

describe('未配色控件的 WM_CTLCOLOR 兜底', () => {
  it.skipIf(!zigAvailable)('全默认配色的项目：编辑框/列表框运行时是系统窗口色，不是黑底', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ycide-ctlclr-')); tmpDirs.push(dir)
    // 关键：控件全用空 properties（等同设计器新建），且**不放标签/选择框**——
    // 那些默认白底会进颜色表，表一非空就没有占位项，这个 bug 就被掩盖了。
    writeFileSync(join(dir, 'p.epp'), ['# YiCode Project File', 'Version=1', 'ProjectName=兜底配色', 'OutputType=WindowsApp', 'Platform=windows', '', 'File=EFW|_启动窗口.efw|1', 'File=EYC|_启动窗口.eyc|0', ''].join('\n'), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.efw'), JSON.stringify({
      name: '_启动窗口', title: '兜底配色', width: 520, height: 300, sourceFile: '_启动窗口.eyc',
      controls: [
        { id: 'c1', type: '按钮', name: '按钮1', left: 10, top: 10, width: 75, height: 28, text: '按钮1', visible: true, enabled: true, properties: {} },
        { id: 'c2', type: '编辑框', name: '编辑框1', left: 100, top: 10, width: 180, height: 120, text: '', visible: true, enabled: true, properties: {} },
        { id: 'c3', type: '列表框', name: '列表框1', left: 300, top: 10, width: 180, height: 120, text: '', visible: true, enabled: true, properties: {} },
      ],
    }), 'utf-8')
    writeFileSync(join(dir, '_启动窗口.eyc'), ['.版本 2', '.程序集 窗口程序集_启动窗口', '', '.子程序 __启动窗口_创建完毕', ''].join('\n'), 'utf-8')

    const before = messages.length
    const r = await compileProject({ projectDir: dir, mode: 'build' })
    const errs = messages.slice(before).filter(m => m.type === 'error').map(m => m.text).join('\n')
    expect(r.success, `编译失败：\n${errs}`).toBe(true)

    const gen = readFileSync(join(dir, 'temp', 'main.cpp'), 'utf-8')
    // 前提自检：这个项目必须真的走到「空表 → 占位项」那条路，否则这条测试就是在空转
    const table = (gen.match(/static YcEditColorEntry g_ycEditColors\[\] = \{([\s\S]*?)\};/) || [])[1] || ''
    expect(table, '本用例必须命中「空颜色表 → 占位项」路径，否则测不到这个 bug').toMatch(/\{\s*-?\d+\s*,/)
    expect(table, '占位项的 id 绝不能是 0——GetDlgCtrlID 对顶层窗体返回 0，会撞上').not.toMatch(/\{\s*0\s*,/)

    const psPath = join(dir, 'probe.ps1')
    writeFileSync(psPath, '﻿' + PROBE_PS, 'utf-8')   // BOM：别让 PS 5.1 按 ANSI 解
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath, '-Exe', r.outputFile!], { encoding: 'utf-8', timeout: 90000 })

    const sysWindow = (out.match(/SYSWINDOW=(#[0-9A-F]{6})/) || [])[1]
    const pixel = (cls: string) => (out.match(new RegExp(`PIXEL=${cls}=(#[0-9A-F]{6})`, 'i')) || [])[1]
    expect(sysWindow, `探针没拿到系统窗口色：\n${out}`).toBeTruthy()

    expect(pixel('Edit'), `编辑框实测背景（此前是 #000000 黑底）。探针输出：\n${out}`).toBe(sysWindow)
    expect(pixel('ListBox'), `列表框与编辑框共用同一个 WM_CTLCOLOR case，一起中招。探针输出：\n${out}`).toBe(sysWindow)
  }, 240000)
})
