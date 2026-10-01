// 运行输出 stderr 通道的第三方噪音过滤。
//
// 用户实测：运行编译出的程序，输出面板出现 `libpng warning: iCCP: cHRM chunk does not match sRGB`。
// 排查定案：exe 本身不含 libpng（无相关字符串、无导入、直接运行优雅关闭可复现该 stderr 行）；
// 警告来自 **QQ 拼音等 TSF 输入法模块自带并注入到每个 GUI 进程的 libpng**（QQPinyin.ime 内
// 实测含该警告字面量与 libpng 标识）。它不是被运行程序的输出，IDE 捕获 stderr 时按行丢弃。
//
// 这里经 setCompilerHost 捕获 sendMessage 流量，直测 emitBufferedOutputChunk 的通道过滤：
// stderr 丢弃噪音行、stdout 不受影响、跨 chunk 断行合并后仍能识别、内部断点标记不受影响。
import { describe, it, expect, beforeAll } from 'vitest'
import { setCompilerHost, emitBufferedOutputChunk, flushBufferedOutputRemainder, isThirdPartyRuntimeNoiseLine, type CompileMessage } from '../../src/main/compiler'

let messages: CompileMessage[] = []
let focusCount = 0

beforeAll(() => {
  setCompilerHost({
    emitOutput: (m) => { messages.push(m) },
    requestFocusIdeWindow: () => { focusCount++ },
    notifyProcessExit: () => {},
    openPathExternally: async () => '',
  })
})

const NOISE = 'libpng warning: iCCP: cHRM chunk does not match sRGB'

describe('isThirdPartyRuntimeNoiseLine', () => {
  it('识别 libpng warning 行（含前导空白），不误伤其它行', () => {
    expect(isThirdPartyRuntimeNoiseLine(NOISE)).toBe(true)
    expect(isThirdPartyRuntimeNoiseLine(`  ${NOISE}`)).toBe(true)
    expect(isThirdPartyRuntimeNoiseLine('libpng warning: another variant')).toBe(true)
    expect(isThirdPartyRuntimeNoiseLine('libpng error: real problem')).toBe(false)
    expect(isThirdPartyRuntimeNoiseLine('标准输出 (“hi”)')).toBe(false)
    expect(isThirdPartyRuntimeNoiseLine('')).toBe(false)
  })
})

describe('emitBufferedOutputChunk 的 stderr 过滤', () => {
  it('stderr 通道丢弃噪音行，保留真实输出', () => {
    messages = []
    const remainder = emitBufferedOutputChunk(`${NOISE}\n真实错误: 除数不能为0\n`, '', 'warning')
    expect(remainder).toBe('')
    expect(messages.map(m => m.text)).toEqual(['真实错误: 除数不能为0'])
    expect(messages.every(m => m.type === 'warning')).toBe(true)
  })

  it('stdout 通道不过滤（用户程序自己的输出）', () => {
    messages = []
    emitBufferedOutputChunk(`${NOISE}\n程序正常输出\n`, '', 'info')
    expect(messages.map(m => m.text)).toEqual([NOISE, '程序正常输出'])
  })

  it('噪音行被 chunk 边界切断时，与缓冲合并后仍能识别丢弃', () => {
    messages = []
    const rem1 = emitBufferedOutputChunk('libpng war', '', 'warning')
    expect(rem1).toBe('libpng war')
    expect(messages).toHaveLength(0)
    const rem2 = emitBufferedOutputChunk(`ning: cHRM...\n后续输出\n`, rem1, 'warning')
    expect(rem2).toBe('')
    expect(messages.map(m => m.text)).toEqual(['后续输出'])
  })

  it('调试断点结束标记（stdout）仍触发窗口聚焦', () => {
    messages = []
    focusCount = 0
    emitBufferedOutputChunk('__YCDBG_BREAK_END__\n', '', 'info')
    expect(focusCount).toBe(1)
    expect(messages.map(m => m.text)).toEqual(['__YCDBG_BREAK_END__'])
  })

  it('flushBufferedOutputRemainder 同样过滤 stderr 噪音', () => {
    messages = []
    flushBufferedOutputRemainder(NOISE, 'warning')
    flushBufferedOutputRemainder('真实输出', 'warning')
    flushBufferedOutputRemainder(NOISE, 'info')
    expect(messages.map(m => m.text)).toEqual(['真实输出', NOISE])
  })
})
